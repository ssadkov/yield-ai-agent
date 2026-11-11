// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBalance, estimateRequestUsd, monthKey, purchaseAmountUnits } from "./ledger.ts";

test("purchase amounts: any cents from $1 to $50", () => {
  assert.deepEqual(purchaseAmountUnits(1), { usd: 1, units: "1000000" });
  assert.deepEqual(purchaseAmountUnits("2.5"), { usd: 2.5, units: "2500000" });
  assert.deepEqual(purchaseAmountUnits(1.1), { usd: 1.1, units: "1100000" });
  assert.deepEqual(purchaseAmountUnits(50), { usd: 50, units: "50000000" });
  assert.equal(purchaseAmountUnits(0.99), null);
  assert.equal(purchaseAmountUnits(50.01), null);
  assert.equal(purchaseAmountUnits(1.005), null);
  assert.equal(purchaseAmountUnits("abc"), null);
  assert.equal(purchaseAmountUnits(""), null);
  assert.equal(purchaseAmountUnits(null), null);
  assert.equal(purchaseAmountUnits(Infinity), null);
});

const now = new Date("2026-11-11T10:00:00Z");

test("new wallet gets the free allowance only", () => {
  const b = computeBalance({ freeMonthlyUsd: 0.05, purchasedUsd: 0, spendByMonth: [], now });
  assert.equal(b.freeLeftUsd, 0.05);
  assert.equal(b.availableUsd, 0.05);
});

test("free allowance is used before purchased credits", () => {
  const b = computeBalance({
    freeMonthlyUsd: 0.05,
    purchasedUsd: 1,
    spendByMonth: [{ month: "2026-11", usd: 0.03 }],
    now,
  });
  assert.equal(b.purchasedLeftUsd, 1);
  assert.ok(Math.abs(b.freeLeftUsd - 0.02) < 1e-12);
  assert.ok(Math.abs(b.availableUsd - 1.02) < 1e-12);
});

test("spend above the allowance comes from purchases, each month on its own", () => {
  const b = computeBalance({
    freeMonthlyUsd: 0.05,
    purchasedUsd: 1,
    spendByMonth: [
      { month: "2026-10", usd: 0.25 },
      { month: "2026-11", usd: 0.1 },
    ],
    now,
  });
  // October: 0.20 paid; November: 0.05 paid, free allowance used up.
  assert.ok(Math.abs(b.purchasedLeftUsd - 0.75) < 1e-12);
  assert.equal(b.freeLeftUsd, 0);
  assert.ok(Math.abs(b.availableUsd - 0.75) < 1e-12);
});

test("overspent wallet has nothing available", () => {
  const b = computeBalance({ freeMonthlyUsd: 0, purchasedUsd: 0.1, spendByMonth: [{ month: "2026-11", usd: 0.2 }], now });
  assert.equal(b.availableUsd, 0);
  assert.ok(b.purchasedLeftUsd < 0);
});

test("Safe yield pays before purchased credits", () => {
  // October 0.25 spent → 0.20 above the allowance; November 0.10 → 0.05 above. 0.25 paid in total.
  const b = computeBalance({
    freeMonthlyUsd: 0.05,
    yieldUsd: 0.15,
    purchasedUsd: 1,
    spendByMonth: [
      { month: "2026-10", usd: 0.25 },
      { month: "2026-11", usd: 0.1 },
    ],
    now,
  });
  assert.equal(b.yieldLeftUsd, 0);
  assert.ok(Math.abs(b.purchasedLeftUsd - 0.9) < 1e-12);
  assert.ok(Math.abs(b.availableUsd - 0.9) < 1e-12);
});

test("unspent Safe yield adds to what is available", () => {
  const b = computeBalance({ freeMonthlyUsd: 0.05, yieldUsd: 3.4, purchasedUsd: 0, spendByMonth: [], now });
  assert.ok(Math.abs(b.availableUsd - 3.45) < 1e-12);
  assert.equal(b.yieldLeftUsd, 3.4);
});

test("helpers", () => {
  assert.equal(monthKey(now), "2026-11");
  assert.ok(Math.abs(estimateRequestUsd(900) - 0.00145) < 1e-12);
});
