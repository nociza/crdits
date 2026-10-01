import assert from "node:assert/strict";
import test from "node:test";
import { creditUsageTotal } from "../app/ui/credit-usage.ts";

test("partial credit logs add to prior use and full remaining closes the balance", () => {
  assert.equal(creditUsageTotal(125, 0, 300, "add"), 125);
  assert.equal(creditUsageTotal(50, 125, 300, "add"), 175);
  assert.equal(creditUsageTotal(125, 175, 300, "add"), 300);
  assert.throws(() => creditUsageTotal(126, 175, 300, "add"), /exceeds/);
  assert.equal(creditUsageTotal(0.2, 0.1, 0.3, "add"), 0.3);
});

test("corrections replace the total, allow zero and reject invalid amounts", () => {
  assert.equal(creditUsageTotal(50, 175, 300, "total"), 50);
  assert.equal(creditUsageTotal(0, 175, 300, "total"), 0);
  for (const value of [-1, NaN, Infinity]) assert.throws(() => creditUsageTotal(value, 0, 300, "add"), /valid/);
});
