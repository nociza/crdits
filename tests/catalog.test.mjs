import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCatalog, parseBenefits, upsertBenefit, validateCard, writeCard } from "../server/catalog.mjs";

const repositoryCatalog = new URL("../catalog/cards/", import.meta.url);

test("Marriott publishes mutually exclusive airline offers with a $250 threshold", async () => {
  const marriott = (await loadCatalog(repositoryCatalog.pathname)).find(card => card.slug === "marriott-bonvoy-boundless-credit-card");
  const benefit = marriott.benefits[0];
  assert.equal(benefit.qualifying_spend.amount_usd, 250);
  assert.equal(benefit.amount_usd, 50);
  assert.equal(benefit.default_schedule_id, "existing-2026");
  assert.deepEqual(benefit.period_schedules[1].periods.map(({ start, end }) => [start, end]), [["2026-06-04", "2026-12-31"], ["2027-01-01", "2027-06-30"]]);
  const broken = structuredClone(marriott);
  broken.benefits[0].period_schedules[1].periods[1].start = "2026-12-31";
  assert.ok(validateCard(broken).some(error => /overlapping periods/.test(error)));
  broken.benefits[0].period_schedules[1].periods[1].start = "2027-02-30";
  assert.ok(validateCard(broken).some(error => /invalid or overlapping/.test(error)));
  broken.benefits[0].default_schedule_id = "missing";
  assert.ok(validateCard(broken).some(error => /default_schedule_id/.test(error)));
});

test("community edits preserve the spending requirement and exact offer windows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-offer-terms-"));
  try {
    const card = (await loadCatalog(repositoryCatalog.pathname)).find(c => c.slug === "marriott-bonvoy-boundless-credit-card");
    await writeCard(directory, card);
    const original = card.benefits[0];
    const updated = await upsertBenefit(directory, card.slug, { id: original.id, title: "Airline statement credit" });
    assert.deepEqual(updated.benefits[0].period_schedules, original.period_schedules);
    assert.deepEqual(updated.benefits[0].qualifying_spend, original.qualifying_spend);
    assert.equal(updated.benefits[0].default_schedule_id, original.default_schedule_id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Bilt redemption policy survives community edits and rejects inconsistent incremental values", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-bilt-policy-"));
  try {
    const card = (await loadCatalog(repositoryCatalog.pathname)).find(c => c.slug === "bilt-palladium-card");
    await writeCard(directory, card);
    const original = card.benefits.find(b => b.id === "bilt-cash-annually");
    let updated = await upsertBenefit(directory, card.slug, { id: original.id, title: "Annual Bilt Cash" });
    assert.deepEqual(updated.benefits.find(b => b.id === original.id).redemption_policy, original.redemption_policy);
    updated = await upsertBenefit(directory, card.slug, { id: original.id, amount_usd: 100 });
    const edited = updated.benefits.find(b => b.id === original.id);
    assert.equal(edited.valuation.value_usd, 67);
    assert.deepEqual(validateCard(updated), []);
    edited.redemption_policy.options[0].counted_unit_value_usd = 1;
    assert.ok(validateCard(updated).some(error => /invalid redemption option/.test(error)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("seed catalog is valid and preserves the eleven provided products", async () => {
  const cards = await loadCatalog(repositoryCatalog.pathname);
  assert.equal(cards.length, 11);
  assert.ok(cards.every((card) => validateCard(card).length === 0));
  const aspire = cards.find((card) => card.slug === "hilton-honors-american-express-aspire-card");
  const bilt = cards.find((card) => card.slug === "bilt-palladium-card");
  const ventureX = cards.find((card) => card.slug === "capital-one-venture-x-rewards-credit-card");
  const sapphire = cards.find((card) => card.slug === "chase-sapphire-preferred");
  assert.equal(aspire.reward_currency.point_value_cents, 0.4);
  assert.equal(aspire.benefits.find((item) => item.id === "flight-credit").amount_usd, 50);
  assert.equal(aspire.benefits.find((item) => item.id === "hilton-resort-credit").cadence, "semiannual");
  assert.equal(aspire.benefits.find((item) => item.id === "clear-credit-per-calendar-year").amount_usd, 219);
  assert.equal(bilt.benefits.find((item) => item.id === "annual-bilt-travel-hotel-credit").valid_from, "2026-01-01");
  assert.equal(ventureX.benefits.find((item) => item.id === "10-000-anniversary-miles-each-year").valuation.value_usd, 100);
  assert.equal(sapphire.benefits.find((item) => item.id === "doordash-grocery-daily-essentials-benefit-while-eligible-dashpass-terms-apply").valid_from, "2024-08-01");
  assert.ok(cards.every((card) => card.benefits.every((benefit) => benefit.valuation && benefit.source_url)));
});

test("seed research dates preserve the full current-year benefit history", () => {
  const [benefit] = parseBenefits("$10 monthly dining credit", "", "2026-08-25");
  assert.equal(benefit.valid_from, "2026-01-01");
});

test("community title edits preserve a benefit-specific fixed point valuation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-valuation-"));
  try {
    const card = (await loadCatalog(repositoryCatalog.pathname)).find(c => c.slug === "capital-one-venture-x-rewards-credit-card");
    await writeCard(directory, card);
    const updated = await upsertBenefit(directory, card.slug, { id: "10-000-anniversary-miles-each-year", title: "Automatic anniversary miles" });
    const bonus = updated.benefits.find(b => b.id === "10-000-anniversary-miles-each-year");
    assert.equal(bonus.valuation.value_usd, 100);
    assert.equal(bonus.valuation.point_value_cents, 1);
    assert.equal(bonus.minimum_membership_years, 1);
    assert.equal(updated.reward_currency.point_value_cents, 1.85);
    assert.deepEqual(validateCard(updated), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("catalog updates archive the previous definition", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crdits-catalog-"));
  try {
    const card = {
      schema_version: 1,
      slug: "test-card",
      name: "Test Card",
      short_name: "Test",
      issuer: "Issuer",
      annual_fee_usd: 0,
      reward_currency: { name: "Points", point_value_cents: 1, cash_floor_cents: 1 },
      base_reward: { id: "base", label: "1X", rate: 1, rate_type: "points_multiplier" },
      reward_rules: [],
      benefits: [{ id: "dining-credit", title: "Dining credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 10, cadence: "monthly", valid_from: "2026-01-01", valid_to: null, source_url: "https://issuer.example/terms", valuation: { method: "face_value", value_usd: 10, basis: "Issuer face value", source_url: "https://issuer.example/terms", as_of: "2026-01-01" } }],
      sources: [],
      history: [],
    };
    await writeCard(directory, card);
    await upsertBenefit(directory, "test-card", { title: "Dining credit", tracking_type: "spend", amount_usd: 15, cadence: "monthly", valid_from: "2026-09-01", source_url: "https://issuer.example/terms" });
    const updated = JSON.parse(await readFile(path.join(directory, "test-card.json"), "utf8"));
    assert.equal(updated.benefits[0].amount_usd, 15);
    assert.equal(updated.benefits[0].valuation.value_usd, 15);
    assert.equal(updated.benefits[0].valuation.method, "face_value");
    assert.equal(updated.history.length, 1);
    assert.equal(updated.history[0].value.amount_usd, 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
