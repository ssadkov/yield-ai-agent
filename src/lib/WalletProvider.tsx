"use client";

/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/lib/WalletProvider.tsx`.
 *
 * Stage 1 drops two pieces of the original:
 * - Gas Station (`transactionSubmitter`) — needed only when creating a Safe.
 * - EVM derivation (`@aptos-labs/derived-wallet-ethereum`) — Solana first.
 * Wallet errors are logged. The original showed a toast.
 */

import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { setupAutomaticSolanaWalletDerivation } from "@aptos-labs/derived-wallet-solana";
import { PropsWithChildren, useEffect, useState } from "react";
import { Network } from "@aptos-labs/ts-sdk";
import { derivedWalletChainFromName, isDerivedAptosWallet } from "./aptosWalletUtils";

function isBenignWalletError(error: unknown): boolean {
  const record = error as { name?: string; message?: string } | null;
  const name = record?.name || "";
  const message = record?.message || (typeof error === "string" ? error : String(error ?? ""));
  const lower = message.toLowerCase();
  return (
    name === "WalletNotConnectedError" ||
    name === "WalletDisconnectedError" ||
    name === "WalletNotSelectedError" ||
    name === "UnauthorizedError" ||
    message === "Unexpected error" ||
    message.includes("WalletNotConnectedError") ||
    message.includes("WalletDisconnectedError") ||
    message.includes("WalletNotSelectedError") ||
    message.includes("User has rejected the request") ||
    message.includes("User rejected") ||
    lower.includes("not been authorized by the user") ||
    lower.includes("not authorized by the user") ||
    lower.includes("requested method and/or account has not been authorized") ||
    lower.includes("unauthorized") ||
    message.includes("Unexpected error")
  );
}

export const WalletProvider = ({ children }: PropsWithChildren) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    // Registers "Phantom (Solana)" and the other derived Aptos accounts.
    // The derived address includes window.location.host and cannot be overridden.
    setupAutomaticSolanaWalletDerivation({
      defaultNetwork: Network.MAINNET,
    });

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isBenignWalletError(event.reason)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  // Wallet extensions exist only in the browser. Until then, children see the
  // adapter's default (disconnected) context.
  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <AptosWalletAdapterProvider
      autoConnect={async (_core, adapter) => {
        if (typeof window === "undefined") return true;
        // Set on disconnect so a reload does not reconnect a derived account
        // while the Solana wallet is still connected.
        if (sessionStorage.getItem("skip_auto_connect_derived_aptos") === "1") {
          if (isDerivedAptosWallet({ name: String(adapter?.name ?? "") })) return false;
        }
        // EVM derivation is not registered. If one is still in storage, do not
        // open its popup during auto-connect.
        if (derivedWalletChainFromName(adapter?.name) === "ethereum") return false;
        return true;
      }}
      dappConfig={{
        network: Network.MAINNET,
        crossChainWallets: true,
      }}
      onError={(error) => {
        const message = typeof error === "string" ? error : (error?.message ?? "Unknown wallet error");
        const name = (error as { name?: string })?.name;
        const lower = String(message).toLowerCase();
        if (
          isBenignWalletError(error) ||
          message.includes("disconnect") ||
          message.includes("Disconnect") ||
          message.includes("already connected") ||
          lower.includes("unauthorized")
        ) {
          return;
        }
        console.error("[WalletProvider]", name || message, error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
};
