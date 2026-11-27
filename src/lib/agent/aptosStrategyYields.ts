/**
 * Live APR of the Yield AI agent strategies on Aptos, for the advisor's get_aptos_strategy_yields.
 *
 * Ported from yield-ai's `strategyYields.ts` (feature/gpt-chat-panel), with the same inputs: the
 * main app's public pool, vault and funding APIs. Two changes:
 * - Boost rate and minimum are read live from `/api/campaigns/boost/summary`, not constants.
 * - Season 3 pays Boost on own capital (supply minus borrow), so leverage does not multiply it.
 *
 * Kept free of `@/` imports so it runs under plain `node --test`.
 */

export const USDC_METADATA = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
export const USD1_METADATA = "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2";
export const DECIBEL_DLP_VAULT = "0x06ad70a9a4f30349b489791e2f2bcf58363dad30e54a9d2d4095d6213d7a9bf9";

/** The pools the Hyperion LP and delta-neutral agents use (yield-ai `YIELD_AI_HYPERION_POOLS`). */
export const HYPERION_POOLS = {
  wbtc_usdc: { label: "WBTC / USDC", address: "0xa7bb8c9b3215e29a3e2c2370dcbad9c71816d385e7863170b147243724b2da58", tickSpacing: 10, referenceRangePct: 5 },
  usdt_usdc: { label: "USDt / USDC", address: "0xd3894aca06d5f42b27c89e6f448114b3ed6a1ba07f992a58b2126c71dd83c127", tickSpacing: 1, referenceRangePct: 0.05 },
} as const;

export const LEVERAGE = { usd1: 4, usdc: 4, dlp: 4.2 } as const;
const LP_HEDGE_RANGE_PCT = 10;
const SHORT_NOTIONAL_SHARE = 0.5;

const RISK: Record<string, string> = {
  stablecoin_compound: "Lending, smart-contract, reward and peg risk; principal stays in USDC/USD1 on Echelon.",
  echelon_looping: "Leverage, liquidation, borrow-rate and depeg risk; health-factor gates; reducing or closing is manual.",
  hyperion_lp: "Divergence loss; out of range earns no fees; volatile legs can lose USDC value.",
  decibel_delta_neutral: "Funding can flip; spread and execution risk; opening and closing is manual.",
};

export type EchelonPool = { token?: string; depositApy?: number; borrowAPY?: number; borrowRewardsApr?: number };
export type HyperionPool = { id?: string; feeAPR?: string | number; farmAPR?: string | number; currentTick?: number | string; pool?: { poolId?: string; currentTick?: number | string } };

export type Variant = { key: string; label: string; baseAprPct: number | null; boostAprPct: number; totalAprPct: number | null; leverage?: number };
export type StrategyRow = { id: string; label: string; risk: string; variants: Variant[] };
export type StrategyYieldsSnapshot = {
  updatedAt: string;
  boost: { enabled: boolean; rateAprPct: number; minBalanceUsd: number; basis: "own capital" };
  strategies: StrategyRow[];
  /** Feeds that did not answer; their rows are n/a. */
  missing: string[];
};

export type Inputs = {
  echelonPools: EchelonPool[];
  hyperionPools: HyperionPool[];
  dlpVaultApr: number | null;
  btcFundingAprPct: number | null;
  aptFundingAprPct: number | null;
  boost: { enabled: boolean; rateAprPct: number; minBalanceUsd: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** 0x-prefixed, lowercase, no leading zeros: how the pool feeds and our constants compare. */
export function normalizeAddress(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
  return `0x${hex || "0"}`;
}

function variant(key: string, label: string, base: number | null, boost: Inputs["boost"], leverage?: number): Variant {
  const boostAprPct = boost.enabled ? round2(boost.rateAprPct) : 0;
  const baseAprPct = finite(base) ? round2(base) : null;
  return {
    key,
    label,
    baseAprPct,
    boostAprPct,
    totalAprPct: baseAprPct == null ? null : round2(baseAprPct + boostAprPct),
    ...(leverage != null ? { leverage } : {}),
  };
}

function echelonRates(pools: EchelonPool[], token: string): { supplyApr: number; netBorrowApr: number } | null {
  const target = normalizeAddress(token);
  const pool = pools.find((p) => p.token && normalizeAddress(p.token) === target);
  if (!pool) return null;
  const supplyApr = Number(pool.depositApy ?? 0);
  const netBorrowApr = Math.max(0, Number(pool.borrowAPY ?? 0) - Number(pool.borrowRewardsApr ?? 0));
  return Number.isFinite(supplyApr) && Number.isFinite(netBorrowApr) ? { supplyApr, netBorrowApr } : null;
}

/** DLP vault APR may come as a decimal (0.12) or in percent (12). */
export function vaultAprPct(apr: number): number {
  return Math.abs(apr) <= 1 ? apr * 100 : apr;
}

function hyperionPool(pools: HyperionPool[], address: string): HyperionPool | undefined {
  const target = normalizeAddress(address);
  return pools.find((p) => {
    const id = p.id ?? p.pool?.poolId;
    return id ? normalizeAddress(id) === target : false;
  });
}

const parsePct = (v: unknown) => parseFloat(String(v ?? "0")) || 0;

// Range-adjusted CLMM APR (yield-ai `hyperionRangeApr.ts`): the reported APR ≈ a ±reference band;
// the fee side scales with the chosen band's concentration relative to it, clamped; farm stays flat.
function concentration(current: number, lower: number, upper: number): number | null {
  const sp = Math.pow(1.0001, current / 2);
  const denom = 2 * sp - Math.pow(1.0001, lower / 2) - (sp * sp) / Math.pow(1.0001, upper / 2);
  if (!(denom > 0)) return null;
  const m = (2 * sp) / denom;
  return Number.isFinite(m) && m > 0 ? m : null;
}
const halfWidthTicks = (pct: number) => Math.log(1 + Math.max(0.01, pct) / 100) / Math.log(1.0001);

export function rangeAdjustedAprPct(p: { feeAprPct: number; farmAprPct: number; currentTick: number; rangePct: number; referenceRangePct: number; tickSpacing: number }): number | null {
  if (!Number.isFinite(p.currentTick) || !(p.rangePct > 0) || !(p.referenceRangePct > 0)) return null;
  const snap = (t: number) => Math.round(t / p.tickSpacing) * p.tickSpacing;
  const band = (pct: number) => concentration(p.currentTick, snap(p.currentTick - halfWidthTicks(pct)), snap(p.currentTick + halfWidthTicks(pct)));
  const conc = band(p.rangePct);
  const ref = band(p.referenceRangePct);
  const ratio = conc && ref ? Math.min(4, Math.max(0.3, conc / ref)) : 1;
  return p.feeAprPct * ratio + p.farmAprPct;
}

export function buildSnapshot(input: Inputs, now = new Date(), missing: string[] = []): StrategyYieldsSnapshot {
  const { boost } = input;
  const supplyApr = (token: string) => {
    const pool = input.echelonPools.find((p) => p.token && normalizeAddress(p.token) === normalizeAddress(token));
    return finite(pool?.depositApy) ? pool.depositApy : null;
  };

  const usd1 = echelonRates(input.echelonPools, USD1_METADATA);
  const usdc = echelonRates(input.echelonPools, USDC_METADATA);
  const dlp = finite(input.dlpVaultApr) ? vaultAprPct(input.dlpVaultApr) : null;
  const usd1Spread = usd1 ? usd1.supplyApr - usd1.netBorrowApr : null;

  const lpVariants = (Object.keys(HYPERION_POOLS) as (keyof typeof HYPERION_POOLS)[]).map((key) => {
    const pool = hyperionPool(input.hyperionPools, HYPERION_POOLS[key].address);
    return variant(key, HYPERION_POOLS[key].label, pool ? parsePct(pool.feeAPR) + parsePct(pool.farmAPR) : null, boost);
  });

  const funding = finite(input.btcFundingAprPct)
    ? { market: "BTC", apr: input.btcFundingAprPct }
    : finite(input.aptFundingAprPct)
      ? { market: "APT", apr: input.aptFundingAprPct }
      : null;
  let hedge: number | null = null;
  const wbtc = hyperionPool(input.hyperionPools, HYPERION_POOLS.wbtc_usdc.address);
  const tick = Number(wbtc?.pool?.currentTick ?? wbtc?.currentTick);
  if (wbtc && finite(input.btcFundingAprPct) && Number.isFinite(tick)) {
    const lp = rangeAdjustedAprPct({
      feeAprPct: parsePct(wbtc.feeAPR),
      farmAprPct: parsePct(wbtc.farmAPR),
      currentTick: tick,
      rangePct: LP_HEDGE_RANGE_PCT,
      referenceRangePct: HYPERION_POOLS.wbtc_usdc.referenceRangePct,
      tickSpacing: HYPERION_POOLS.wbtc_usdc.tickSpacing,
    });
    if (lp != null) hedge = (lp + input.btcFundingAprPct * SHORT_NOTIONAL_SHARE) / (1 + SHORT_NOTIONAL_SHARE);
  }

  const strategies: StrategyRow[] = [
    {
      id: "stablecoin_compound",
      label: "Stablecoin compound",
      risk: RISK.stablecoin_compound,
      variants: [variant("usdc", "USDC market", supplyApr(USDC_METADATA), boost), variant("usd1", "USD1 market", supplyApr(USD1_METADATA), boost)],
    },
    {
      id: "echelon_looping",
      label: "Echelon stable loop",
      risk: RISK.echelon_looping,
      variants: [
        variant("usd1", "USD1 / USD1", usd1 ? usd1.supplyApr * LEVERAGE.usd1 - usd1.netBorrowApr * (LEVERAGE.usd1 - 1) : null, boost, LEVERAGE.usd1),
        variant("usdc", "USDC / USD1", usdc && usd1Spread != null ? usdc.supplyApr + usd1Spread * (LEVERAGE.usdc - 1) : null, boost, LEVERAGE.usdc),
        variant("dlp", "DLP / USD1", dlp != null && usd1Spread != null ? dlp + usd1Spread * (LEVERAGE.dlp - 1) : null, boost, LEVERAGE.dlp),
      ],
    },
    { id: "hyperion_lp", label: "Hyperion CLMM LP", risk: RISK.hyperion_lp, variants: lpVariants },
    {
      id: "decibel_delta_neutral",
      label: "Decibel delta-neutral",
      risk: RISK.decibel_delta_neutral,
      variants: [
        variant("funding", funding ? `${funding.market} funding (7-day average)` : "Funding", funding?.apr ?? null, boost),
        variant("wbtc-hedge", "WBTC/USDC LP + short hedge", hedge, boost),
      ],
    },
  ];

  return {
    updatedAt: now.toISOString(),
    boost: { enabled: boost.enabled, rateAprPct: boost.rateAprPct, minBalanceUsd: boost.minBalanceUsd, basis: "own capital" },
    strategies,
    missing,
  };
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T | null> {
  try {
    const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Reads the main app's public APIs at `origin` and builds the snapshot; a missing feed leaves its rows n/a. */
export async function fetchStrategyYields(origin: string, fetchImpl: typeof fetch = fetch): Promise<StrategyYieldsSnapshot> {
  const api = `${origin.replace(/\/$/, "")}/api`;
  type Funding = { success?: boolean; weighted_average?: { success?: boolean; avg_yearly_apr_pct?: number } };
  const [echelon, hyperion, vault, btc, apt, summary] = await Promise.all([
    getJson<{ success?: boolean; data?: EchelonPool[] }>(fetchImpl, `${api}/protocols/echelon/v2/pools`),
    getJson<{ success?: boolean; data?: HyperionPool[] }>(fetchImpl, `${api}/protocols/hyperion/pools`),
    getJson<{ success?: boolean; data?: { items?: { apr?: unknown }[] } }>(fetchImpl, `${api}/protocols/decibel/vaults?vault_address=${DECIBEL_DLP_VAULT}&limit=1`),
    getJson<Funding>(fetchImpl, `${api}/protocols/decibel/funding?market_name=${encodeURIComponent("BTC/USD")}&window=7d`),
    getJson<Funding>(fetchImpl, `${api}/protocols/decibel/funding?market_name=${encodeURIComponent("APT/USD")}&window=7d`),
    getJson<{ data?: { started?: boolean; rateAprPct?: number; minBalanceUsd?: number } }>(fetchImpl, `${api}/campaigns/boost/summary`),
  ]);
  const fundingPct = (f: Funding | null) => {
    const v = f?.weighted_average?.avg_yearly_apr_pct;
    return f?.success && f.weighted_average?.success && finite(v) ? v : null;
  };
  const vaultApr = Number(vault?.data?.items?.[0]?.apr);
  const s = summary?.data;
  const missing = [
    [echelon?.success, "Echelon pools"],
    [hyperion?.success, "Hyperion pools"],
    [vault?.success, "Decibel DLP vault"],
    [btc?.success || apt?.success, "Decibel funding"],
    [s, "Boost summary"],
  ]
    .filter(([ok]) => !ok)
    .map(([, name]) => name as string);
  return buildSnapshot({
    echelonPools: echelon?.success && Array.isArray(echelon.data) ? echelon.data : [],
    hyperionPools: hyperion?.success && Array.isArray(hyperion.data) ? hyperion.data : [],
    dlpVaultApr: vault?.success && Number.isFinite(vaultApr) ? vaultApr : null,
    btcFundingAprPct: fundingPct(btc),
    aptFundingAprPct: fundingPct(apt),
    boost: {
      enabled: s?.started === true && finite(s.rateAprPct) && s.rateAprPct > 0,
      rateAprPct: finite(s?.rateAprPct) ? s.rateAprPct : 0,
      minBalanceUsd: finite(s?.minBalanceUsd) ? s.minBalanceUsd : 0,
    },
  }, new Date(), missing);
}
