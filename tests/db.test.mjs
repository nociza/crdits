import assert from "node:assert/strict";
import test from "node:test";
import { addOffer, addWalletCard, listBenefitStatuses, listOffers, listWalletCards, openDatabase, setBenefitStatus, updateWalletCard, updateOffer, writePeriodUsage, listUsage } from "../server/db.mjs";

test("offer lifecycle retains history and excludes used offers from active recommendations", () => {
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: "test", nickname: "Test" });
  const offer = addOffer(db, { wallet_card_id: wallet.id, merchant: "Shop", title: "Offer", reward_amount_usd: 10 });
  assert.equal(updateOffer(db, offer.id, { activated: true }).activated, true);
  updateOffer(db, offer.id, { status: "used" });
  updateOffer(db, offer.id, { status: "used" });
  assert.equal(listOffers(db, { activeOn: "2026-09-12" }).length, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM offer_usage").get().n, 1);
  assert.equal(updateOffer(db, offer.id, { status: "available", title: "Corrected", reward_amount_usd: 15 }).title, "Corrected");
  assert.equal(listOffers(db).length, 1);
  db.close();
});

test("anniversary corrections preserve usage allocation across calendar years", () => {
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: "test", nickname: "Test" });
  const period = { start: "2025-11-01", end: "2026-10-31", key: "2025-anniversary" };
  const input = { wallet_card_id: wallet.id, benefit_id: "credit", amount_usd: 20, used_at: "2025-12-01", value_ratio: 0.5 };
  writePeriodUsage(db, input, period, { limit: 100 });
  writePeriodUsage(db, { ...input, amount_usd: 50, used_at: "2026-08-01", expected_total_usd: 20 }, period, { limit: 100, replace: true });
  assert.equal(listUsage(db, { end: "2025-12-31" }).reduce((n, row) => n + row.amount_usd, 0), 20);
  assert.equal(listUsage(db, { start: "2026-01-01" }).reduce((n, row) => n + row.amount_usd, 0), 30);
  db.close();
});

test("wallet and targeted offers remain in SQLite", () => {
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: "test-card", nickname: "Personal", last_four: "1234" });
  addOffer(db, { wallet_card_id: wallet.id, merchant: "Local Shop", title: "Spend $50, get $10", reward_amount_usd: 10, activated: true, expires_on: "2026-09-01" });
  assert.equal(listWalletCards(db)[0].last_four, "1234");
  assert.equal(listOffers(db, { activeOn: "2026-08-26" })[0].merchant, "Local Shop");
  assert.equal(listOffers(db, { activeOn: "2026-09-02" }).length, 0);
  updateWalletCard(db, wallet.id, { membership_year_start: "2026-05-15" });
  assert.equal(listWalletCards(db)[0].membership_year_start, "2026-05-15");
  setBenefitStatus(db, { wallet_card_id: wallet.id, benefit_id: "dashpass", status: "active", activated_on: "2026-08-26" });
  assert.deepEqual(listBenefitStatuses(db)[0], {
    wallet_card_id: wallet.id,
    benefit_id: "dashpass",
    status: "active",
    activated_on: "2026-08-26",
    note: null,
    updated_at: listBenefitStatuses(db)[0].updated_at,
  });
  db.close();
});
