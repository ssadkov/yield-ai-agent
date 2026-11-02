"use client";

/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/lib/SolanaProvider.tsx`.
 * The RPC endpoint is the public mainnet URL (see solanaRpcEndpoint.ts), not the
 * main app's same-origin proxy.
 */

import { WalletProvider as SolanaWalletProvider, ConnectionProvider } from "@solana/wallet-adapter-react";
import { useMemo, type ReactNode } from "react";
import { getPublicSolanaRpcEndpoint, PUBLIC_SOLANA_WS_ENDPOINT } from "@/lib/solanaRpcEndpoint";

const WALLET_NAME_KEY = "walletName";

/** Normalize walletName to valid JSON so the adapter's JSON.parse() does not throw. */
function normalizeWalletNameStorage() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(WALLET_NAME_KEY);
    if (raw == null || raw === "") return;
    JSON.parse(raw);
  } catch {
    const raw = window.localStorage.getItem(WALLET_NAME_KEY);
    if (raw != null && raw !== "") {
      window.localStorage.setItem(WALLET_NAME_KEY, JSON.stringify(raw));
    }
  }
}

export function SolanaProvider({ children }: { children: ReactNode }) {
  normalizeWalletNameStorage();

  const endpoint = useMemo(() => getPublicSolanaRpcEndpoint(), []);
  const connectionConfig = useMemo(
    () => ({ commitment: "confirmed" as const, wsEndpoint: PUBLIC_SOLANA_WS_ENDPOINT }),
    []
  );

  // Phantom, Solflare, Backpack, Trust and OKX register as Wallet Standard
  // wallets. The original provider also constructed Coinbase, Torus and Ledger.
  // Those adapters pull WalletConnect into this page, and stage 1 does not need them.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect
        localStorageKey="walletName"
        onError={(error) => {
          const name = (error as { name?: string })?.name;
          const message = (error as { message?: string })?.message ?? String(error ?? "");
          const lower = message.toLowerCase();
          if (
            name === "UnauthorizedError" ||
            name === "WalletDisconnectedError" ||
            name === "WalletNotConnectedError" ||
            name === "WalletNotSelectedError" ||
            lower.includes("not been authorized by the user") ||
            lower.includes("not authorized by the user") ||
            lower.includes("requested method and/or account has not been authorized")
          ) {
            return;
          }
          console.error("[SolanaProvider]", name || message, error);
        }}
      >
        {children}
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
