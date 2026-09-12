import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createService } from "../server/service.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("period corrections are capped, duplicate-safe, concurrency checked and auditable", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-27" });
  const wallet = await service.addWalletCard({ catalog_slug: "hilton-honors-american-express-aspire-card", nickname: "Test" });
  const input = { wallet_card_id: wallet.id, benefit_id: "flight-credit", used_at: "2026-06-30", period_key: "2026-Q2", amount_usd: 50, request_id: "test-request-1" };
  const first = await service.addUsage(input);
  assert.deepEqual(await service.addUsage(input), first);
  await assert.rejects(service.addUsage({ ...input, request_id: "test-request-2" }), /cannot exceed/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 20, request_id: "test-request-2", expected_total_usd: 0 }, { replace: true }), /another session/);
  await service.addUsage({ ...input, amount_usd: 20, request_id: "test-request-3", expected_total_usd: 50 }, { replace: true });
  await service.addUsage({ ...input, amount_usd: 0, request_id: "test-request-4", expected_total_usd: 20 }, { replace: true });
  assert.equal((await service.dashboard()).cards[0].logged_realized_ytd_usd, 0);
  const history = service.usageHistory(wallet.id, "flight-credit");
  assert.deepEqual(history.map(row => [row.before_usd, row.after_usd]), [[20, 0], [50, 20], [0, 50]]);
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM benefit_usage WHERE voided_at IS NOT NULL").get().n, 2);
  service.db.close();
});

test("reporting a past year never authorizes future usage", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-27" });
  const report = await service.dashboard({ year: 2025 });
  assert.equal(report.as_of, "2025-12-31");
  assert.equal(report.today, "2026-08-27");
  await assert.rejects(service.dashboard({ year: 2027 }), /year must/);
  service.db.close();
});

test("a named merchant alone does not qualify portal or partner earnings", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-27" });
  await service.addWalletCard({ catalog_slug: "bilt-palladium-card", nickname: "Test Bilt" });
  assert.equal((await service.recommend({ category: "travel", merchant: "Delta direct", amount: 100 })).recommendation[0].rate, 2);
  assert.equal((await service.recommend({ category: "dining", merchant: "Random cafe", amount: 100 })).recommendation[0].rate, 2);
  await assert.rejects(service.recommend({ category: "other", amount: -10 }), /positive number/);
  service.db.close();
});

test("retrospective split-credit usage is constrained to its named period", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-27" });
  const wallet = await service.addWalletCard({
    catalog_slug: "hilton-honors-american-express-aspire-card",
    nickname: "Aspire",
  });

  await service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: "flight-credit",
    amount_usd: 50,
    used_at: "2026-06-30",
    period_key: "2026-Q2",
    note: "Retrospective bookkeeping",
  });

  const dashboard = await service.dashboard();
  const flightCredit = dashboard.cards[0].benefits.find((benefit) => benefit.id === "flight-credit");
  assert.equal(flightCredit.periods.find((period) => period.key === "2026-Q2").status, "used");
  assert.equal(flightCredit.periods.find((period) => period.key === "2026-Q3").used_usd, 0);

  await assert.rejects(service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: "flight-credit",
    amount_usd: 10,
    used_at: "2026-08-01",
    period_key: "2026-Q2",
  }), /does not fall inside 2026-Q2/);

  await assert.rejects(service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: "flight-credit",
    amount_usd: 10,
    used_at: "2026-10-01",
    period_key: "2026-Q4",
  }), /future period/);

  await assert.rejects(service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: "flight-credit",
    amount_usd: 10,
    used_at: "2026-02-31",
    period_key: "2026-Q1",
  }), /valid YYYY-MM-DD/);

  service.db.close();
});

test("seed recurring credits expose complete current-year history", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-28" });
  const wallet = await service.addWalletCard({
    catalog_slug: "chase-sapphire-preferred",
    nickname: "Sapphire",
  });
  const biltWallet = await service.addWalletCard({
    catalog_slug: "bilt-palladium-card",
    nickname: "Bilt",
  });
  const benefitId = "doordash-grocery-daily-essentials-benefit-while-eligible-dashpass-terms-apply";
  const dashboard = await service.dashboard();
  const sapphire = dashboard.cards.find((item) => item.id === wallet.id);
  const bilt = dashboard.cards.find((item) => item.id === biltWallet.id);
  const benefit = sapphire.benefits.find((item) => item.id === benefitId);
  const hotelCredit = bilt.benefits.find((item) => item.id === "annual-bilt-travel-hotel-credit");
  assert.deepEqual(benefit.periods.map((period) => period.label), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  assert.deepEqual(hotelCredit.periods.map((period) => period.label), ["H1", "H2"]);

  service.db.close();
});

test("retrospective monthly usage is constrained to its named month", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-08-28" });
  const wallet = await service.addWalletCard({
    catalog_slug: "chase-sapphire-preferred",
    nickname: "Sapphire",
  });
  const benefitId = "doordash-grocery-daily-essentials-benefit-while-eligible-dashpass-terms-apply";

  await service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: benefitId,
    amount_usd: 10,
    used_at: "2026-07-31",
    period_key: "2026-07",
  });

  const dashboard = await service.dashboard();
  const benefit = dashboard.cards[0].benefits.find((item) => item.id === benefitId);
  assert.equal(benefit.periods.find((period) => period.key === "2026-07").status, "used");
  assert.equal(benefit.periods.find((period) => period.key === "2026-08").used_usd, 0);

  await assert.rejects(service.addUsage({
    wallet_card_id: wallet.id,
    benefit_id: benefitId,
    amount_usd: 5,
    used_at: "2026-08-01",
    period_key: "2026-07",
  }), /does not fall inside 2026-07/);

  service.db.close();
});
