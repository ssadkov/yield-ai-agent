/**
 * Reads owner Safes and optional token balances from the Yield AI API.
 * The browser calls same-origin `/api/...` (not under the /agent base path).
 * In production that is the main app. Locally, next.config rewrites it to
 * https://yieldai.app. Checked 2026-11-02: safes respond without a key;
 * the public balance route returns 401 without one.
 */

import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

export type OwnerSafes = {
  safeAddresses: string[];
  allSafeAddresses: string[];
};

export type TokenBalance = {
  symbol: string;
  name: string;
  amount: string;
  valueUSD: number;
};

export type WalletBalance = {
  chain: string;
  tokens: TokenBalance[];
};

export type BalanceResult =
  | { status: "ready"; balance: WalletBalance }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

type SafesBody = {
  data?: {
    safeAddresses?: unknown;
    allSafeAddresses?: unknown;
  };
  error?: unknown;
};

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function asAddressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export async function fetchOwnerSafes(aptosAddress: string): Promise<OwnerSafes> {
  const owner = aptosAddress.startsWith("0x") ? toCanonicalAddress(aptosAddress) : aptosAddress;
  const response = await fetch(
    `/api/protocols/yield-ai/safes?owner=${encodeURIComponent(owner)}`,
    { cache: "no-store" }
  );
  const body = (await response.json().catch(() => null)) as SafesBody | null;
  if (!response.ok) {
    throw new Error(errorMessage(body, `Safes request failed (${response.status})`));
  }
  const safeAddresses = asAddressList(body?.data?.safeAddresses);
  const allSafeAddresses = asAddressList(body?.data?.allSafeAddresses);
  if (!body?.data || !Array.isArray(body.data.safeAddresses)) {
    throw new Error("Unexpected safes response");
  }
  return {
    safeAddresses,
    allSafeAddresses: allSafeAddresses.length > 0 ? allSafeAddresses : safeAddresses,
  };
}

function asTokens(value: unknown): TokenBalance[] {
  if (!Array.isArray(value)) return [];
  const tokens: TokenBalance[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const symbol = typeof row.symbol === "string" ? row.symbol : "";
    const amount = typeof row.amount === "string" ? row.amount : "";
    if (!symbol || !amount) continue;
    const valueUSD = typeof row.valueUSD === "number" && Number.isFinite(row.valueUSD) ? row.valueUSD : 0;
    const name = typeof row.name === "string" ? row.name : symbol;
    tokens.push({ symbol, name, amount, valueUSD });
  }
  return tokens;
}

export async function fetchWalletBalance(address: string): Promise<BalanceResult> {
  const response = await fetch(
    `/api/public/v1/wallet/${encodeURIComponent(address)}/balance`,
    { cache: "no-store" }
  );
  if (response.status === 401) return { status: "unauthorized" };
  const body = (await response.json().catch(() => null)) as
    | { chain?: unknown; tokens?: unknown; error?: unknown }
    | null;
  if (!response.ok) {
    return { status: "error", message: errorMessage(body, `Balance request failed (${response.status})`) };
  }
  return {
    status: "ready",
    balance: {
      chain: typeof body?.chain === "string" ? body.chain : "",
      tokens: asTokens(body?.tokens),
    },
  };
}
