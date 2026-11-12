/**
 * What NEAR Intents 1-Click can take in, for Safe deposits and credit purchases: asset ids from
 * GET https://1click.chaindefuser.com/v0/tokens (checked 2026-11-11). Solana assets are paid by the
 * connected wallet; the others are sent by hand to a one-time deposit address.
 */
export type IntentsAsset = { id: string; label: string; chain: string; symbol: string; decimals: number };

export const SOLANA_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const SOLANA_SOL_ASSET = "nep141:sol.omft.near";

export const INTENTS_ASSETS: readonly IntentsAsset[] = [
  { id: SOLANA_USDC_ASSET, label: "USDC on Solana", chain: "solana", symbol: "USDC", decimals: 6 },
  { id: SOLANA_SOL_ASSET, label: "SOL", chain: "solana", symbol: "SOL", decimals: 9 },
  { id: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", label: "USDT on Tron", chain: "tron", symbol: "USDT", decimals: 6 },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC on Base", chain: "base", symbol: "USDC", decimals: 6 },
  { id: "nep141:base.omft.near", label: "ETH on Base", chain: "base", symbol: "ETH", decimals: 18 },
  { id: "nep141:wrap.near", label: "NEAR", chain: "near", symbol: "NEAR", decimals: 24 },
  { id: "nep141:btc.omft.near", label: "BTC", chain: "btc", symbol: "BTC", decimals: 8 },
];

/** "12.5" in a token's base units, exactly; null for anything that is not a positive decimal it can hold. */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  const text = amount.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) return null;
  const raw = BigInt(whole + fraction.padEnd(decimals, "0"));
  return raw > BigInt(0) ? raw : null;
}
