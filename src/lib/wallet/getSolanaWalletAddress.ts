/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/lib/wallet/getSolanaWalletAddress.ts`.
 * Console logging from the original is omitted.
 */
import type { AdapterWallet } from "@aptos-labs/wallet-adapter-core";

/**
 * Extract the Solana public key (base58) from an Aptos cross-chain wallet, if available.
 */
export function getSolanaWalletAddress(wallet: AdapterWallet | null): string | null {
  if (!wallet) {
    return null;
  }

  const maybeDerivedWallet = wallet as unknown as {
    solanaWallet?: { publicKey?: { toBase58: () => string } };
  };

  try {
    const publicKey = maybeDerivedWallet.solanaWallet?.publicKey;
    return publicKey ? publicKey.toBase58() : null;
  } catch {
    return null;
  }
}
