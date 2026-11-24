import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, fetchStrategyYields, HYPERION_POOLS, normalizeAddress, USD1_METADATA, USDC_METADATA } from "./aptosStrategyYields.ts";
import { formatStrategyYieldsForTool } from "./aptosAgent.ts";

const boost = { enabled: true, rateAprPct: 3, minBalanceUsd: 99 };
const echelonPools = [
  { token: USD1_METADATA.replace("0x0", "0x"), depositApy: 10, borrowAPY: 8, borrowRewardsApr: 2 },
  { token: USDC_METADATA, depositApy: 6, borrowAPY: 7, borrowRewardsApr: 0 },
];

test("loop APR uses the Echelon spread at the agent's leverage, and Season 3 Boost is not multiplied by it", () => {
  const snap = buildSnapshot({ echelonPools, hyperionPools: [], dlpVaultApr: 0.12, btcFundingAprPct: null, aptFundingAprPct: null, boost });
  const loop = snap.strategies.find((s) => s.id === "echelon_looping");
  assert.ok(loop);
  const [usd1, usdc, dlp] = loop?.variants ?? [];
  assert.equal(usd1.baseAprPct, 10 * 4 - 6 * 3); // supply × 4 − net borrow × 3 = 22
  assert.equal(usdc.baseAprPct, 6 + (10 - 6) * 3); // 18
  assert.equal(dlp.baseAprPct, 12 + (10 - 6) * 3.2); // decimal vault APR read as 12%
  assert.equal(usd1.boostAprPct, 3);
  assert.equal(usd1.totalAprPct, 25);
  assert.equal(snap.boost.basis, "own capital");
});

test("missing feeds leave their rows n/a instead of inventing a number", () => {
  const snap = buildSnapshot({ echelonPools: [], hyperionPools: [], dlpVaultApr: null, btcFundingAprPct: null, aptFundingAprPct: null, boost: { ...boost, enabled: false } });
  for (const row of snap.strategies) for (const v of row.variants) {
    assert.equal(v.baseAprPct, null, `${row.id}/${v.key}`);
    assert.equal(v.totalAprPct, null);
    assert.equal(v.boostAprPct, 0);
  }
});

test("Hyperion pools match by address regardless of leading zeros; funding falls back from BTC to APT", () => {
  const hyperionPools = [{ id: HYPERION_POOLS.usdt_usdc.address.toUpperCase().replace("0X", "0x"), feeAPR: "4.5", farmAPR: 1 }];
  const snap = buildSnapshot({ echelonPools, hyperionPools, dlpVaultApr: null, btcFundingAprPct: null, aptFundingAprPct: 6.4, boost });
  const lp = snap.strategies.find((s) => s.id === "hyperion_lp");
  assert.equal(lp?.variants.find((v) => v.key === "usdt_usdc")?.baseAprPct, 5.5);
  const dn = snap.strategies.find((s) => s.id === "decibel_delta_neutral");
  assert.match(dn?.variants[0].label ?? "", /APT funding/);
  assert.equal(normalizeAddress("0x000ab"), "0xab");
});

test("fetching reads the main app's public APIs and the live Boost summary; the text is the tool's", async () => {
  const seen: string[] = [];
  const fake = (async (url: string) => {
    seen.push(url);
    const body = url.includes("echelon")
      ? { success: true, data: echelonPools }
      : url.includes("boost/summary")
        ? { data: { started: true, rateAprPct: 3, minBalanceUsd: 99 } }
        : url.includes("BTC")
          ? { success: true, weighted_average: { success: true, avg_yearly_apr_pct: 6.36 } }
          : { success: false };
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  const snap = await fetchStrategyYields("https://yieldai.app/", fake);
  assert.ok(seen.every((u) => u.startsWith("https://yieldai.app/api/")));
  assert.equal(seen.length, 6);
  const text = formatStrategyYieldsForTool({ success: true, data: snap }) ?? "";
  assert.match(text, /\+3% APR on eligible deposits \(owner total from \$99\), paid on own capital/);
  assert.match(text, /BTC funding \(7-day average\): base 6.36% \+ Boost 3.00% = 9.36%/);
});
