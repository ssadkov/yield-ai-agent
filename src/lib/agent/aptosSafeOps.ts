/**
 * Owner operations and history for Yield AI Safes on Aptos.
 *
 * - Pause state: `vault::is_safe_paused`, read from an Aptos fullnode.
 * - Owner transactions this page can build: `vault::set_safe_paused(safe, bool)` and
 *   `vault::withdraw(safe, metadata, amount)` for tokens sitting idle in the Safe. The vault itself
 *   checks the signer is the Safe's owner. Closing positions (loops, LP, delta-neutral) stays on
 *   yieldai.app: those are several steps with executor limits.
 * - History and earnings: yieldai.app's `deposit-history` (deposits, withdrawals, Boost payouts,
 *   PnL = current value − net deposits, and APR over average capital).
 *
 * Kept free of `@/` imports so it runs under plain `node --test`.
 */

import { isAptosAddress } from "./aptosAgent.ts";

export const VAULT_MODULE = "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::vault";
const FULLNODE_VIEW = "https://api.mainnet.aptoslabs.com/v1/view";

/** Tokens the owner can withdraw from a Safe here: 6-decimal stablecoins, ≈ $1. */
export const WITHDRAWABLE = {
  USDC: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  USD1: "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2",
  USDt: "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
} as const;
export type WithdrawToken = keyof typeof WITHDRAWABLE;
const DECIMALS = 6;

export type EntryPayload = {
  function: `${string}::${string}::${string}`;
  typeArguments: string[];
  functionArguments: (string | boolean)[];
};

export function setPausedPayload(safe: string, paused: boolean): EntryPayload {
  return { function: `${VAULT_MODULE}::set_safe_paused`, typeArguments: [], functionArguments: [safe, paused] };
}

export function withdrawPayload(safe: string, token: WithdrawToken, amountRaw: bigint): EntryPayload {
  return { function: `${VAULT_MODULE}::withdraw`, typeArguments: [], functionArguments: [safe, WITHDRAWABLE[token], amountRaw.toString()] };
}

/** "12.5" → 12500000n; null when not a positive amount with at most 6 decimals. */
export function toRaw(amount: string): bigint | null {
  const text = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const raw = BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(fraction.padEnd(DECIMALS, "0"));
  return raw > 0n ? raw : null;
}

export function fromRaw(raw: bigint): number {
  return Number(raw) / 10 ** DECIMALS;
}

const sameAddress = (a: string, b: string) => a.toLowerCase().replace(/^0x0*/, "") === b.toLowerCase().replace(/^0x0*/, "");

export async function fetchSafePaused(safe: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  if (!isAptosAddress(safe)) return null;
  try {
    const response = await fetchImpl(FULLNODE_VIEW, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ function: `${VAULT_MODULE}::is_safe_paused`, type_arguments: [], arguments: [safe] }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const [value] = (await response.json()) as unknown[];
    return value === true || value === "true" ? true : value === false || value === "false" ? false : null;
  } catch {
    return null;
  }
}

/** Idle withdrawable stablecoins in the Safe, raw units, from yieldai.app's `safe-contents`. */
export async function fetchSafeIdle(safe: string, base = "", fetchImpl: typeof fetch = fetch): Promise<Record<WithdrawToken, bigint> | null> {
  if (!isAptosAddress(safe)) return null;
  const response = await fetchImpl(`${base}/api/protocols/yield-ai/safe-contents?safeAddress=${encodeURIComponent(safe)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const json = (await response.json()) as { data?: { tokens?: { asset_type?: unknown; amount?: unknown }[] } };
  const idle: Record<WithdrawToken, bigint> = { USDC: 0n, USD1: 0n, USDt: 0n };
  for (const token of json.data?.tokens ?? []) {
    if (typeof token.asset_type !== "string" || !/^\d+$/.test(String(token.amount))) continue;
    for (const symbol of Object.keys(WITHDRAWABLE) as WithdrawToken[]) {
      if (sameAddress(token.asset_type, WITHDRAWABLE[symbol])) idle[symbol] += BigInt(String(token.amount));
    }
  }
  return idle;
}

export type SafeHistory = {
  totalDeposited: number;
  totalWithdrawn: number;
  netDeposits: number;
  boostPaid: number;
  pnl: number | null;
  aprPct: number | null;
  holdingDays: number;
  entries: { date: string; direction: string; amount: number; asset: string }[];
};

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

export function parseSafeHistory(json: unknown): SafeHistory | null {
  const d = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!d || n(d.totalDeposited) == null) return null;
  const stats = (d.pnlStats ?? {}) as Record<string, unknown>;
  const entries = (Array.isArray(d.entries) ? d.entries : []) as Record<string, unknown>[];
  return {
    totalDeposited: n(d.totalDeposited) ?? 0,
    totalWithdrawn: n(d.totalWithdrawn) ?? 0,
    netDeposits: n(d.netDeposits) ?? 0,
    boostPaid: n(d.totalRewards) ?? 0,
    pnl: n(stats.pnl),
    aprPct: n(stats.apr),
    holdingDays: n(stats.holdingDays) ?? 0,
    entries: entries
      .map((e) => ({
        date: String(e.timestamp ?? "").slice(0, 10),
        direction: String(e.direction ?? ""),
        amount: n(e.amount) ?? 0,
        asset: String(e.assetLabel ?? "USDC"),
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** `currentValue` is the Safe's USD value now (the Boost API's balance), so PnL = value − net deposits. */
export async function fetchSafeHistory(safe: string, currentValueUsd: number, base = "", fetchImpl: typeof fetch = fetch): Promise<SafeHistory | null> {
  if (!isAptosAddress(safe)) return null;
  const params = new URLSearchParams({ safeAddress: safe, currentValue: String(currentValueUsd) });
  const response = await fetchImpl(`${base}/api/protocols/yield-ai/deposit-history?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`deposit-history HTTP ${response.status}`);
  return parseSafeHistory(await response.json());
}

const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v < 0 ? "−" : "+"}${usd(Math.abs(v))}`;

export function formatSafeHistoryForTool(label: string, safe: string, valueUsd: number, h: SafeHistory | null, paused: boolean | null): string {
  const head = `${label} (Safe ${safe.slice(0, 6)}…${safe.slice(-4)})${paused == null ? "" : paused ? ", PAUSED" : ", running"}: value now ${usd(valueUsd)}.`;
  if (!h) return `${head} History unavailable right now.`;
  const lines = [
    head,
    `Deposited ${usd(h.totalDeposited)}, withdrawn ${usd(h.totalWithdrawn)}, net ${usd(h.netDeposits)}; Boost paid into the Safe ${usd(h.boostPaid)}.`,
    h.pnl == null
      ? "Earnings: cannot be computed right now (a flow could not be priced)."
      : `Earned ${signed(h.pnl)} over ${h.holdingDays} day(s)${h.aprPct != null ? `, ${h.aprPct.toFixed(2)}% APR on average capital` : ""} (includes Boost paid into the Safe; Boost paid to the wallet is separate; unclaimed rewards and LP fees are not in the value yet).`,
  ];
  if (h.entries.length) {
    lines.push(`Last flows: ${h.entries.slice(0, 5).map((e) => `${e.date} ${e.direction} ${e.amount.toFixed(2)} ${e.asset}`).join("; ")}.`);
  }
  return lines.join("\n");
}

export type AptosActionCard = {
  action: "pause" | "resume" | "withdraw";
  safe: string;
  label: string;
  token?: WithdrawToken;
  amount?: number;
};

/**
 * Checks the model's proposal against the owner's own Safes. `safe` may be a full address or the
 * shortened "0x1234…abcd" the tools print; it must match exactly one of `safes`.
 */
export function validateAptosAction(
  args: unknown,
  safes: { safe: string; label: string }[]
): { ok: true; card: AptosActionCard } | { ok: false; error: string } {
  const r = (args ?? {}) as Record<string, unknown>;
  const action = r.action === "pause" || r.action === "resume" || r.action === "withdraw" ? r.action : null;
  if (!action) return { ok: false, error: "action must be pause, resume or withdraw." };
  const ref = String(r.safe ?? "").trim().toLowerCase();
  let matches = safes;
  if (ref) {
    const [start, end] = ref.split(/…|\.\.\./);
    matches = safes.filter((s) => {
      const addr = s.safe.toLowerCase();
      return end !== undefined ? addr.startsWith(start) && addr.endsWith(end) && start.length >= 4 && end.length >= 4 : sameAddress(addr, ref);
    });
  }
  if (matches.length !== 1) return { ok: false, error: safes.length === 0 ? "The user has no Aptos agent Safe." : "Name exactly one of the user's Safes (from get_my_aptos_agents)." };
  const card: AptosActionCard = { action, safe: matches[0].safe, label: matches[0].label };
  if (action === "withdraw") {
    const token = r.token === "USD1" || r.token === "USDt" ? r.token : "USDC";
    const amount = n(r.amount);
    card.token = token;
    if (amount != null && amount > 0) card.amount = amount;
  }
  return { ok: true, card };
}
