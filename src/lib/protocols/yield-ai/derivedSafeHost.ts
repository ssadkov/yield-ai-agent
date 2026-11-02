/**
 * Baseline from Yield AI `origin/main` (2026-11-02):
 * `src/lib/protocols/yield-ai/derivedSafeHost.ts`.
 *
 * Host rules for creating a Safe from a DERIVED Aptos wallet.
 *
 * A Solana (or EVM) wallet controls an Aptos account derived from the page's
 * host: `@aptos-labs/derived-wallet-*` sets `domain = window.location.host`
 * and offers no way to override it. The same Phantom key is a different Aptos
 * account on `yieldai.app`, on `localhost:3000`, and on every preview URL.
 *
 * A Safe belongs to the account that called `init_vault_v2`. A Safe created
 * from another host is owned by an account its owner can only sign for from
 * that exact host.
 *
 * None of this applies to a native Aptos wallet (Petra etc.): its address is
 * the same on every host. Reading an existing Safe is not gated.
 *
 * Stage 1 of this repo does not create Safes. The page still uses
 * `CANONICAL_DERIVED_SAFE_HOST` for the host warning.
 */

/** The production host. Changing it changes every derived account — don't. */
export const CANONICAL_DERIVED_SAFE_HOST = "yieldai.app";

/**
 * Extra hosts, comma-separated, for deliberately testing creation on a preview.
 * Opt-in per deployment so it cannot happen by accident.
 */
const EXTRA_HOSTS_ENV = process.env.NEXT_PUBLIC_DERIVED_SAFE_HOSTS ?? "";

function allowedHosts(): string[] {
  const extra = EXTRA_HOSTS_ENV.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  // Local development derives from a fixed localhost origin, so for the
  // developer running it the address is as stable as production.
  const dev = process.env.NODE_ENV === "development" ? ["localhost:3000"] : [];
  return [CANONICAL_DERIVED_SAFE_HOST, ...dev, ...extra];
}

/**
 * Whether this page may create a Safe for the connected wallet.
 *
 * `isDerivedWallet` must come from the wallet adapter (`isDerivedAptosWalletReliable`),
 * not from guessing: a native wallet is allowed everywhere, a derived one only
 * on a host whose derived addresses we commit to keeping.
 */
export function canCreateSafeForWallet(params: {
  isDerivedWallet: boolean;
  /** Defaults to the current page's host. */
  host?: string | null;
}): boolean {
  if (!params.isDerivedWallet) return true;
  const current = (params.host ?? (typeof window === "undefined" ? "" : window.location.host))
    .trim()
    .toLowerCase();
  if (!current) return false;
  return allowedHosts().includes(current);
}

/** Message for the UI when a derived wallet may not create a Safe here. */
export function derivedSafeHostHint(): string {
  return `A Safe can only be created on ${CANONICAL_DERIVED_SAFE_HOST}. Your Aptos address is derived from the site's domain, so a Safe created here would be unreachable from the main site.`;
}
