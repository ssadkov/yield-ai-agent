/**
 * Derived Aptos address of a Solana wallet for a given host, and its Aptos USDC balance.
 *
 * The derived account's address depends on the host (`window.location.host`). The page
 * computes the address for the production host itself, and only trusts that computation
 * after it reproduces the address the wallet actually connected with on the current host.
 */

import { SolanaDerivedPublicKey } from "@aptos-labs/derived-wallet-solana";
import { PublicKey } from "@solana/web3.js";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

/** Same default as @aptos-labs/derived-wallet-solana 0.8.x (`defaultAuthenticationFunction`). */
export const SOLANA_AUTHENTICATION_FUNCTION = "0x1::solana_derivable_account::authenticate";
export const PRODUCTION_HOST = "yieldai.app";
/** Circle USDC fungible-asset metadata on Aptos mainnet (also the 1-Click contract address). */
export const APTOS_USDC_METADATA = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const APTOS_VIEW = "https://api.mainnet.aptoslabs.com/v1/view";

export function derivedAptosAddress(solanaAddress: string, host: string): string {
  const key = new SolanaDerivedPublicKey({
    domain: host,
    solanaPublicKey: new PublicKey(solanaAddress),
    authenticationFunction: SOLANA_AUTHENTICATION_FUNCTION,
  });
  return toCanonicalAddress(key.authKey().derivedAddress().toString());
}

export function sameAptosAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return toCanonicalAddress(a) === toCanonicalAddress(b);
  } catch {
    return false;
  }
}

/** Raw USDC (6 decimals) in the account's primary store; 0 when the store does not exist yet. */
export async function aptosUsdcRaw(address: string): Promise<bigint> {
  const response = await fetch(APTOS_VIEW, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: ["0x1::fungible_asset::Metadata"],
      arguments: [address, APTOS_USDC_METADATA],
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Aptos API HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body) || typeof body[0] !== "string") throw new Error("Unexpected Aptos API response");
  return BigInt(body[0]);
}
