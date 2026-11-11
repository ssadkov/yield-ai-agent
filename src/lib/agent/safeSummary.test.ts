// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeSafe } from "./safeSummary.ts";

const state = {
  exists: true,
  safe: "FuDCEZBgp8gxP3gafnHbUJRgGW63VAmtZwsjus1U5qSZ",
  walletUsdc: "0.776975",
  walletSolLamports: "26205140",
  idleUsdc: "2.978988",
};

test("no Kamino position: only idle USDC, nothing accrued", () => {
  const s = summarizeSafe({ owner: "o", state, position: { sharesRaw: "0", sharesDecimals: 6, principalUsdc: "0.000000" }, tokensPerShare: 1.067, performanceFeeBps: 2000 });
  assert.equal(s.kamino.valueUsdc, 0);
  assert.equal(s.accruedFeeUsdc, 0);
  assert.ok(Math.abs(s.totalUsdc - 2.978988) < 1e-9);
  assert.ok(Math.abs(s.walletSol - 0.02620514) < 1e-12);
});

test("Kamino gain over principal accrues the program's fee", () => {
  // 1,000 shares at 1.0669831 USDC/share, 1,050 USDC principal → 16.98 gain; 20% fee → 3.397.
  const s = summarizeSafe({
    owner: "o",
    state,
    position: { sharesRaw: "1000000000", sharesDecimals: 6, principalUsdc: "1050.000000" },
    tokensPerShare: 1.0669831117206271,
    performanceFeeBps: 2000,
  });
  assert.ok(Math.abs(s.kamino.valueUsdc - 1066.9831117) < 1e-6);
  assert.ok(Math.abs(s.kamino.gainUsdc - 16.9831117) < 1e-6);
  assert.ok(Math.abs(s.accruedFeeUsdc - 3.39662234) < 1e-6);
});

test("a position below its principal accrues nothing", () => {
  const s = summarizeSafe({
    owner: "o",
    state,
    position: { sharesRaw: "1000000", sharesDecimals: 6, principalUsdc: "2.000000" },
    tokensPerShare: 1.06,
    performanceFeeBps: 2000,
  });
  assert.equal(s.kamino.gainUsdc, 0);
  assert.equal(s.accruedFeeUsdc, 0);
});

test("missing Safe", () => {
  const s = summarizeSafe({ owner: "o", state: { exists: false }, position: null, tokensPerShare: 1.06, performanceFeeBps: 500 });
  assert.equal(s.exists, false);
  assert.equal(s.totalUsdc, 0);
});
