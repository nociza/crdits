import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addUsage, addWalletCard, openDatabase, setBenefitStatus, setPreference, updateWalletCard } from "../server/db.mjs";
import { buildDashboard, enumerateCycles, recommendCard } from "../server/engine.mjs";

const card = {
  schema_version: 1,
  slug: "test-card",
  name: "Test Card",
  short_name: "Test",
  issuer: "Issuer",
  annual_fee_usd: 95,
  reward_currency: { name: "Points", point_value_cents: 2, cash_floor_cents: 1 },
  base_reward: { id: "base", label: "1X everything", rate: 1, rate_type: "points_multiplier", valid_from: "2026-01-01", valid_to: null },
  reward_rules: [{ id: "dining", category: "dining", label: "3X dining", match_terms: ["dining", "restaurant"], rate: 3, rate_type: "points_multiplier", conditional: false, valid_from: "2026-01-01", valid_to: null }],
  benefits: [{ id: "dining-credit", title: "Dining credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 25, cadence: "monthly", valid_from: "2026-01-01", valid_to: null, valuation: { method: "face_value", value_usd: 25, basis: "Issuer face value", source_url: "https://issuer.example/card", as_of: "2026-08-01" } }],
  sources: [],
  history: [],
};

test("enumerates monthly and quarterly cycles deterministically", () => {
  const wallet = { opened_on: "2026-01-10", renewal_date: null };
  const monthly = enumerateCycles(card.benefits[0], wallet, "2026-08-01", "2026-10-31");
  assert.deepEqual(monthly.map((item) => item.key), ["2026-08", "2026-09", "2026-10"]);
  const quarterly = enumerateCycles({ ...card.benefits[0], cadence: "quarterly" }, wallet, "2026-04-10", "2026-10-01");
  assert.deepEqual(quarterly.map((item) => item.key), ["2026-Q2", "2026-Q3", "2026-Q4"]);
});

test("partial usage and personal value drive annual projection", () => {
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: card.slug, nickname: "My Test" });
  addUsage(db, { wallet_card_id: wallet.id, benefit_id: "dining-credit", amount_usd: 18, used_at: "2026-08-20" });
  setPreference(db, { wallet_card_id: wallet.id, benefit_id: "dining-credit", probability: 0.6, personal_value_percent: 0.7 });
  const dashboard = buildDashboard({ catalog: [card], db, asOf: "2026-08-26", reminderDays: 30 });
  const benefit = dashboard.cards[0].benefits[0];
  assert.equal(benefit.used_usd, 18);
  assert.equal(benefit.remaining_usd, 7);
  assert.equal(dashboard.metrics.credits_remaining_usd, 107);
  assert.equal(dashboard.metrics.expected_remaining_usd, 44.94);
  assert.equal(dashboard.metrics.realized_ytd_usd, 18);
  assert.equal(dashboard.metrics.projected_net_usd, -77);
  assert.equal(dashboard.reminders.length, 1);
  db.close();
});

test("catalog values are used at 100% without asking for personal assumptions", () => {
  const db = openDatabase(":memory:");
  addWalletCard(db, { catalog_slug: card.slug, nickname: "My Test" });
  const dashboard = buildDashboard({ catalog: [card], db, asOf: "2026-08-26", reminderDays: 30 });
  const benefit = dashboard.cards[0].benefits[0];
  assert.equal(benefit.probability, 1);
  assert.equal(benefit.personal_value_percent, 1);
  assert.equal(benefit.catalog_value_usd, 25);
  assert.equal(benefit.valuation_method, "face_value");
  assert.equal(dashboard.metrics.credits_remaining_usd, 125);
  assert.equal(dashboard.metrics.expected_remaining_usd, 125);
  assert.equal(dashboard.metrics.projected_net_usd, -95);
  db.close();
});

test("recommends by reward value and ignores conditional rules without a merchant", () => {
  const db = openDatabase(":memory:");
  addWalletCard(db, { catalog_slug: card.slug, nickname: "My Test" });
  const conditionalCard = {
    ...card,
    slug: "conditional-card",
    name: "Conditional Card",
    reward_currency: { name: "Points", point_value_cents: 3, cash_floor_cents: 1 },
    reward_rules: [{ id: "dining", category: "dining", label: "Up to 10X select dining", match_terms: ["dining"], rate: 10, rate_type: "points_multiplier", conditional: true, valid_from: "2026-01-01", valid_to: null }],
  };
  addWalletCard(db, { catalog_slug: conditionalCard.slug, nickname: "Conditional" });
  const result = recommendCard({ catalog: [card, conditionalCard], db, category: "dining", amount: 100, asOf: "2026-08-26" });
  assert.equal(result.recommendation[0].nickname, "My Test");
  assert.equal(result.recommendation[0].total_value_usd, 6);
  db.close();
});

test("Bilt Palladium uses the sourced 3.33X catch-all strategy and conservative Bilt Cash value", async () => {
  const bilt = JSON.parse(await readFile(new URL("../catalog/cards/bilt-palladium-card.json", import.meta.url), "utf8"));
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: bilt.slug, nickname: "My Bilt" });
  const result = recommendCard({ catalog: [bilt], db, category: "other", amount: 100, asOf: "2026-08-28" });
  assert.equal(result.recommendation[0].rate, 2);
  assert.equal(result.recommendation[0].reward_value_usd, 4.4);
  assert.match(result.recommendation[0].conditional_alternatives[0].rule, /75% of monthly housing spend/);
  const context = { confirmed_rules: [`${bilt.slug}:${bilt.base_reward.id}`], remaining_caps: { [`${bilt.slug}:${bilt.base_reward.id}`]: 50 } };
  const capped = recommendCard({ catalog: [bilt], db, category: "other", amount: 100, context, asOf: "2026-08-28" });
  assert.equal(capped.recommendation[0].rate, 3.333333);
  assert.equal(capped.recommendation[0].reward_value_usd, 5.87); // first $50 boosted, remainder at 2X

  const dashboard = buildDashboard({ catalog: [bilt], db, asOf: "2026-08-28" });
  const annualBiltCash = dashboard.cards[0].benefits.find((benefit) => benefit.id === "bilt-cash-annually");
  assert.equal(annualBiltCash.amount_usd, 200);
  assert.equal(annualBiltCash.catalog_value_usd, 66.67);
  assert.equal(annualBiltCash.valuation_method, "market_estimate");

  addUsage(db, { wallet_card_id: wallet.id, benefit_id: "bilt-cash-annually", amount_usd: 200, used_at: "2026-08-28" });
  const usedDashboard = buildDashboard({ catalog: [bilt], db, asOf: "2026-08-28" });
  const usedBiltCash = usedDashboard.cards[0].benefits.find((benefit) => benefit.id === "bilt-cash-annually");
  assert.equal(usedBiltCash.remaining_usd, 0);
  assert.equal(usedBiltCash.expected_value_usd, 0);
  assert.equal(usedDashboard.cards[0].logged_realized_ytd_usd, 66.67);
  assert.equal(usedDashboard.cards[0].realized_ytd_usd, 66.67);
  assert.equal(usedDashboard.cards[0].projected_net_usd, -428.33);
  assert.equal(usedDashboard.metrics.projected_net_usd, -428.33);
  db.close();
});

test("automatic and enrollment benefits never behave like spend credits", () => {
  const db = openDatabase(":memory:");
  const behaviorCard = {
    ...card,
    benefits: [
      { id: "anniversary-points", title: "10,000 anniversary points", kind: "anniversary_bonus", tracking_type: "automatic", points_amount: 10_000, amount_usd: null, cadence: "anniversary", valid_from: "2025-01-01", valid_to: null },
      { id: "membership", title: "Partner membership", kind: "membership", tracking_type: "enrollment", enrollment_required: true, amount_usd: 50, cadence: "one_time", valid_from: "2025-01-01", valid_to: null },
      { id: "status", title: "Hotel status", kind: "membership", tracking_type: "automatic", amount_usd: 300, cadence: "one_time", valid_from: "2025-01-01", valid_to: null },
    ],
  };
  const wallet = addWalletCard(db, { catalog_slug: behaviorCard.slug, nickname: "Behaviors" });
  let dashboard = buildDashboard({ catalog: [behaviorCard], db, asOf: "2026-08-26", reminderDays: 30 });
  const missingAnchor = dashboard.cards[0].benefits.find((item) => item.id === "anniversary-points");
  assert.equal(missingAnchor.requires_membership_year, true);
  assert.equal(missingAnchor.remaining_usd, null);

  updateWalletCard(db, wallet.id, { membership_year_start: "2026-06-01" });
  setBenefitStatus(db, { wallet_card_id: wallet.id, benefit_id: "membership", status: "active", activated_on: "2026-08-01" });
  dashboard = buildDashboard({ catalog: [behaviorCard], db, asOf: "2026-08-26", reminderDays: 30 });
  const points = dashboard.cards[0].benefits.find((item) => item.id === "anniversary-points");
  const membership = dashboard.cards[0].benefits.find((item) => item.id === "membership");
  const status = dashboard.cards[0].benefits.find((item) => item.id === "status");
  assert.equal(points.tracking_type, "automatic");
  assert.equal(points.amount_usd, 200);
  assert.equal(points.used_usd, 0);
  assert.equal(points.remaining_usd, 0);
  assert.equal(points.is_actionable, false);
  assert.equal(points.counts_toward_value, true);
  assert.equal(points.catalog_value_usd, 200);
  assert.equal(membership.status, "active");
  assert.equal(membership.is_actionable, false);
  assert.equal(membership.counts_toward_value, false);
  assert.equal(status.counts_toward_value, false);
  assert.equal(status.expected_value_usd, null);
  assert.equal(dashboard.cards[0].needs_attention, false);
  assert.equal(dashboard.metrics.realized_ytd_usd, 200);
  db.close();
});

test("monthly, quarterly, and semiannual credits expose independent period timelines", () => {
  const db = openDatabase(":memory:");
  const splitCard = {
    ...card,
    benefits: [
      { id: "month-credit", title: "Dining credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 10, cadence: "monthly", valid_from: "2026-01-01", valid_to: null },
      { id: "half-credit", title: "Resort credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 200, cadence: "semiannual", valid_from: "2026-01-01", valid_to: null },
      { id: "quarter-credit", title: "Flight credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 50, cadence: "quarterly", valid_from: "2026-01-01", valid_to: null },
    ],
  };
  const wallet = addWalletCard(db, { catalog_slug: splitCard.slug, nickname: "Split" });
  addUsage(db, { wallet_card_id: wallet.id, benefit_id: "month-credit", amount_usd: 10, used_at: "2026-02-28" });
  addUsage(db, { wallet_card_id: wallet.id, benefit_id: "half-credit", amount_usd: 200, used_at: "2026-06-30" });
  addUsage(db, { wallet_card_id: wallet.id, benefit_id: "quarter-credit", amount_usd: 20, used_at: "2026-08-20" });
  const dashboard = buildDashboard({ catalog: [splitCard], db, asOf: "2026-08-26", reminderDays: 30 });
  const month = dashboard.cards[0].benefits.find((item) => item.id === "month-credit");
  const half = dashboard.cards[0].benefits.find((item) => item.id === "half-credit");
  const quarter = dashboard.cards[0].benefits.find((item) => item.id === "quarter-credit");
  assert.deepEqual(month.periods.map((item) => item.label), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  assert.deepEqual(month.periods.filter((item) => ["2026-02", "2026-08", "2026-09"].includes(item.key)).map((item) => [item.key, item.status, item.used_usd, item.is_current]), [
    ["2026-02", "used", 10, false],
    ["2026-08", "available", 0, true],
    ["2026-09", "upcoming", 0, false],
  ]);
  assert.deepEqual(half.periods.map((item) => [item.label, item.status, item.used_usd, item.is_current]), [
    ["H1", "used", 200, false],
    ["H2", "available", 0, true],
  ]);
  assert.deepEqual(quarter.periods.map((item) => [item.label, item.status, item.used_usd, item.is_current]), [
    ["Q1", "expired", 0, false],
    ["Q2", "expired", 0, false],
    ["Q3", "partial", 20, true],
    ["Q4", "upcoming", 0, false],
  ]);
  assert.equal(quarter.remaining_usd, 30);
  db.close();
});
