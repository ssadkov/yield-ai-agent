// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBalance, estimateRequestUsd, monthKey } from "./ledger.ts";

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

test("helpers", () => {
  assert.equal(monthKey(now), "2026-11");
  assert.ok(Math.abs(estimateRequestUsd(900) - 0.00145) < 1e-12);
});
