/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/lib/aptosWalletUtils.ts`.
 * EVM helpers stay so a name ending in " (Ethereum)" is never treated as a native Aptos wallet.
 * This app does not register EVM derivation.
 */

const SOLANA_SUFFIX = " (Solana)";
/** `@aptos-labs/derived-wallet-ethereum` names its wallets `${EIP-6963 name} (Ethereum)`. */
const ETHEREUM_SUFFIX = " (Ethereum)";
const APTOS_WALLET_NAME_KEY = "AptosWalletName";

/** The chain whose wallet controls a derived Aptos account. */
export type DerivedWalletChain = "solana" | "ethereum";

/**
 * Derived Aptos wallets are created from Solana wallets (e.g. Trust, Phantom) or EVM wallets
 * (MetaMask, Rabby) and are named "WalletName (Solana)" / "WalletName (Ethereum)". Native Aptos
 * wallets (Petra, etc.) carry no suffix. The adapter may or may not set isAptosNativeWallet; we
 * determine by name for consistency.
 */
export function derivedWalletChainFromName(name: string | null | undefined): DerivedWalletChain | null {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (trimmed.endsWith(SOLANA_SUFFIX)) return "solana";
  if (trimmed.endsWith(ETHEREUM_SUFFIX)) return "ethereum";
  return null;
}

/** "Phantom (Solana)" → "Phantom", "MetaMask (Ethereum)" → "MetaMask"; other names unchanged. */
export function derivedWalletSourceName(name: string): string {
  return name.replace(/\s*\((Solana|Ethereum)\)\s*$/, "");
}

/** Any derived Aptos wallet — Solana- or EVM-derived. */
export function isDerivedAptosWallet(
  wallet: { name?: string } | null | undefined
): boolean {
  return derivedWalletChainFromName(wallet?.name) != null;
}

/**
 * Returns the stored Aptos wallet name from localStorage (what the adapter/user selected).
 * Used as source of truth for derived vs native: "X (Solana)" / "X (Ethereum)" = derived.
 */
export function getAptosWalletNameFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APTOS_WALLET_NAME_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as string | null;
      return typeof parsed === "string" ? parsed : null;
    } catch {
      // The adapter stores a plain string, not JSON.
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    }
  } catch {
    return null;
  }
}

/**
 * Reliable source chain of a derived wallet: localStorage AptosWalletName first (adapter writes it
 * on connect). If stored → its suffix decides (none = native). Else fallback to wallet.name.
 */
export function getDerivedWalletChainReliable(
  wallet: { name?: string } | null | undefined
): DerivedWalletChain | null {
  const stored = getAptosWalletNameFromStorage();
  if (stored != null && stored !== "") return derivedWalletChainFromName(stored);
  return derivedWalletChainFromName(wallet?.name);
}

/** Reliable derived vs native, for either source chain (see getDerivedWalletChainReliable). */
export function isDerivedAptosWalletReliable(
  wallet: { name?: string } | null | undefined
): boolean {
  return getDerivedWalletChainReliable(wallet) != null;
}

/** Derived from a Solana wallet specifically — for Solana-only behaviour. */
export function isSolanaDerivedAptosWalletReliable(
  wallet: { name?: string } | null | undefined
): boolean {
  return getDerivedWalletChainReliable(wallet) === "solana";
}

/** Derived from an EVM wallet (`@aptos-labs/derived-wallet-ethereum`). */
export function isEvmDerivedAptosWalletReliable(
  wallet: { name?: string } | null | undefined
): boolean {
  return getDerivedWalletChainReliable(wallet) === "ethereum";
}

type EvmAccountsProvider = {
  request: (args: { method: string }) => Promise<unknown>;
  on?: (event: "accountsChanged", listener: () => void) => void;
  removeListener?: (event: "accountsChanged", listener: () => void) => void;
};

/** The EVM wallet inside `@aptos-labs/derived-wallet-ethereum`'s wallet, or null for any other wallet. */
export function evmProviderOfDerivedWallet(wallet: unknown): EvmAccountsProvider | null {
  return (wallet as { eip1193Provider?: EvmAccountsProvider } | null | undefined)?.eip1193Provider ?? null;
}

/** Whether the EVM wallet would hand over an address without a popup: eth_accounts never prompts, and is empty while locked. */
export async function hasSilentEvmAccount(wallet: unknown): Promise<boolean> {
  try {
    const accounts = await evmProviderOfDerivedWallet(wallet)?.request({ method: "eth_accounts" });
    return Array.isArray(accounts) && accounts.length > 0;
  } catch {
    return false;
  }
}
