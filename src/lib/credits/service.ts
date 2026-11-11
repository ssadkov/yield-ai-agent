/**
 * Server-side credit operations shared by the routes and the NEAR AI proxy.
 */
import { computeBalance, type CreditBalance } from "./ledger.ts";
import {
  listPurchases,
  purchasedUsd,
  setUsageCost,
  spendByMonth,
  unpricedUsage,
  usageTotals,
  type Purchase,
} from "./db.ts";
import { loadSafeSummary } from "../agent/safeSummary.server.ts";
import { DEFAULT_ADVISOR_MODEL } from "../advisor/models.ts";
import { TYPICAL_REQUEST_USD } from "../advisor/aiPool.ts";

/** The wallet's AI budget from its Safe yield; 0 when the Safe cannot be read right now. */
export async function yieldBudgetUsd(wallet: string): Promise<number> {
  try {
    return (await loadSafeSummary(wallet)).accruedFeeUsdc;
  } catch {
    return 0;
  }
}

export const ONE_CLICK = "https://1click.chaindefuser.com/v0";
const SOLANA_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";

/** What a buyer may pay with. Solana assets are sent by the connected wallet; others by hand. */
export const PAYMENT_ASSETS = [
  { id: SOLANA_USDC, label: "USDC on Solana", chain: "solana", symbol: "USDC", decimals: 6 },
  { id: "nep141:sol.omft.near", label: "SOL", chain: "solana", symbol: "SOL", decimals: 9 },
  { id: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", label: "USDT on Tron", chain: "tron", symbol: "USDT", decimals: 6 },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC on Base", chain: "base", symbol: "USDC", decimals: 6 },
  { id: "nep141:base.omft.near", label: "ETH on Base", chain: "base", symbol: "ETH", decimals: 18 },
  { id: "nep141:wrap.near", label: "NEAR", chain: "near", symbol: "NEAR", decimals: 24 },
  { id: "nep141:btc.omft.near", label: "BTC", chain: "btc", symbol: "BTC", decimals: 8 },
] as const;

export function freeMonthlyUsd(): number {
  const value = Number(process.env.ADVISOR_FREE_USD_PER_MONTH ?? "0.05");
  return Number.isFinite(value) && value >= 0 ? value : 0.05;
}

/** Where purchases are paid to: USDC on Solana at `CREDITS_RECEIVER` unless configured otherwise. */
export function purchaseDestination(): { asset: string; recipient: string; decimals: number } | null {
  const recipient = process.env.CREDITS_RECEIVER?.trim();
  if (!recipient) return null;
  return { asset: process.env.CREDITS_DESTINATION_ASSET?.trim() || SOLANA_USDC, recipient, decimals: 6 };
}

/** Replace estimates with NEAR AI's billed cost for requests that have one by now. */
export async function reconcileCosts(): Promise<number> {
  const key = process.env.NEAR_AI_API_KEY?.trim();
  if (!key) return 0;
  const ids = await unpricedUsage(50);
  if (ids.length === 0) return 0;
  const response = await fetch("https://cloud-api.near.ai/v1/billing/costs", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ requestIds: ids }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return 0;
  const json = (await response.json()) as { requests?: { requestId: string; costNanoUsd: number }[] };
  let updated = 0;
  for (const row of json.requests ?? []) {
    if (Number.isFinite(row.costNanoUsd)) {
      await setUsageCost(row.requestId, row.costNanoUsd / 1e9);
      updated += 1;
    }
  }
  return updated;
}

export async function walletBalance(wallet: string): Promise<CreditBalance> {
  await reconcileCosts().catch(() => 0);
  const [purchased, spend, fromYield] = await Promise.all([
    purchasedUsd(wallet),
    spendByMonth(wallet),
    yieldBudgetUsd(wallet),
  ]);
  return computeBalance({
    freeMonthlyUsd: freeMonthlyUsd(),
    yieldUsd: fromYield,
    purchasedUsd: purchased,
    spendByMonth: spend,
    now: new Date(),
  });
}

export type ModelPrice = { model: string; inputUsdPerMillion: number; outputUsdPerMillion: number };

let priceCache: { at: number; price: ModelPrice } | null = null;

/** Public NEAR AI price of the primary advisor model (`GET /v1/models`), cached for an hour. */
export async function advisorModelPrice(): Promise<ModelPrice | null> {
  if (priceCache && Date.now() - priceCache.at < 60 * 60_000) return priceCache.price;
  try {
    const response = await fetch("https://cloud-api.near.ai/v1/models", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const json = (await response.json()) as { data?: { id: string; pricing?: { input?: number; output?: number } }[] };
    const row = json.data?.find((m) => m.id === DEFAULT_ADVISOR_MODEL);
    if (!row?.pricing?.input || !row.pricing.output) return null;
    const price = { model: row.id, inputUsdPerMillion: row.pricing.input, outputUsdPerMillion: row.pricing.output };
    priceCache = { at: Date.now(), price };
    return price;
  } catch {
    return null;
  }
}

/** What the available dollars buy on the primary model: output tokens, or typical advisor requests. */
export function estimateRemaining(availableUsd: number, price: ModelPrice | null) {
  return {
    model: price?.model ?? DEFAULT_ADVISOR_MODEL,
    outputTokens: price ? Math.floor((availableUsd / price.outputUsdPerMillion) * 1_000_000) : null,
    typicalRequests: Math.floor(availableUsd / TYPICAL_REQUEST_USD),
    typicalRequestUsd: TYPICAL_REQUEST_USD,
  };
}

export async function walletSummary(wallet: string): Promise<{
  balance: CreditBalance;
  purchases: Purchase[];
  usage: Awaited<ReturnType<typeof usageTotals>>;
  price: ModelPrice | null;
  remaining: ReturnType<typeof estimateRemaining>;
}> {
  // Billed costs first, so usage totals and the balance read the same numbers.
  await reconcileCosts().catch(() => 0);
  const [balance, purchases, usage, price] = await Promise.all([
    walletBalance(wallet),
    listPurchases(wallet),
    usageTotals(wallet),
    advisorModelPrice(),
  ]);
  return { balance, purchases, usage, price, remaining: estimateRemaining(balance.availableUsd, price) };
}
