"use client";

/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/components/AptosWalletRestore.tsx`.
 *
 * Controlled Aptos restore from localStorage ("AptosWalletName").
 * - If the user disconnected a derived account, sessionStorage
 *   `skip_auto_connect_derived_aptos=1` blocks restoring it.
 * - Native wallets (Petra, etc.) still restore when that flag is set.
 * Derived wallets are retried: they often register after the first paint.
 */

import { useEffect, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { derivedWalletChainFromName, getAptosWalletNameFromStorage } from "@/lib/aptosWalletUtils";

const SKIP_DERIVED_KEY = "skip_auto_connect_derived_aptos";

function isDerivedName(name: string): boolean {
  return derivedWalletChainFromName(name) != null;
}

export function AptosWalletRestore({ children }: { children: React.ReactNode }) {
  const { wallets, wallet, connected, connect, isLoading } = useWallet();
  const prevConnected = useRef<boolean>(connected);
  const restoreRunId = useRef(0);

  useEffect(() => {
    const was = prevConnected.current;
    if (was && !connected) {
      restoreRunId.current += 1;
    }
    prevConnected.current = connected;
  }, [connected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (connected || isLoading) return;
    if (!wallets?.length) return;

    const stored = getAptosWalletNameFromStorage();
    if (!stored) return;

    const skipDerived = sessionStorage.getItem(SKIP_DERIVED_KEY) === "1";
    if (skipDerived && isDerivedName(stored)) return;

    const exists = wallets.some((w) => w.name === stored);
    if (!exists) return;

    const thisRun = (restoreRunId.current += 1);
    const derived = isDerivedName(stored);

    const attempt = () => {
      if (restoreRunId.current !== thisRun) return;
      if (connected || isLoading) return;
      try {
        connect(stored);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[aptos-restore] connect() threw:", message);
      }
    };

    // Native wallets: one attempt, so we don't repeat a signature prompt.
    // Derived wallets: a few retries. They usually reconnect without a prompt.
    attempt();
    const delays = derived ? [300, 900, 2000, 4500] : [800];
    const timers = delays.map((ms) => setTimeout(attempt, ms));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [connected, isLoading, wallets, connect, wallet?.name]);

  return <>{children}</>;
}
