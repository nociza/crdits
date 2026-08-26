import assert from "node:assert/strict";
import test from "node:test";
import { addUsage, addWalletCard, openDatabase, setPreference } from "../server/db.mjs";
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
  benefits: [{ id: "dining-credit", title: "Dining credit", kind: "statement_credit", amount_usd: 25, cadence: "monthly", valid_from: "2026-01-01", valid_to: null }],
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
