/**
 * The user's Yield AI agents on Aptos, as the main app's Boost API reports them.
 *
 * `GET /api/campaigns/boost/account?owner=0x…` (yieldai.app, public) returns the owner's Safes with
 * their strategy and USD balance, plus their Boost season state. One request gives the side panel,
 * the advisor tool and the Boost allowance everything they need; no per-Safe calls.
 *
 * Kept free of `@/` imports: it runs in the browser, on the server and under plain `node --test`.
 */

export const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  stablecoin_compound: "Stablecoin compound",
  echelon_looping: "Echelon stable loop",
  hyperion_lp: "Hyperion CLMM LP",
  decibel_delta_neutral: "Decibel delta-neutral",
};

export type AptosAgentSafe = {
  safe: string;
  strategy: string;
  label: string;
  balanceUsd: number;
  boostStatus: string;
};

export type AptosAgentState = {
  owner: string;
  totalUsd: number;
  safes: AptosAgentSafe[];
  boost: {
    /** Earning the season's extra APR now. */
    eligible: boolean;
    reason: string | null;
    rateAprPct: number;
    minBalanceUsd: number;
    shortfallUsd: number;
    grainTotal: number;
    grainPerDay: number;
    paidToDateUsd: number;
    accruedUnpaidUsd: number;
    lastPayoutAt: string | null;
  };
};

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

const APTOS_ADDRESS = /^0x[0-9a-f]{1,64}$/;

export function isAptosAddress(value: string): boolean {
  return APTOS_ADDRESS.test(value.toLowerCase());
}

/** The Boost API's `data` object, or null when it is not an account answer. */
export function parseBoostAccount(json: unknown): AptosAgentState | null {
  const data = (json as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object" || typeof data.owner !== "string") return null;
  const byAgent = Array.isArray(data.byAgent) ? data.byAgent : [];
  const safes: AptosAgentSafe[] = byAgent
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.safe === "string" && isAptosAddress(row.safe))
    .map((row) => {
      const strategy = str(row.strategy) ?? "stablecoin_compound";
      return {
        safe: row.safe as string,
        strategy,
        label: STRATEGY_LABELS[strategy] ?? strategy,
        balanceUsd: num(row.balanceUsd),
        boostStatus: str(row.boostStatus) ?? "unknown",
      };
    })
    .sort((a, b) => b.balanceUsd - a.balanceUsd);
  return {
    owner: data.owner,
    totalUsd: num(data.balanceUsd, safes.reduce((sum, s) => sum + s.balanceUsd, 0)),
    safes,
    boost: {
      eligible: data.eligible === true,
      reason: str(data.reason),
      rateAprPct: num(data.rateAprPct),
      minBalanceUsd: num(data.minBalanceUsd),
      shortfallUsd: num(data.shortfallUsd),
      grainTotal: num(data.grainTotal),
      grainPerDay: num(data.grainPerDay),
      paidToDateUsd: num(data.paidToDate),
      accruedUnpaidUsd: num(data.accruedUnpaid),
      lastPayoutAt: str(data.lastPayoutAt),
    },
  };
}

/** `base` is "" in the browser (same origin as yieldai.app) or the main app's origin on the server. */
export async function fetchAptosAgent(owner: string, base = "", fetchImpl: typeof fetch = fetch): Promise<AptosAgentState | null> {
  if (!isAptosAddress(owner)) return null;
  const response = await fetchImpl(`${base}/api/campaigns/boost/account?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Boost API HTTP ${response.status}`);
  return parseBoostAccount(await response.json());
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Compact text for the advisor's tool result: numbers from the API, nothing inferred. */
export function formatAptosAgentForTool(state: AptosAgentState | null): string {
  if (!state || state.safes.length === 0) {
    return "No Yield AI agent with a balance on Aptos for this owner. Agents are created and funded on yieldai.app (AI agent → Create).";
  }
  const lines = [
    `Aptos owner ${short(state.owner)}: ${state.safes.length} Yield AI agent Safe(s), ${usd(state.totalUsd)} in total.`,
    ...state.safes.map((s) => `- ${s.label} (Safe ${short(s.safe)}): ${usd(s.balanceUsd)}; Boost ${s.boostStatus}.`),
  ];
  const b = state.boost;
  lines.push(
    b.eligible
      ? `Boost: earning +${b.rateAprPct}% APR on top of protocol APR; ${b.grainTotal.toFixed(2)} Grain accrued (${b.grainPerDay.toFixed(2)}/day), $${b.paidToDateUsd.toFixed(2)} paid to date, last payout ${b.lastPayoutAt?.slice(0, 10) ?? "none yet"}.`
      : `Boost: not earning now${b.reason ? ` (${b.reason})` : ""}${b.shortfallUsd > 0 ? `; ${usd(b.shortfallUsd)} more needed to reach the $${b.minBalanceUsd} minimum` : ""}.`
  );
  lines.push("Manage, deposit and withdraw on yieldai.app (AI agent card → Manage). This desk cannot sign Aptos transactions.");
  return lines.join("\n");
}

const pct = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(2)}%` : "n/a");

/**
 * Text for the main app's `GET /api/protocols/yield-ai/strategy-yields` answer
 * ({ success, data: { updatedAt, boost, strategies[{ id, label, risk, variants[] }] } }).
 * Null when the answer is not that shape.
 */
export function formatStrategyYieldsForTool(json: unknown): string | null {
  const data = (json as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (!data || !Array.isArray(data.strategies)) return null;
  const boost = (data.boost ?? {}) as Record<string, unknown>;
  const lines = [
    `Yield AI agent strategies on Aptos, live as of ${str(data.updatedAt) ?? "unknown time"}. APR = protocol APR + Boost; neither is guaranteed.`,
    boost.enabled === true
      ? `Boost: +${num(boost.rateAprPct)}% APR on eligible deposits (owner total from $${num(boost.minBalanceUsd)}); looped deposits get it on the supplied amount.`
      : "Boost: not running now.",
  ];
  for (const row of data.strategies as Record<string, unknown>[]) {
    const label = str(row.label) ?? STRATEGY_LABELS[str(row.id) ?? ""] ?? "Strategy";
    lines.push(`${label}: risk — ${str(row.risk) ?? "see yieldai.app"}`);
    for (const v of (Array.isArray(row.variants) ? row.variants : []) as Record<string, unknown>[]) {
      const lev = typeof v.leverage === "number" ? `, ${v.leverage}x` : "";
      lines.push(`- ${str(v.label) ?? str(v.key) ?? "variant"}${lev}: base ${pct(v.baseAprPct)} + Boost ${pct(v.boostAprPct)} = ${pct(v.totalAprPct)}`);
    }
  }
  return lines.join("\n");
}
