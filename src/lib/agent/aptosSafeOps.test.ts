import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSafeIdle,
  fetchSafePaused,
  formatSafeHistoryForTool,
  parseSafeHistory,
  setPausedPayload,
  toRaw,
  validateAptosAction,
  VAULT_MODULE,
  WITHDRAWABLE,
  withdrawPayload,
} from "./aptosSafeOps.ts";

const A = `0x${"a".repeat(60)}1234`;
const B = `0x${"b".repeat(60)}5678`;
const safes = [
  { safe: A, label: "Echelon stable loop" },
  { safe: B, label: "Stablecoin compound" },
];

test("payloads call the vault's owner entries with the Safe and exact raw amounts", () => {
  assert.deepEqual(setPausedPayload(A, true), { function: `${VAULT_MODULE}::set_safe_paused`, typeArguments: [], functionArguments: [A, true] });
  assert.deepEqual(withdrawPayload(B, "USD1", 12_500_000n).functionArguments, [B, WITHDRAWABLE.USD1, "12500000"]);
  assert.equal(toRaw("12.5"), 12_500_000n);
  assert.equal(toRaw("0,000001"), 1n);
  for (const bad of ["", "0", "-1", "1.1234567", "1e3", "abc"]) assert.equal(toRaw(bad), null, bad);
});

test("the model's action must name exactly one of the owner's own Safes", () => {
  const short = validateAptosAction({ action: "pause", safe: `${A.slice(0, 6)}…${A.slice(-4)}` }, safes);
  assert.ok(short.ok && short.card.safe === A && short.card.label === "Echelon stable loop");
  const full = validateAptosAction({ action: "withdraw", safe: B, token: "USD1", amount: 5 }, safes);
  assert.ok(full.ok && full.card.token === "USD1" && full.card.amount === 5);
  const defaults = validateAptosAction({ action: "withdraw", safe: B, token: "DOGE" }, safes);
  assert.ok(defaults.ok && defaults.card.token === "USDC" && defaults.card.amount === undefined);
  assert.equal(validateAptosAction({ action: "pause", safe: `0x${"c".repeat(64)}` }, safes).ok, false, "someone else's Safe");
  assert.equal(validateAptosAction({ action: "pause", safe: "0x…" }, safes).ok, false, "too short to identify");
  assert.equal(validateAptosAction({ action: "drain", safe: A }, safes).ok, false);
  assert.equal(validateAptosAction({ action: "pause" }, safes).ok, false, "two Safes, none named");
  assert.equal(validateAptosAction({ action: "pause" }, [safes[0]]).ok, true, "the only Safe");
});

const history = {
  success: true,
  data: {
    totalDeposited: "1125.545641",
    totalWithdrawn: "100.000000",
    netDeposits: "1025.545641",
    totalRewards: "4.120000",
    pnlStats: { pnl: "31.25", apr: "9.87", holdingDays: 40, avgCapitalUsd: "1000", periodDays: 40 },
    entries: [
      { timestamp: "2026-10-16T05:14:36", amount: "1000.000000", assetLabel: "USDC", direction: "deposit" },
      { timestamp: "2026-11-21T05:14:36", amount: "125.545641", assetLabel: "USDC", direction: "deposit" },
      { timestamp: "2026-11-01T09:00:00", amount: "100.000000", assetLabel: "USD1", direction: "withdraw" },
    ],
  },
};

test("history becomes earned dollars, APR and the newest flows first", () => {
  const h = parseSafeHistory(history);
  assert.ok(h);
  if (!h) return;
  assert.equal(h.pnl, 31.25);
  assert.equal(h.boostPaid, 4.12);
  assert.deepEqual(h.entries.map((e) => e.date), ["2026-11-21", "2026-11-01", "2026-10-16"]);
  const text = formatSafeHistoryForTool("Echelon stable loop", A, 1056.8, h, false);
  assert.match(text, /, running: value now \$1,056.80/);
  assert.match(text, /Earned \+\$31.25 over 40 day\(s\), 9.87% APR/);
  assert.match(text, /Last flows: 2026-11-21 deposit 125.55 USDC; 2026-11-01 withdraw 100.00 USD1/);
  const loss = formatSafeHistoryForTool("x", A, 1, { ...h, pnl: -0.09 }, true);
  assert.match(loss, /PAUSED/);
  assert.match(loss, /Earned −\$0.09/);
  assert.match(formatSafeHistoryForTool("x", A, 1, { ...h, pnl: null }, null), /cannot be computed/);
  assert.equal(parseSafeHistory({ success: false }), null);
});

test("pause state and idle balances are read and summed per token", async () => {
  const view = (async () => new Response("[true]")) as unknown as typeof fetch;
  assert.equal(await fetchSafePaused(A, view), true);
  assert.equal(await fetchSafePaused("nope", view), null);
  assert.equal(await fetchSafePaused(A, (async () => new Response("err", { status: 500 })) as unknown as typeof fetch), null);
  const contents = (async () =>
    new Response(
      JSON.stringify({
        data: {
          tokens: [
            { asset_type: WITHDRAWABLE.USDC, amount: "1500000" },
            { asset_type: WITHDRAWABLE.USDC.replace("0x", "0x000"), amount: "500000" },
            { asset_type: WITHDRAWABLE.USD1, amount: "7" },
            { asset_type: "0x1::aptos_coin::AptosCoin", amount: "99" },
          ],
        },
      })
    )) as unknown as typeof fetch;
  assert.deepEqual(await fetchSafeIdle(A, "", contents), { USDC: 2_000_000n, USD1: 7n, USDt: 0n });
});
