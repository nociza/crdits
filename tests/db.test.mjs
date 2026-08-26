import assert from "node:assert/strict";
import test from "node:test";
import { addOffer, addWalletCard, listOffers, listWalletCards, openDatabase } from "../server/db.mjs";

test("wallet and targeted offers remain in SQLite", () => {
  const db = openDatabase(":memory:");
  const wallet = addWalletCard(db, { catalog_slug: "test-card", nickname: "Personal", last_four: "1234" });
  addOffer(db, { wallet_card_id: wallet.id, merchant: "Local Shop", title: "Spend $50, get $10", reward_amount_usd: 10, activated: true, expires_on: "2026-09-01" });
  assert.equal(listWalletCards(db)[0].last_four, "1234");
  assert.equal(listOffers(db, { activeOn: "2026-08-26" })[0].merchant, "Local Shop");
  assert.equal(listOffers(db, { activeOn: "2026-09-02" }).length, 0);
  db.close();
});
