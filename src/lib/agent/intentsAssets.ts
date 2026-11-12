/**
 * What NEAR Intents 1-Click can take in, for Safe deposits and credit purchases, grouped by network:
 * stablecoins first, then the network's native coin. Asset ids from
 * GET https://1click.chaindefuser.com/v0/tokens (checked 2026-11-13). Solana assets are paid by the
 * connected wallet; the others are sent by hand to a one-time deposit address.
 * Logos: public/tokens/*.png from the Trust Wallet assets repo (github.com/trustwallet/assets).
 */
export type IntentsAsset = {
  id: string;
  /** "USDT on Ethereum" */
  label: string;
  /** Network id, e.g. "eth", "sol", "tron". */
  chain: string;
  symbol: string;
  decimals: number;
  logo: string;
};

export type IntentsNetwork = {
  id: string;
  label: string;
  logo: string;
  /** What a refund address looks like there. */
  addressHint: string;
  assets: IntentsAsset[];
};

export const SOLANA_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const SOLANA_SOL_ASSET = "nep141:sol.omft.near";

const LOGO = (name: string) => `/agent/tokens/${name}.png`;
const COIN_LOGO: Record<string, string> = {
  USDC: LOGO("usdc"),
  USDT: LOGO("usdt"),
  USDT0: LOGO("usdt"),
  DAI: LOGO("dai"),
  USD1: LOGO("usd1"),
  ETH: LOGO("ethereum"),
  SOL: LOGO("solana"),
  NEAR: LOGO("near"),
  BTC: LOGO("bitcoin"),
  BNB: LOGO("smartchain"),
  POL: LOGO("polygon"),
  AVAX: LOGO("avalanchec"),
};

function network(
  id: string,
  label: string,
  logo: string,
  addressHint: string,
  coins: [symbol: string, decimals: number, assetId: string][]
): IntentsNetwork {
  return {
    id,
    label,
    logo: LOGO(logo),
    addressHint,
    assets: coins.map(([symbol, decimals, assetId]) => ({
      id: assetId,
      label: `${symbol} on ${label}`,
      chain: id,
      symbol,
      decimals,
      logo: COIN_LOGO[symbol] ?? LOGO(logo),
    })),
  };
}

export const INTENTS_NETWORKS: readonly IntentsNetwork[] = [
  network("base", "Base", "base", "0x… address", [
    ["USDC", 6, "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"],
    ["ETH", 18, "nep141:base.omft.near"],
  ]),
  network("eth", "Ethereum", "ethereum", "0x… address", [
    ["USDC", 6, "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"],
    ["USDT", 6, "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near"],
    ["DAI", 18, "nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near"],
    ["USD1", 18, "nep141:eth-0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d.omft.near"],
    ["ETH", 18, "nep141:eth.omft.near"],
  ]),
  network("arb", "Arbitrum", "arbitrum", "0x… address", [
    ["USDC", 6, "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"],
    ["USDT0", 6, "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near"],
    ["ETH", 18, "nep141:arb.omft.near"],
  ]),
  network("solana", "Solana", "solana", "your connected wallet", [
    ["USDC", 6, SOLANA_USDC_ASSET],
    ["USDT", 6, "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near"],
    ["SOL", 9, SOLANA_SOL_ASSET],
  ]),
  network("tron", "Tron", "tron", "T… address", [["USDT", 6, "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near"]]),
  network("bsc", "BNB Chain", "smartchain", "0x… address", [
    ["USDT", 18, "nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near"],
    ["USDC", 18, "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near"],
    ["BNB", 18, "nep141:bnb.omdep.near"],
  ]),
  network("pol", "Polygon", "polygon", "0x… address", [
    ["USDC", 6, "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near"],
    ["USDT", 6, "nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near"],
    ["POL", 18, "nep141:pol.omdep.near"],
  ]),
  network("avax", "Avalanche", "avalanchec", "0x… address", [
    ["USDC", 6, "nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near"],
    ["USDT", 6, "nep141:avax-0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7.omdep.near"],
    ["AVAX", 18, "nep141:avax.omdep.near"],
  ]),
  network("near", "NEAR", "near", "account.near", [
    ["USDC", 6, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"],
    ["USDT", 6, "nep141:usdt.tether-token.near"],
    ["NEAR", 24, "nep141:wrap.near"],
  ]),
  network("btc", "Bitcoin", "bitcoin", "bc1… address", [["BTC", 8, "nep141:btc.omft.near"]]),
];

/** Every asset, flat; the server validates against this list. */
export const INTENTS_ASSETS: readonly IntentsAsset[] = INTENTS_NETWORKS.flatMap((n) => n.assets);

export function networkOf(assetId: string): IntentsNetwork | undefined {
  return INTENTS_NETWORKS.find((n) => n.assets.some((a) => a.id === assetId));
}

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
