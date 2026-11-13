// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STALE_MAX_MS,
  formatUsdcYieldsForPrompt,
  limitToAppRoutes,
  loadUsdcYields,
  normalizeExponent,
  normalizeKamino,
} from "./usdcYields.ts";

// Trimmed live responses from the Solana Safe API, 2026-11-10.
const KAMINO = {
  status: "available",
  strategy: "kamino_usdc",
  name: "Kamino Private Credit USDC",
  apyRatio: "0.07600044351905377",
  historicalApyRatio: { "24h": "0.0756", "7d": "0.0754", "30d": "0.07603", "90d": "0.0753", "180d": "0.0727", "365d": "0.0669" },
  source: "https://api.kamino.finance/kvaults/vaults/91b1opzHNUQobfLZxGMNYT5qDRKoqV8FdsdQBmH4wBxy/metrics",
  fetchedAt: 1794289956988,
  sourceUpdatedAt: null,
};
const EXPONENT = {
  status: "available",
  strategy: "exponent_onyc_10jan27",
  name: "Exponent PT-ONyc 10 Jan 2027",
  referenceAmountUsdc: "100",
  apyRatio: "0.1265954203284267486",
  maturity: "2027-01-10T13:00:00.000Z",
  fetchedAt: 1794289966052,
  source: "Exponent CLMM and Orca ONyc/USDC live buy quote",
  projectedNetUsdc: "102.021973",
  displayProfitFeeBps: 500,
  pilotProfitFeeBps: 0,
};
const NOW = Date.parse("2026-11-10T06:00:00.000Z");
const SOLANA = "https://solana.test";
const KAMINO_URL = `${SOLANA}/api/mobile/v1/protocols/kamino/yield?cluster=mainnet`;
const EXPONENT_URL = `${SOLANA}/api/mobile/v1/protocols/exponent/yield?cluster=mainnet`;

function fakeFetch(map: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (!(url in map)) throw new Error("HTTP 404");
    const v = map[url];
    if (v instanceof Error) throw v;
    return v;
  };
  return Object.assign(fn, { calls });
}

test("Kamino: variable APY in percent with history", () => {
  const [row] = normalizeKamino(KAMINO);
  assert.equal(row.id, "solana:kamino_usdc");
  assert.equal(row.rateType, "variable");
  assert.equal(row.ratePct, 7.6);
  assert.equal(row.maturity, null);
  assert.equal(row.daysToMaturity, null);
  assert.deepEqual(row.history, { "24h": 7.56, "7d": 7.54, "30d": 7.6, "90d": 7.53, "180d": 7.27, "365d": 6.69 });
  assert.equal(row.agentExecutable, true);
});

test("Kamino: a non-available status is an error", () => {
  assert.throws(() => normalizeKamino({ status: "unavailable" }), /status unavailable/);
});

test("Exponent: fixed APY with maturity, days left and projected payout", () => {
  const [row] = normalizeExponent(EXPONENT, NOW);
  assert.equal(row.id, "solana:exponent_onyc_10jan27");
  assert.equal(row.rateType, "fixed_to_maturity");
  assert.equal(row.ratePct, 12.66);
  assert.equal(row.maturity, "2027-01-10T13:00:00.000Z");
  assert.equal(row.daysToMaturity, 61);
  assert.deepEqual(row.projectedAtMaturity, { depositUsdc: 100, receiveUsdc: 102.021973 });
  assert.equal(row.agentExecutable, true);
  assert.ok(row.caveats.some((c) => c.includes("2027-01-10 (61 days)")));
  assert.ok(row.caveats.some((c) => c.includes("assumes a 5% profit fee; the Safe program now takes 20%")));
});

test("Exponent: a matured market is listed but not executable", () => {
  const [row] = normalizeExponent(EXPONENT, Date.parse("2027-01-10T13:00:00.000Z"));
  assert.equal(row.daysToMaturity, 0);
  assert.equal(row.agentExecutable, false);
  assert.ok(row.caveats.includes("Matured: no new purchases."));
});

test("Exponent: missing maturity is not executable", () => {
  const [row] = normalizeExponent({ ...EXPONENT, maturity: undefined }, NOW);
  assert.equal(row.maturity, null);
  assert.equal(row.agentExecutable, false);
});

test("load: Solana only by default, sorted by rate", async () => {
  const fetchJson = fakeFetch({ [KAMINO_URL]: KAMINO, [EXPONENT_URL]: EXPONENT });
  const res = await loadUsdcYields({ solanaSafeApiOrigin: SOLANA }, null, NOW, fetchJson);
  assert.deepEqual(fetchJson.calls.sort(), [EXPONENT_URL, KAMINO_URL].sort());
  assert.deepEqual(res.sources.map((s) => [s.id, s.status]), [["solana-kamino", "ok"], ["solana-exponent", "ok"]]);
  assert.deepEqual(res.rows.map((r) => r.id), ["solana:exponent_onyc_10jan27", "solana:kamino_usdc"]);
  assert.ok(res.rows.every((r) => r.chain === "solana"));
  assert.ok(!res.notes.some((n) => n.includes("APR")));
});

test("load: the Aptos source is only called when enabled", async () => {
  const fetchJson = fakeFetch({ [KAMINO_URL]: KAMINO, [EXPONENT_URL]: EXPONENT });
  const res = await loadUsdcYields(
    { solanaSafeApiOrigin: SOLANA, yieldAiApiOrigin: "https://aptos.test", includeAptos: true },
    null,
    NOW,
    fetchJson
  );
  const aptos = res.sources.find((s) => s.id === "aptos-strategies");
  assert.equal(aptos?.status, "unavailable");
  assert.equal(aptos?.error, "HTTP 404");
});

test("load: a failed source reuses its last rows as stale, then becomes unavailable", async () => {
  const first = await loadUsdcYields(
    { solanaSafeApiOrigin: SOLANA },
    null,
    NOW,
    fakeFetch({ [KAMINO_URL]: KAMINO, [EXPONENT_URL]: EXPONENT })
  );
  const failing = fakeFetch({ [KAMINO_URL]: KAMINO, [EXPONENT_URL]: new Error("timeout") });

  const later = NOW + 5 * 60_000;
  const stale = await loadUsdcYields({ solanaSafeApiOrigin: SOLANA }, first, later, failing);
  const exp = stale.sources.find((s) => s.id === "solana-exponent");
  assert.equal(exp?.status, "stale");
  assert.equal(exp?.fetchedAt, first.updatedAt);
  assert.ok(stale.rows.some((r) => r.id === "solana:exponent_onyc_10jan27"));

  const gone = await loadUsdcYields({ solanaSafeApiOrigin: SOLANA }, first, NOW + STALE_MAX_MS + 1, failing);
  assert.equal(gone.sources.find((s) => s.id === "solana-exponent")?.status, "unavailable");
  assert.ok(!gone.rows.some((r) => r.id === "solana:exponent_onyc_10jan27"));
});

test("text format: rate, maturity, payout and degraded sources", async () => {
  const res = await loadUsdcYields(
    { solanaSafeApiOrigin: SOLANA },
    null,
    NOW,
    fakeFetch({ [EXPONENT_URL]: EXPONENT })
  );
  const text = formatUsdcYieldsForPrompt(res);
  assert.match(text, /Exponent PT-ONyc 10 Jan 2027 \[solana:exponent_onyc_10jan27\]: 12\.66% APY, fixed to 2027-01-10 \(61 days left\)/);
  assert.match(text, /100 USDC -> 102\.021973 USDC at maturity/);
  assert.match(text, /Source solana-kamino is unavailable: HTTP 404\. Its rates are unknown; do not guess them\./);
});

test("this app executes only Kamino; Exponent stays for comparison", () => {
  const rows = [...normalizeKamino(KAMINO), ...normalizeExponent(EXPONENT, NOW)];
  const limited = limitToAppRoutes({ rows, sources: [] } as unknown as Parameters<typeof limitToAppRoutes>[0]);
  const byId = Object.fromEntries(limited.rows.map((r) => [r.id, r]));
  assert.equal(byId["solana:kamino_usdc"].agentExecutable, true);
  assert.equal(byId["solana:exponent_onyc_10jan27"].agentExecutable, false);
  assert.ok(byId["solana:exponent_onyc_10jan27"].caveats.some((c) => c.includes("comparison")));
  assert.equal(byId["solana:exponent_onyc_10jan27"].ratePct, rows.find((r) => r.id === "solana:exponent_onyc_10jan27")!.ratePct);
});
