import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createService } from "../server/service.mjs";
import { creditUsageTotal } from "../app/ui/credit-usage.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("November anniversary expires November 2 and partial/full logs reset on November 3", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-11-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "capital-one-venture-x-rewards-credit-card", membership_year_start: "2025-11-03" });
  const benefitId = "annual-capital-one-travel-credit";
  const travel = () => service.dashboard().then(data => data.cards[0].benefits.find(item => item.id === benefitId));
  let benefit = await travel();
  assert.equal(benefit.expires_on, "2026-11-02");
  for (const [amount, expected] of [[125, 125], [50, 175], [125, 300]]) {
    const total = creditUsageTotal(amount, benefit.used_usd, benefit.amount_usd, "add");
    await service.addUsage({ wallet_card_id: wallet.id, benefit_id: benefitId, used_at: "2026-11-02", amount_usd: total, expected_total_usd: benefit.used_usd, request_id: `nov-use-${expected}` }, { replace: true });
    benefit = await travel();
    assert.equal(benefit.used_usd, expected);
  }
  assert.equal(benefit.remaining_usd, 0);
  const { buildDashboard } = await import("../server/engine.mjs");
  const { loadCatalog } = await import("../server/catalog.mjs");
  const renewed = buildDashboard({ db: service.db, catalog: await loadCatalog(path.join(root, "catalog/cards")), asOf: "2026-11-03" });
  const reset = renewed.cards[0].benefits.find(item => item.id === benefitId);
  assert.equal(reset.used_usd, 0);
  assert.equal(reset.remaining_usd, 300);
  assert.equal(reset.expires_on, "2027-11-02");
  assert.equal(renewed.cards[0].automatic_realized_ytd_usd, 100);
  assert.equal(service.usageHistory(wallet.id, benefitId).length, 3);
  service.db.close();
});

test("Venture X counts the automatic $100 bonus and caps the loggable $300 anniversary credit", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-01" });
  const wallet = await service.addWalletCard({ catalog_slug: "capital-one-venture-x-rewards-credit-card", nickname: "Venture X" });
  let result = (await service.dashboard()).cards[0];
  assert.equal(result.automatic_realized_ytd_usd, 100);
  assert.equal(result.projected_net_usd, -295);
  assert.equal(result.benefits.find(b => b.id === "10-000-anniversary-miles-each-year").is_actionable, false);
  assert.equal(result.benefits.find(b => b.id === "annual-capital-one-travel-credit").requires_membership_year, true);
  await assert.rejects(service.addUsage({ wallet_card_id: wallet.id, benefit_id: "annual-capital-one-travel-credit", amount_usd: 300 }), /anniversary/);
  service.updateWalletCard(wallet.id, { membership_year_start: "2026-05-01", opened_on: "2024-05-01" });
  const input = { wallet_card_id: wallet.id, benefit_id: "annual-capital-one-travel-credit", used_at: "2026-10-01", amount_usd: 125 };
  await service.addUsage(input);
  result = (await service.dashboard()).cards[0];
  assert.equal(result.benefits.find(b => b.id === input.benefit_id).remaining_usd, 175);
  assert.equal(result.automatic_realized_ytd_usd, 100);
  await service.addUsage({ ...input, amount_usd: 175 });
  await assert.rejects(service.addUsage({ ...input, amount_usd: 1 }), /cannot exceed/);
  result = (await service.dashboard()).cards[0];
  assert.equal(result.logged_realized_ytd_usd, 300);
  assert.equal(result.realized_ytd_usd, 400);
  assert.equal(result.projected_net_usd, 5);
  assert.equal(result.benefits.find(b => b.id === input.benefit_id).expires_on, "2027-04-30");
  await assert.rejects(service.addUsage({ ...input, benefit_id: "10-000-anniversary-miles-each-year" }), /does not use the spend ledger/);
  service.db.close();
});

test("Venture X anniversary miles begin at the first anniversary when opening date is known", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-01" });
  await service.addWalletCard({ catalog_slug: "capital-one-venture-x-rewards-credit-card", opened_on: "2026-05-01" });
  const card = (await service.dashboard()).cards[0];
  assert.equal(card.automatic_realized_ytd_usd, 0);
  assert.equal(card.projected_net_usd, -395);
  assert.equal(card.benefits.some(b => b.id === "10-000-anniversary-miles-each-year"), false);
  service.db.close();
});

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
