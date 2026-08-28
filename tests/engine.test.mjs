import assert from "node:assert/strict";
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
  benefits: [{ id: "dining-credit", title: "Dining credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 25, cadence: "monthly", valid_from: "2026-01-01", valid_to: null }],
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
  assert.equal(dashboard.reminders.length, 1);
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
