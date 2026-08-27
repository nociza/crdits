import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCatalog, upsertBenefit, validateCard, writeCard } from "../server/catalog.mjs";

const repositoryCatalog = new URL("../catalog/cards/", import.meta.url);

test("seed catalog is valid and preserves the eleven provided products", async () => {
  const cards = await loadCatalog(repositoryCatalog.pathname);
  assert.equal(cards.length, 11);
  assert.ok(cards.every((card) => validateCard(card).length === 0));
  const aspire = cards.find((card) => card.slug === "hilton-honors-american-express-aspire-card");
  assert.equal(aspire.reward_currency.point_value_cents, 0.4);
  assert.equal(aspire.benefits.find((item) => item.id === "flight-credit").amount_usd, 50);
  assert.equal(aspire.benefits.find((item) => item.id === "hilton-resort-credit").cadence, "semiannual");
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
      benefits: [{ id: "dining-credit", title: "Dining credit", kind: "statement_credit", tracking_type: "spend", amount_usd: 10, cadence: "monthly", valid_from: "2026-01-01", valid_to: null }],
      sources: [],
      history: [],
    };
    await writeCard(directory, card);
    await upsertBenefit(directory, "test-card", { title: "Dining credit", tracking_type: "spend", amount_usd: 15, cadence: "monthly", valid_from: "2026-09-01", source_url: "https://issuer.example/terms" });
    const updated = JSON.parse(await readFile(path.join(directory, "test-card.json"), "utf8"));
    assert.equal(updated.benefits[0].amount_usd, 15);
    assert.equal(updated.history.length, 1);
    assert.equal(updated.history[0].value.amount_usd, 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
