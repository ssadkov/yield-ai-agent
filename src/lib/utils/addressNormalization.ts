/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/lib/utils/addressNormalization.ts`.
 *
 * Panora returns addresses with leading zeros (0x05fabd...), and some callers strip them
 * (0x5fabd...). Price maps keep both forms. Safes are queried with the canonical 64-char form.
 */

/**
 * Converts an Aptos address to canonical 64-char hex form (with leading zeros).
 * @param addr - The address (e.g. "0x3f42..." or "0x03f42...")
 * @returns "0x" + 64 hex chars, left-padded with zeros
 */
export function toCanonicalAddress(addr: string): string {
  if (!addr || !addr.startsWith("0x")) return addr;
  const hex = addr.slice(2).replace(/^0+/, "") || "0";
  return "0x" + hex.padStart(64, "0");
}

/**
 * Normalizes an Aptos address by removing leading zeros after the 0x prefix.
 * @example
 * normalizeAddress("0x05fabd1b...") // "0x5fabd1b..."
 * normalizeAddress("0x000001")      // "0x1"
 * normalizeAddress("0x0")           // "0x0"
 */
export function normalizeAddress(addr: string): string {
  if (!addr || !addr.startsWith("0x")) return addr;

  const normalized = "0x" + addr.slice(2).replace(/^0+/, "");

  return normalized === "0x" ? "0x0" : normalized;
}

/**
 * Creates a price map with both normalized and original address versions.
 */
export function createDualAddressPriceMap(
  prices: Array<{
    tokenAddress?: string | null;
    faAddress?: string | null;
    usdPrice: string;
  }>
): Record<string, string> {
  const priceMap: Record<string, string> = {};

  prices.forEach((price) => {
    const usdPrice = price.usdPrice;

    if (price.tokenAddress) {
      priceMap[price.tokenAddress] = usdPrice;
      const normalized = normalizeAddress(price.tokenAddress);
      if (normalized !== price.tokenAddress) {
        priceMap[normalized] = usdPrice;
      }
    }

    if (price.faAddress) {
      priceMap[price.faAddress] = usdPrice;
      const normalized = normalizeAddress(price.faAddress);
      if (normalized !== price.faAddress) {
        priceMap[normalized] = usdPrice;
      }
    }
  });

  return priceMap;
}

/** True when both addresses match after normalization. */
export function areAddressesEqual(addr1: string, addr2: string): boolean {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}

/**
 * Finds a token by original or normalized address.
 */
export function findTokenByAddress<
  T extends { tokenAddress?: string | null; faAddress?: string | null; usdPrice?: string },
>(tokens: T[], searchAddress: string): T | undefined {
  const normalizedSearch = normalizeAddress(searchAddress);

  return tokens.find((token) => {
    const normalizedTokenAddr = normalizeAddress(token.tokenAddress || "");
    const normalizedFaAddr = normalizeAddress(token.faAddress || "");

    return (
      token.tokenAddress === searchAddress ||
      token.faAddress === searchAddress ||
      normalizedTokenAddr === normalizedSearch ||
      normalizedFaAddr === normalizedSearch
    );
  });
}
