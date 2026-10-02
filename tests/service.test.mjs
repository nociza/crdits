// Calendar-specific regressions stay explicit; rolling behavior is covered in rolling.test.mjs.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createService } from "../server/service.mjs";
import { creditUsageTotal } from "../app/ui/credit-usage.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("past-year evidence persists privately without inventing a credit or an exact transaction date", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "chase-sapphire-preferred" });
  const benefitId = "doordash-grocery-daily-essentials-benefit-while-eligible-dashpass-terms-apply";
  const input = { wallet_card_id: wallet.id, benefit_id: benefitId, used_at: "2025-10-31", period_key: "2025-10", assessment: "likely_used", note: "Reported small checkout charge; discount not identified. Order date unknown.", expected_total_usd: 0, request_id: "generic-evidence-2025" };
  const saved = await service.setPeriodEvidence(input);
  assert.equal(saved.period_start, "2025-10-01");
  assert.equal(saved.period_end, "2025-10-31");
  assert.deepEqual(await service.setPeriodEvidence(input), saved);
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM benefit_evidence_changes").get().n, 1);
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM benefit_usage").get().n, 0);
  const historical = await service.dashboard({ year: 2025 });
  assert.equal(historical.metrics.realized_ytd_usd, 0);
  const period = historical.cards[0].benefits.find(item => item.id === benefitId).periods.find(item => item.key === "2025-10");
  assert.equal(period.evidence.assessment, "likely_used");
  assert.equal(period.used_usd, 0);
  assert.equal(period.evidence.note, input.note);
  await assert.rejects(service.setPeriodEvidence({ ...input, note: "Changed" }), /request_id/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "invalid-claim", assessment: "used" }), /Record the credit/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "invalid-date", used_at: "2025-02-30" }), /valid YYYY/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "future-report", used_at: "2026-11-30", period_key: "2026-11" }), /future/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "wrong-period", period_key: "2025-11" }), /selected eligible period/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "invalid-status", assessment: "maybe" }), /invalid evidence/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "unknown-benefit", benefit_id: "unknown" }), /spend-tracked/);
  await assert.rejects(service.setPeriodEvidence({ ...input, request_id: "before-offer", used_at: "2024-07-31", period_key: "2024-07" }), /selected eligible period/);
  await service.setPeriodEvidence({ ...input, request_id: "reassessed-example", assessment: "not_used", note: "Owner corrected the earlier assessment" });
  const audit = service.db.prepare("SELECT before_json, result FROM benefit_evidence_changes ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(audit.before_json).assessment, "likely_used");
  assert.equal(JSON.parse(audit.result).assessment, "not_used");
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM benefit_usage").get().n, 0);
  service.db.close();
});

test("only recorded card-credit amounts affect net value; evidence cannot overwrite monetary use", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "chase-sapphire-preferred" });
  const benefitId = "doordash-grocery-daily-essentials-benefit-while-eligible-dashpass-terms-apply";
  const base = { wallet_card_id: wallet.id, benefit_id: benefitId };
  await service.setPeriodEvidence({ ...base, used_at: "2026-01-31", period_key: "2026-01", assessment: "likely_used", note: "Unidentified discount", expected_total_usd: 0, request_id: "uncertain-example" });
  await service.setPeriodEvidence({ ...base, used_at: "2026-03-31", period_key: "2026-03", assessment: "not_used", note: "No qualifying orders", expected_total_usd: 0, request_id: "unused-example" });
  for (const month of [2, 4, 7, 8]) {
    const date = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    const periodKey = date.slice(0, 7);
    await assert.rejects(service.addUsage({ ...base, used_at: date, amount_usd: 14 }), /cannot exceed the \$10 credit/);
    await service.addUsage({ ...base, used_at: date, amount_usd: 10 });
    await service.setPeriodEvidence({ ...base, used_at: date, period_key: periodKey, assessment: "used", note: "Owner-reported redemption; additional discounts excluded", expected_total_usd: 10, request_id: `used-example-${month}` });
  }
  const dashboard = await service.dashboard({ year: 2026 });
  assert.equal(dashboard.metrics.realized_ytd_usd, 40);
  assert.equal(dashboard.metrics.projected_net_usd, -55);
  const credit = dashboard.cards[0].benefits.find(item => item.id === benefitId);
  assert.equal(credit.remaining_usd, 10); // evidence for old months does not consume October
  assert.equal(credit.periods.find(item => item.key === "2026-01").used_usd, 0);
  assert.equal(credit.periods.filter(item => item.evidence?.assessment === "used").length, 4);
  const conflict = { ...base, used_at: "2026-02-28", period_key: "2026-02", assessment: "not_used", note: "Cannot silently clear a ledger", request_id: "conflicting-report" };
  await assert.rejects(service.setPeriodEvidence({ ...conflict, expected_total_usd: 0 }), /another session/);
  await assert.rejects(service.setPeriodEvidence({ ...conflict, expected_total_usd: 10 }), /Recorded usage already exists/);
  assert.equal((await service.dashboard({ year: 2026 })).metrics.realized_ytd_usd, 40);
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM benefit_evidence_changes").get().n, 6);
  service.db.close();
});

test("offer selection persists privately, preserves preferences and leaves all ledger entries untouched", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "marriott-bonvoy-boundless-credit-card" });
  const benefitId = "temporary-airline-statement-credit-promotion-up-to-100-total";
  await service.addUsage({ wallet_card_id: wallet.id, benefit_id: benefitId, amount_usd: 50, used_at: "2026-06-30", note: "Prior credit" });
  const before = service.db.prepare("SELECT * FROM benefit_usage ORDER BY id").all();
  await service.setPreference({ wallet_card_id: wallet.id, benefit_id: benefitId, probability: 0.75, reminder_days: 14 });
  const saved = await service.setPreference({ wallet_card_id: wallet.id, benefit_id: benefitId, period_schedule_id: "new-2026-2027", expected_schedule_id: "existing-2026" });
  assert.equal(saved.probability, 0.75);
  assert.equal(saved.reminder_days, 14);
  const current = (await service.dashboard({ year: 2026 })).cards[0];
  assert.equal(current.projected_net_usd, -45);
  assert.equal(current.benefits.find(item => item.id === benefitId).used_usd, 50);
  assert.deepEqual(service.db.prepare("SELECT * FROM benefit_usage ORDER BY id").all(), before);
  await assert.rejects(service.setPreference({ wallet_card_id: wallet.id, benefit_id: benefitId, period_schedule_id: "existing-2026", expected_schedule_id: "existing-2026" }), /another session/);
  await assert.rejects(service.setPreference({ wallet_card_id: wallet.id, benefit_id: benefitId, period_schedule_id: "fake" }), /Invalid offer schedule/);
  await assert.rejects(service.setPreference({ wallet_card_id: wallet.id, benefit_id: "fake", probability: 1 }), /benefit not found/);
  service.db.close();
});

test("airline purchases cannot be logged as credit or outside the selected earning window", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "marriott-bonvoy-boundless-credit-card" });
  const benefitId = "temporary-airline-statement-credit-promotion-up-to-100-total";
  await service.setPreference({ wallet_card_id: wallet.id, benefit_id: benefitId, period_schedule_id: "new-2026-2027" });
  const input = { wallet_card_id: wallet.id, benefit_id: benefitId, used_at: "2026-08-31", period_key: "2026-new-airline", period_schedule_id: "new-2026-2027" };
  await assert.rejects(service.addUsage({ ...input, amount_usd: 185.60 }), /cannot exceed/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 50, used_at: "2026-06-03" }), /does not fall inside/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 50, used_at: "2027-01-01", period_key: "2027-new-airline" }), /future period/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 50, period_schedule_id: "existing-2026" }), /schedule changed/);
  await service.addUsage({ ...input, amount_usd: 50 });
  assert.equal((await service.dashboard({ year: 2026 })).cards[0].logged_realized_ytd_usd, 50);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 1 }), /cannot exceed/);
  service.db.close();
});

test("Bilt cash and points consume the same balance but only cash adds incremental fee value", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-01" });
  const wallet = await service.addWalletCard({ catalog_slug: "bilt-palladium-card" });
  const input = { wallet_card_id: wallet.id, benefit_id: "bilt-cash-annually", used_at: "2026-08-28" };
  await assert.rejects(service.addUsage({ ...input, amount_usd: 10 }), /redemption method/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 10, redemption_method: "fake" }), /Invalid redemption/);
  await service.addUsage({ ...input, amount_usd: 100, redemption_method: "points", value_ratio: 1 });
  await service.addUsage({ ...input, amount_usd: 100, redemption_method: "cash", value_ratio: 1 });
  let card = (await service.dashboard({ year: 2026 })).cards[0];
  let benefit = card.benefits.find(item => item.id === input.benefit_id);
  assert.equal(card.logged_realized_ytd_usd, 67);
  assert.equal(benefit.used_value_usd, 67);
  assert.equal(benefit.used_usd, 200);
  assert.equal(benefit.remaining_usd, 0);
  assert.equal(benefit.expected_value_usd, 0);
  // A normal total correction keeps prior mixed redemption types and dates.
  await service.addUsage({ ...input, amount_usd: 200, expected_total_usd: 200, request_id: "keep-mixed-2026" }, { replace: true });
  assert.equal((await service.dashboard({ year: 2026 })).cards[0].logged_realized_ytd_usd, 67);
  const correction = { ...input, amount_usd: 200, expected_total_usd: 200, expected_value_usd: 67, redemption_method: "cash", revalue_existing: true, request_id: "classify-cash-2026" };
  const result = await service.addUsage(correction, { replace: true });
  assert.equal(result.before_value_usd, 67);
  assert.equal(result.after_value_usd, 134);
  assert.deepEqual(await service.addUsage(correction, { replace: true }), result);
  await assert.rejects(service.addUsage({ ...correction, redemption_method: "points" }, { replace: true }), /request_id/);
  card = (await service.dashboard({ year: 2026 })).cards[0];
  assert.equal(card.logged_realized_ytd_usd, 134);
  assert.equal(card.projected_net_usd, -361);
  const rows = service.db.prepare("SELECT * FROM benefit_usage WHERE voided_at IS NULL").all();
  assert.equal(rows.reduce((total, row) => total + row.amount_usd, 0), 200);
  assert.ok(rows.every(row => row.used_at === "2026-08-28" && row.redemption_method === "cash" && row.value_ratio === 0.67));
  await assert.rejects(service.addUsage({ ...correction, redemption_method: "points", request_id: "stale-redemption-value" }, { replace: true }), /another session/);
  await service.addUsage({ ...correction, expected_value_usd: 134, redemption_method: "points", request_id: "classify-points-2026" }, { replace: true });
  assert.equal((await service.dashboard({ year: 2026 })).cards[0].logged_realized_ytd_usd, 0);
  assert.equal(service.usageHistory(wallet.id, input.benefit_id)[0].redemption_method, "points");
  await assert.rejects(service.addUsage({ ...input, amount_usd: 1, redemption_method: "cash" }), /cannot exceed/);
  await assert.rejects(service.addUsage({ ...input, amount_usd: 0, revalue_existing: true, redemption_method: "cash" }), /Reclassification/);
  service.db.close();
});

test("reclassifying historical Bilt Cash preserves the redemption date, old row and audit trail", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-01" });
  const wallet = await service.addWalletCard({ catalog_slug: "bilt-palladium-card" });
  service.db.prepare("INSERT INTO benefit_usage (wallet_card_id, benefit_id, amount_usd, used_at, value_ratio) VALUES (?, ?, 200, '2026-08-28', ?)").run(wallet.id, "bilt-cash-annually", 66.67 / 200);
  const result = await service.addUsage({ wallet_card_id: wallet.id, benefit_id: "bilt-cash-annually", amount_usd: 200, expected_total_usd: 200, expected_value_usd: 66.67, used_at: "2026-10-01", redemption_method: "cash", revalue_existing: true, request_id: "historic-bilt-cash" }, { replace: true });
  assert.equal(result.before_value_usd, 66.67);
  assert.equal(result.after_value_usd, 134);
  const rows = service.db.prepare("SELECT * FROM benefit_usage ORDER BY id").all();
  assert.ok(rows[0].voided_at);
  assert.equal(rows[0].value_ratio, 66.67 / 200);
  assert.equal(rows[1].used_at, "2026-08-28");
  assert.equal(rows[1].amount_usd, 200);
  assert.equal(rows[1].value_ratio, 0.67);
  assert.equal(rows[1].redemption_method, "cash");
  service.db.close();
});

test("automatic anniversary value offsets the active membership year across January without doubling at renewal", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-10-01" });
  const wallet = await service.addWalletCard({ catalog_slug: "capital-one-venture-x-rewards-credit-card", membership_year_start: "2025-11-03" });
  const card = (await service.dashboard({ year: 2026 })).cards[0];
  assert.equal(card.automatic_realized_ytd_usd, 100);
  assert.equal(card.logged_realized_ytd_usd, 0);
  assert.equal(card.projected_net_usd, -295);
  const travel = card.benefits.find(item => item.id === "annual-capital-one-travel-credit");
  assert.equal(travel.used_usd, 0);
  assert.equal(travel.remaining_usd, 300);
  assert.equal(travel.expires_on, "2026-11-02");
  const { buildDashboard } = await import("../server/engine.mjs");
  const { loadCatalog } = await import("../server/catalog.mjs");
  const catalog = await loadCatalog(path.join(root, "catalog/cards"));
  for (const asOf of ["2026-11-02", "2026-11-03", "2026-12-31", "2027-01-01"]) {
    const renewal = buildDashboard({ db: service.db, catalog, asOf }).cards[0];
    assert.equal(renewal.automatic_realized_ytd_usd, 100, asOf);
    assert.equal(renewal.projected_net_usd, -295, asOf);
    assert.equal(service.usageHistory(wallet.id, "10-000-anniversary-miles-each-year").length, 0);
  }
  service.db.close();
});

test("November anniversary expires November 2 and partial/full logs reset on November 3", async () => {
  const service = createService({ root, dbPath: ":memory:", asOf: "2026-11-02" });
  const wallet = await service.addWalletCard({ catalog_slug: "capital-one-venture-x-rewards-credit-card", membership_year_start: "2025-11-03" });
  const benefitId = "annual-capital-one-travel-credit";
  const travel = () => service.dashboard({ year: 2026 }).then(data => data.cards[0].benefits.find(item => item.id === benefitId));
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
  let result = (await service.dashboard({ year: 2026 })).cards[0];
  assert.equal(result.automatic_realized_ytd_usd, 100);
  assert.equal(result.projected_net_usd, -295);
  assert.equal(result.benefits.find(b => b.id === "10-000-anniversary-miles-each-year").is_actionable, false);
  assert.equal(result.benefits.find(b => b.id === "annual-capital-one-travel-credit").requires_membership_year, true);
  await assert.rejects(service.addUsage({ wallet_card_id: wallet.id, benefit_id: "annual-capital-one-travel-credit", amount_usd: 300 }), /anniversary/);
  service.updateWalletCard(wallet.id, { membership_year_start: "2026-05-01", opened_on: "2024-05-01" });
  const input = { wallet_card_id: wallet.id, benefit_id: "annual-capital-one-travel-credit", used_at: "2026-10-01", amount_usd: 125 };
  await service.addUsage(input);
  result = (await service.dashboard({ year: 2026 })).cards[0];
  assert.equal(result.benefits.find(b => b.id === input.benefit_id).remaining_usd, 175);
  assert.equal(result.automatic_realized_ytd_usd, 100);
  await service.addUsage({ ...input, amount_usd: 175 });
  await assert.rejects(service.addUsage({ ...input, amount_usd: 1 }), /cannot exceed/);
  result = (await service.dashboard({ year: 2026 })).cards[0];
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
  const card = (await service.dashboard({ year: 2026 })).cards[0];
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
  assert.equal((await service.dashboard({ year: 2026 })).cards[0].logged_realized_ytd_usd, 0);
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

  const dashboard = await service.dashboard({ year: 2026 });
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
  const dashboard = await service.dashboard({ year: 2026 });
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

  const dashboard = await service.dashboard({ year: 2026 });
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
