import assert from "node:assert/strict";
import test from "node:test";
import { availableCreditValue, cardCreditState, catalogStatus, creditActions, creditViewUrl, periodEvidenceState } from "../app/ui/credit-state.ts";

test("available-now credit value excludes entry perks and separately tracked free nights", () => {
  const benefit = {tracking_type: "spend", remaining_usd: 100, used_usd: 0, requires_membership_year: false, periods: []};
  assert.equal(availableCreditValue({benefits: [
    {...benefit, counts_toward_value: false, remaining_usd: 219},
    {...benefit, counts_toward_value: true},
    {...benefit, tracking_type: "award", counts_toward_value: true, remaining_usd: 274},
    {...benefit, tracking_type: "enrollment", counts_toward_value: false, remaining_usd: 399},
  ]}), 100);
});

const credit = { tracking_type: "spend", remaining_usd: 200, used_usd: 0, requires_membership_year: false, attention_reason: null, periods: [] };

test("reported likely use never presents as confirmed value and explicit ledger use takes precedence", () => {
  const period = { used_usd: 0, evidence: { assessment: "likely_used", note: "Partial evidence" } };
  assert.deepEqual(periodEvidenceState(period), { label: "Likely used", detail: "Not counted", unconfirmed: true });
  assert.deepEqual(periodEvidenceState({ ...period, evidence: { ...period.evidence, assessment: "not_used" } }), { label: "Not used", detail: "Reported", unconfirmed: false });
  assert.equal(periodEvidenceState({ ...period, used_usd: 10 }), null);
  assert.equal(periodEvidenceState({ used_usd: 0 }), null);
  assert.deepEqual(periodEvidenceState({ ...period, evidence: { ...period.evidence, assessment: "used" } }), { label: "Reported used", detail: "Not counted", unconfirmed: true });
});

test("catalog confirmation labels never call assumptions or legacy terms verified", () => {
  assert.equal(catalogStatus("CONFIRMED"), "Product confirmed");
  assert.equal(catalogStatus("CONFIRMED_FROM_SCREENSHOT_LABEL"), "Product identified");
  assert.equal(catalogStatus("CONFIRMED_PRODUCT_LEGACY_TERMS_UNVERIFIED"), "Legacy terms unverified");
  assert.equal(catalogStatus("ASSUMED_NEEDS_CONFIRMATION"), "Assumed product — confirm card");
  assert.equal(catalogStatus("NEEDS_CONFIRMATION"), "Product not confirmed");
});

test("availability is not a warning and unrelated enrollment does not promote a card", () => {
  assert.deepEqual(cardCreditState({ benefits: [credit] }), { available: 1, dateNeeded: 0, expiring: 0, awardAvailable: 0, awardsToTrack: 0, label: "1 credit available", warning: false, visible: true });
  const state = cardCreditState({ benefits: [{ ...credit, remaining_usd: 0, used_usd: 200 }, { ...credit, tracking_type: "enrollment" }] });
  assert.equal(state.visible, false);
  assert.equal(state.warning, false);
  assert.equal(state.label, "No credits available");
});

test("only expiring balances and missing anniversary dates produce explicit warnings", () => {
  assert.equal(cardCreditState({ benefits: [{ ...credit, attention_reason: "expiring" }] }).label, "1 credit expiring soon");
  const missing = { ...credit, remaining_usd: null, requires_membership_year: true, attention_reason: "date_needed" };
  assert.equal(cardCreditState({ benefits: [missing] }).label, "Anniversary date needed");
  assert.equal(cardCreditState({ benefits: [missing] }).visible, true);
  assert.equal(cardCreditState({ benefits: [{ ...credit, remaining_usd: 0, attention_reason: "expiring" }] }).warning, false);
});

test("zero balances have no log action but retain retrospective editing", () => {
  assert.deepEqual(creditActions(credit), { log: true, edit: false, setDate: false });
  assert.deepEqual(creditActions({ ...credit, remaining_usd: 0, used_usd: 200 }), { log: false, edit: true, setDate: false });
  assert.deepEqual(creditActions({ ...credit, remaining_usd: null, requires_membership_year: true }), { log: false, edit: false, setDate: true });
  for (const tracking_type of ["automatic", "enrollment", "reference"]) assert.deepEqual(creditActions({ ...credit, tracking_type }), { log: false, edit: false, setDate: false });
  assert.deepEqual(creditActions({ ...credit, periods: [{}], used_usd: 10 }), { log: false, edit: false, setDate: false });
});

test("view links retain the bookkeeping year but clear irrelevant card focus", () => {
  assert.equal(creditViewUrl("wallet", 2025, 6), "?tab=wallet&year=2025&card=6");
  assert.equal(creditViewUrl("catalog", 2025, 6), "?tab=catalog&year=2025");
  assert.equal(creditViewUrl("overview", 2026), "?tab=overview&year=2026");
});
