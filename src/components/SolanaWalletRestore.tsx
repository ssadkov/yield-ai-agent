"use client";

/**
 * Baseline from Yield AI `origin/main` (2026-11-02): `src/components/SolanaWalletRestore.tsx`.
 *
 * Restores the Solana wallet from localStorage key `walletName` (same key as the
 * Solana WalletProvider). When the Aptos adapter is connected to "X (Solana)",
 * this writes that source name into `walletName` and selects it, so the Solana
 * address stays in sync with the derived Aptos account.
 */

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

const STORAGE_KEY = "walletName";
const APTOS_WALLET_NAME_KEY = "AptosWalletName";
const SOLANA_SUFFIX = " (Solana)";
const SKIP_SOLANA_KEY = "skip_auto_connect_solana";

function isWalletReady(readyState: WalletReadyState): boolean {
  return readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
}

function readStoredString(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as string | null;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw.length > 0 ? raw : null;
  }
}

export function SolanaWalletRestore({ children }: { children: React.ReactNode }) {
  const { wallets, wallet, connected, select, connect } = useWallet();
  const { connected: aptosConnected, wallet: aptosWallet } = useAptosWallet();
  const hasTriggeredSelect = useRef(false);
  const hasTriggeredConnect = useRef(false);
  const prevConnected = useRef<boolean>(connected);

  // "Trust (Solana)" on the Aptos adapter → walletName "Trust".
  useEffect(() => {
    if (typeof window === "undefined" || !aptosConnected || !aptosWallet) return;

    const aptosWalletName = aptosWallet.name;
    if (!aptosWalletName || !aptosWalletName.endsWith(SOLANA_SUFFIX)) return;

    const solanaWalletName = aptosWalletName.slice(0, -SOLANA_SUFFIX.length).trim();
    if (!solanaWalletName) return;
    if (!wallets.some((w) => w.adapter.name === solanaWalletName)) return;

    try {
      const expectedValue = JSON.stringify(solanaWalletName);
      if (window.localStorage.getItem(STORAGE_KEY) !== expectedValue) {
        window.localStorage.setItem(STORAGE_KEY, expectedValue);
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, [aptosConnected, aptosWallet, wallets]);

  useEffect(() => {
    const was = prevConnected.current;
    if (was && !connected) {
      hasTriggeredSelect.current = false;
      hasTriggeredConnect.current = false;
    }
    prevConnected.current = connected;
  }, [connected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (connected && wallet?.adapter?.name) {
      try {
        const expectedValue = JSON.stringify(wallet.adapter.name);
        if (window.localStorage.getItem(STORAGE_KEY) !== expectedValue) {
          window.localStorage.setItem(STORAGE_KEY, expectedValue);
        }
        window.sessionStorage.removeItem(SKIP_SOLANA_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [connected, wallet]);

  useEffect(() => {
    if (typeof window === "undefined" || !wallet?.adapter) return;

    const checkAndSync = () => {
      if (wallet.adapter.connected && wallet.adapter.publicKey) {
        if (!window.localStorage.getItem(STORAGE_KEY)) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet.adapter.name));
        }
      }
    };

    checkAndSync();
    const t1 = setTimeout(checkAndSync, 500);
    const t2 = setTimeout(checkAndSync, 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [wallet]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SKIP_SOLANA_KEY) === "1") return;

    const adapterConnected = wallet?.adapter?.connected ?? false;
    if (connected || adapterConnected) return;

    const readSavedName = (): string | null => {
      try {
        const walletNames = new Set<string>(wallets?.map((w) => String(w.adapter.name)) ?? []);

        const fromSolana = readStoredString(window.localStorage.getItem(STORAGE_KEY));
        if (fromSolana && walletNames.has(fromSolana)) return fromSolana;

        const aptosName = readStoredString(window.localStorage.getItem(APTOS_WALLET_NAME_KEY));
        if (aptosName && aptosName.endsWith(SOLANA_SUFFIX)) {
          const solanaName = aptosName.slice(0, -SOLANA_SUFFIX.length).trim();
          if (solanaName && walletNames.has(solanaName)) return solanaName;
        }

        return null;
      } catch {
        return null;
      }
    };

    let selectCleanup: (() => void) | null = null;

    const runRestore = (): boolean => {
      if (connected || wallet?.adapter?.connected) return false;
      const savedName = readSavedName();
      if (!savedName) return false;

      const tryRestoreSelect = () => {
        if (connected || wallet?.adapter?.connected) return;
        if (!wallets?.length) return;
        if (!wallets.some((w) => w.adapter.name === savedName)) return;
        if (hasTriggeredSelect.current) return;
        hasTriggeredSelect.current = true;
        select(savedName as WalletName);
      };

      tryRestoreSelect();
      const timers = [400, 1200, 2500, 4500].map((ms) => setTimeout(tryRestoreSelect, ms));
      selectCleanup = () => timers.forEach((t) => clearTimeout(t));
      return true;
    };

    runRestore();
    const retryTimers = [100, 300, 800, 2000].map((ms) =>
      setTimeout(() => {
        if (connected || wallet?.adapter?.connected || hasTriggeredSelect.current) return;
        runRestore();
      }, ms)
    );

    return () => {
      retryTimers.forEach((t) => clearTimeout(t));
      selectCleanup?.();
    };
  }, [wallets, wallet, connected, select]);

  useEffect(() => {
    if (connected || !wallet || wallet.adapter?.connected) return;
    if (hasTriggeredConnect.current) return;

    const tryConnect = () => {
      if (connected || wallet.adapter?.connected) return false;
      if (!isWalletReady(wallet.readyState)) return false;
      hasTriggeredConnect.current = true;
      connect()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[solana-restore] connect() failed:", message);
          hasTriggeredConnect.current = false;
        });
      return true;
    };

    if (tryConnect()) return;

    const timers = [150, 400, 900, 1800, 3500].map((ms) =>
      setTimeout(() => {
        if (hasTriggeredConnect.current || connected || wallet.adapter?.connected) return;
        tryConnect();
      }, ms)
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [wallet, connected, connect]);

  return <>{children}</>;
}
