/**
 * USDC yields across the destinations a Yield AI Safe can deposit into now.
 * Server-side only: it calls the Solana Safe API (and, when enabled, the main app's API).
 *
 * This is the data the private advisor reads. Only executable destinations are listed:
 * Orca, Jupiter and leverage on Solana are not (not deployed, or not agent routes).
 * A source that fails stays in the response as `unavailable` instead of disappearing.
 *
 * Hackathon scope (2026-11-10): Solana only. The Aptos strategies source is off unless
 * `includeAptos` is set (env USDC_YIELDS_INCLUDE_APTOS=1).
 */

export type Chain = "solana" | "aptos";
export type RateType = "variable" | "fixed_to_maturity";

export type UsdcYield = {
  /** Stable id, e.g. "solana:kamino_usdc" or "solana:exponent_onyc_10jan27". */
  id: string;
  /** Which source produced the row (set by loadUsdcYields). */
  sourceId?: SourceStatus["id"];
  chain: Chain;
  /** Which Safe holds the position. */
  safe: "solana-safe" | "aptos-safe";
  venue: string;
  /** Asset the user deposits for this row. */
  depositAsset: "USDC" | "USD1";
  rateType: RateType;
  /** What `ratePct` measures. Solana sources publish APY, the Aptos strategy API APR. */
  rateKind: "APY" | "APR";
  /** Headline rate in percent. For Aptos rows this includes the Boost campaign. */
  ratePct: number | null;
  baseRatePct: number | null;
  boostPct: number | null;
  leverage: number | null;
  /** ISO time the fixed rate matures (fixed_to_maturity rows), else null. */
  maturity: string | null;
  /** Whole days left until `maturity` at response time; 0 once matured. */
  daysToMaturity: number | null;
  /** What the source's reference deposit is projected to return at maturity (USDC). */
  projectedAtMaturity: { depositUsdc: number; receiveUsdc: number } | null;
  /** Average APY over past windows when the source publishes it, in percent. */
  history: { "24h"?: number; "7d"?: number; "30d"?: number; "90d"?: number; "180d"?: number; "365d"?: number } | null;
  /** The Safe's agent can open this position within the owner's limits. False once a fixed rate has matured. */
  agentExecutable: boolean;
  risk: string;
  caveats: string[];
  source: string;
  sourceUpdatedAt: string | null;
};

export type SourceStatus = {
  id: "solana-kamino" | "solana-exponent" | "aptos-strategies";
  url: string;
  /** `stale`: this call failed, the rows are from the last good call (see `fetchedAt`). */
  status: "ok" | "stale" | "unavailable";
  error?: string;
  rows: number;
  fetchedAt: string | null;
};

export type UsdcYieldsResponse = {
  updatedAt: string;
  rows: UsdcYield[];
  sources: SourceStatus[];
  notes: string[];
};

const SOLANA_SAFE_API_ORIGIN = "https://yield-ai-solana-mainnet.vercel.app";
const YIELD_AI_API_ORIGIN = "https://yieldai.app";
/** A cold start of the Exponent quote route can take several seconds. */
const FETCH_TIMEOUT_MS = 15_000;
/** A failed source may reuse its last good rows this long, marked `stale`. */
export const STALE_MAX_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const HISTORY_KEYS = ["24h", "7d", "30d", "90d", "180d", "365d"] as const;

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pct(ratio: unknown): number | null {
  const n = num(ratio);
  return n === null ? null : round(n * 100);
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function iso(ms: unknown): string | null {
  const n = num(ms);
  return n === null ? null : new Date(n).toISOString();
}

// ------------------------------------------------------------------ normalizers (pure, testable)

/** GET {solana}/api/mobile/v1/protocols/kamino/yield?cluster=mainnet */
export function normalizeKamino(body: unknown): UsdcYield[] {
  const b = body as Record<string, unknown> | null;
  if (!b || b.status !== "available") throw new Error(`Kamino yield status ${String(b?.status ?? "missing")}`);
  const hist = (b.historicalApyRatio ?? {}) as Record<string, unknown>;
  const history: NonNullable<UsdcYield["history"]> = {};
  for (const key of HISTORY_KEYS) {
    const v = pct(hist[key]);
    if (v !== null) history[key] = v;
  }
  return [
    {
      id: `solana:${String(b.strategy ?? "kamino_usdc")}`,
      chain: "solana",
      safe: "solana-safe",
      venue: String(b.name ?? "Kamino USDC"),
      depositAsset: "USDC",
      rateType: "variable",
      rateKind: "APY",
      ratePct: pct(b.apyRatio),
      baseRatePct: pct(b.apyRatio),
      boostPct: null,
      leverage: null,
      maturity: null,
      daysToMaturity: null,
      projectedAtMaturity: null,
      history: Object.keys(history).length ? history : null,
      agentExecutable: true,
      risk: "Lending and private-credit risk of the Kamino vault; smart-contract risk. Withdrawals depend on vault liquidity.",
      caveats: [
        "Variable rate published by Kamino; it changes daily.",
        "Yield AI takes 5% of realized gain on exit; not included in the rate.",
        "Network fees not included.",
      ],
      source: String(b.source ?? "Kamino API"),
      sourceUpdatedAt: iso(b.sourceUpdatedAt) ?? iso(b.fetchedAt),
    },
  ];
}

/** GET {solana}/api/mobile/v1/protocols/exponent/yield?cluster=mainnet */
export function normalizeExponent(body: unknown, now = Date.now()): UsdcYield[] {
  const b = body as Record<string, unknown> | null;
  if (!b || b.status !== "available") throw new Error(`Exponent yield status ${String(b?.status ?? "missing")}`);
  const maturityMs = typeof b.maturity === "string" ? Date.parse(b.maturity) : NaN;
  const maturity = Number.isFinite(maturityMs) ? new Date(maturityMs).toISOString() : null;
  const matured = maturity !== null && maturityMs <= now;
  const daysToMaturity = maturity !== null ? Math.max(0, Math.floor((maturityMs - now) / DAY_MS)) : null;
  const deposit = num(b.referenceAmountUsdc);
  const receive = num(b.projectedNetUsdc);
  const feeBps = num(b.displayProfitFeeBps);
  const pilotFeeBps = num(b.pilotProfitFeeBps);
  const caveats = [
    `Indicative quote for ${deposit ?? 100} USDC at current NAV and DEX liquidity; a larger amount gets a worse price.`,
    maturity === null
      ? "Maturity unknown."
      : matured
        ? "Matured: no new purchases."
        : `Fixed rate only if held to ${maturity.slice(0, 10)} (${daysToMaturity} days); an early exit sells PT at market.`,
    feeBps !== null
      ? `Includes the projected ${feeBps / 100}% Yield AI profit fee${pilotFeeBps === 0 ? "; the pilot fee is 0%" : ""}.`
      : "Yield AI profit fee: see source.",
    "Network fees and rent not included.",
  ];
  return [
    {
      id: `solana:${String(b.strategy ?? "exponent_pt")}`,
      chain: "solana",
      safe: "solana-safe",
      venue: String(b.name ?? "Exponent PT"),
      depositAsset: "USDC",
      rateType: "fixed_to_maturity",
      rateKind: "APY",
      ratePct: pct(b.apyRatio),
      baseRatePct: pct(b.apyRatio),
      boostPct: null,
      leverage: null,
      maturity,
      daysToMaturity,
      projectedAtMaturity: deposit !== null && receive !== null ? { depositUsdc: deposit, receiveUsdc: receive } : null,
      history: null,
      agentExecutable: maturity !== null && !matured,
      risk: "Fixed rate only if held to maturity; early exit sells PT at market. ONyc (OnRe) credit and NAV risk; Orca and Exponent liquidity risk.",
      caveats,
      source: String(b.source ?? "Exponent live quote"),
      sourceUpdatedAt: iso(b.fetchedAt),
    },
  ];
}

type AptosVariant = {
  key?: unknown;
  label?: unknown;
  baseAprPct?: unknown;
  boostAprPct?: unknown;
  totalAprPct?: unknown;
  leverage?: unknown;
};
type AptosStrategy = { id?: unknown; label?: unknown; risk?: unknown; variants?: unknown };

/**
 * GET {yieldai}/api/protocols/yield-ai/strategy-yields (off by default, see the file header).
 * Shape from ssadkov/yield-ai#411: { success, data: { updatedAt, boost, strategies[] } }, APR in percent.
 */
export function normalizeAptosStrategies(body: unknown): UsdcYield[] {
  const b = body as { success?: unknown; data?: { updatedAt?: unknown; boost?: unknown; strategies?: unknown } } | null;
  if (!b || b.success !== true || !b.data || !Array.isArray(b.data.strategies)) {
    throw new Error("Unexpected strategy-yields response");
  }
  const updatedAt = typeof b.data.updatedAt === "string" ? b.data.updatedAt : null;
  const boostEnabled = Boolean((b.data.boost as { enabled?: unknown } | undefined)?.enabled);
  const rows: UsdcYield[] = [];
  for (const s of b.data.strategies as AptosStrategy[]) {
    const strategyId = String(s.id ?? "unknown");
    for (const v of Array.isArray(s.variants) ? (s.variants as AptosVariant[]) : []) {
      const key = String(v.key ?? v.label ?? "default");
      const text = `${key} ${String(v.label ?? "")}`.toLowerCase();
      const boost = num(v.boostAprPct);
      const caveats = ["Strategy APR from Yield AI; it changes with market rates."];
      if (boostEnabled && boost) caveats.push(`Includes ${round(boost)} pp Boost campaign APR; the campaign can end.`);
      if (num(v.leverage)) caveats.push(`Leveraged ${num(v.leverage)}x: liquidation risk.`);
      rows.push({
        id: `aptos:${strategyId}:${key}`,
        chain: "aptos",
        safe: "aptos-safe",
        venue: `${String(s.label ?? strategyId)} · ${String(v.label ?? key)}`,
        depositAsset: text.includes("usd1") ? "USD1" : "USDC",
        rateType: "variable",
        rateKind: "APR",
        ratePct: num(v.totalAprPct) ?? num(v.baseAprPct),
        baseRatePct: num(v.baseAprPct),
        boostPct: boost,
        leverage: num(v.leverage),
        maturity: null,
        daysToMaturity: null,
        projectedAtMaturity: null,
        history: null,
        agentExecutable: true,
        risk: String(s.risk ?? ""),
        caveats,
        source: "Yield AI strategy-yields",
        sourceUpdatedAt: updatedAt,
      });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ fetching

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "yield-ai-agent/usdc-yields" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export type UsdcYieldsEnv = {
  solanaSafeApiOrigin?: string;
  yieldAiApiOrigin?: string;
  /** Add the Aptos strategies source (off for the hackathon). */
  includeAptos?: boolean;
};

export async function loadUsdcYields(
  env: UsdcYieldsEnv = {},
  previous: UsdcYieldsResponse | null = null,
  now = Date.now(),
  fetchJson: (url: string) => Promise<unknown> = getJson
): Promise<UsdcYieldsResponse> {
  const solana = env.solanaSafeApiOrigin || SOLANA_SAFE_API_ORIGIN;
  const aptos = env.yieldAiApiOrigin || YIELD_AI_API_ORIGIN;
  const plan: { id: SourceStatus["id"]; url: string; normalize: (body: unknown) => UsdcYield[] }[] = [
    { id: "solana-kamino", url: `${solana}/api/mobile/v1/protocols/kamino/yield?cluster=mainnet`, normalize: normalizeKamino },
    {
      id: "solana-exponent",
      url: `${solana}/api/mobile/v1/protocols/exponent/yield?cluster=mainnet`,
      normalize: (b) => normalizeExponent(b, now),
    },
  ];
  if (env.includeAptos) {
    plan.push({ id: "aptos-strategies", url: `${aptos}/api/protocols/yield-ai/strategy-yields`, normalize: normalizeAptosStrategies });
  }
  const results = await Promise.allSettled(plan.map(async (p) => p.normalize(await fetchJson(p.url))));
  const rows: UsdcYield[] = [];
  const fetchedNow = new Date(now).toISOString();
  const sources: SourceStatus[] = results.map((r, i) => {
    const { id, url } = plan[i];
    if (r.status === "fulfilled") {
      rows.push(...r.value.map((row) => ({ ...row, sourceId: id })));
      return { id, url, status: "ok", rows: r.value.length, fetchedAt: fetchedNow };
    }
    const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
    const last = previous?.sources.find((src) => src.id === id && src.status !== "unavailable");
    const lastAt = last?.fetchedAt ? Date.parse(last.fetchedAt) : NaN;
    if (previous && last && now - lastAt <= STALE_MAX_MS) {
      const reused = previous.rows.filter((row) => row.sourceId === id).map((row) => withMaturityAt(row, now));
      rows.push(...reused);
      return { id, url, status: "stale", error, rows: reused.length, fetchedAt: last.fetchedAt };
    }
    return { id, url, status: "unavailable", error, rows: 0, fetchedAt: null };
  });
  rows.sort((a, b) => (b.ratePct ?? -Infinity) - (a.ratePct ?? -Infinity));
  const notes = [
    "Rates are not guaranteed. A fixed_to_maturity rate holds only to `maturity`; variable rates change daily.",
    "Only destinations a Yield AI Safe can deposit into now are listed.",
  ];
  if (rows.some((r) => r.rateKind === "APR") && rows.some((r) => r.rateKind === "APY")) {
    notes.push("Solana rows are APY, Aptos rows are APR: compare with care.");
  }
  return { updatedAt: fetchedNow, rows, sources, notes };
}

/** Recompute days left (and executability) for a reused row. */
function withMaturityAt(row: UsdcYield, now: number): UsdcYield {
  if (!row.maturity) return row;
  const ms = Date.parse(row.maturity);
  return {
    ...row,
    daysToMaturity: Math.max(0, Math.floor((ms - now) / DAY_MS)),
    agentExecutable: row.agentExecutable && ms > now,
  };
}

// ------------------------------------------------------------------ text for the model

/**
 * Compact plain text of the response for a tool result: one line per row plus source status.
 * Cheaper and less ambiguous for the model than the raw JSON.
 */
export function formatUsdcYieldsForPrompt(res: UsdcYieldsResponse): string {
  const lines = [`USDC yields for Yield AI Safes, as of ${res.updatedAt}:`];
  for (const r of res.rows) {
    const rate = r.ratePct === null ? "rate n/a" : `${r.ratePct}% ${r.rateKind}`;
    const kind =
      r.rateType === "fixed_to_maturity"
        ? `fixed to ${r.maturity?.slice(0, 10) ?? "unknown"} (${r.daysToMaturity ?? "?"} days left)`
        : "variable";
    const parts = [`- ${r.venue} [${r.id}]: ${rate}, ${kind}`];
    if (r.history?.["30d"] !== undefined) parts.push(`30d avg ${r.history["30d"]}%`);
    if (r.projectedAtMaturity) {
      parts.push(`${r.projectedAtMaturity.depositUsdc} USDC -> ${r.projectedAtMaturity.receiveUsdc} USDC at maturity`);
    }
    parts.push(r.agentExecutable ? "agent can deposit" : "not executable now");
    lines.push(`${parts.join("; ")}.`);
    lines.push(`  Risk: ${r.risk}`);
    lines.push(`  Caveats: ${r.caveats.join(" ")}`);
  }
  const degraded = res.sources.filter((s) => s.status !== "ok");
  for (const s of degraded) {
    lines.push(
      s.status === "stale"
        ? `Source ${s.id} is stale (last good ${s.fetchedAt}): ${s.error ?? ""}`
        : `Source ${s.id} is unavailable: ${s.error ?? ""}. Its rates are unknown; do not guess them.`
    );
  }
  lines.push(...res.notes.map((n) => `Note: ${n}`));
  return lines.join("\n");
}
