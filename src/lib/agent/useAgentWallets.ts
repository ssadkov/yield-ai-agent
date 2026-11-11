"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletReadyState as AptosReadyState, type AdapterWallet } from "@aptos-labs/wallet-adapter-core";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState as SolanaReadyState, type WalletName } from "@solana/wallet-adapter-base";
import {
  derivedWalletChainFromName,
  derivedWalletSourceName,
  getDerivedWalletChainReliable,
  type DerivedWalletChain,
} from "@/lib/aptosWalletUtils";
import { getSolanaWalletAddress } from "@/lib/wallet/getSolanaWalletAddress";
import { SHOW_APTOS } from "@/lib/agent/features";

const SOLANA_SUFFIX = " (Solana)";

const SOLANA_ORDER = [
  "phantom",
  "solflare",
  "backpack",
  "jupiter",
  "okx wallet",
  "trust",
  "trust wallet",
  "nightly",
  "bitget wallet",
];

const APTOS_ORDER = ["petra", "nightly", "pontem wallet", "okx wallet", "backpack", "bitget wallet"];

/** Not-installed rows we still offer an install link for. Installed wallets always show. */
const SOLANA_INSTALL = new Set(["phantom", "solflare", "backpack"]);
/** Multi-chain wallets that confuse a Solana-only demo; left out of the list. */
const SOLANA_HIDDEN = new Set(["metamask"]);
const INSTALLED_DETAIL = SHOW_APTOS ? "Derives an Aptos account" : "Installed";
const APTOS_INSTALL = new Set(["petra", "nightly", "pontem wallet", "okx wallet", "backpack"]);

/** Shown when the adapter has not registered the wallet at all (no extension in this browser). */
const SOLANA_FALLBACKS: { label: string; url: string }[] = [
  { label: "Phantom", url: "https://phantom.app/download" },
  { label: "Solflare", url: "https://solflare.com/download" },
  { label: "Backpack", url: "https://backpack.app/download" },
];

function isAptosConnectSocial(name: string): boolean {
  return /^continue with\b/i.test(name);
}

export type WalletChoice = {
  /** Aptos adapter wallet name. Solana rows use "Phantom (Solana)". */
  id: string;
  label: string;
  detail: string;
  icon?: string;
  installed: boolean;
  installUrl?: string;
};

export type DialogMode = "solana" | "aptos" | null;

function readAptosAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "string") return address;
  const value = String(address);
  return value && value !== "[object Object]" ? value : null;
}

function baseKey(name: string): string {
  return derivedWalletSourceName(name).trim().toLowerCase();
}

function byPreference(order: readonly string[]) {
  return (a: WalletChoice, b: WalletChoice) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    const ra = order.indexOf(a.label.trim().toLowerCase());
    const rb = order.indexOf(b.label.trim().toLowerCase());
    const aRank = ra === -1 ? order.length : ra;
    const bRank = rb === -1 ? order.length : rb;
    return aRank - bRank || a.label.localeCompare(b.label);
  };
}

function rejectionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (
    lower.includes("reject") ||
    lower.includes("user has rejected") ||
    lower.includes("cancelled") ||
    lower.includes("canceled")
  ) {
    return "The wallet rejected the request.";
  }
  if (lower.includes("already connected")) return "";
  return message || "Could not connect the wallet.";
}

function isBenignDisconnect(error: unknown): boolean {
  const record = error as { name?: string; message?: string } | null;
  const name = record?.name ?? "";
  const message = record?.message ?? String(error ?? "");
  return (
    name === "WalletDisconnectedError" ||
    name === "WalletNotConnectedError" ||
    message.includes("WalletDisconnectedError") ||
    message.includes("WalletNotConnectedError")
  );
}

export function useAgentWallets() {
  const aptos = useAptosWallet();
  const solana = useSolanaWallet();
  const [polledSolanaAddress, setPolledSolanaAddress] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aptosAddress = aptos.connected ? readAptosAddress(aptos.account?.address) : null;
  const derivedChain: DerivedWalletChain | null = aptos.connected
    ? getDerivedWalletChainReliable(aptos.wallet) ?? derivedWalletChainFromName(aptos.wallet?.name)
    : null;

  const crossChainSolanaAddress = useMemo(
    () => getSolanaWalletAddress((aptos.wallet as AdapterWallet | null) ?? null),
    [aptos.wallet]
  );
  const directSolanaAddress =
    solana.connected && solana.publicKey ? solana.publicKey.toBase58() : null;
  const adapterSolanaAddress = solana.wallet?.adapter?.connected
    ? solana.wallet.adapter.publicKey?.toBase58() ?? null
    : null;
  const solanaAddress =
    crossChainSolanaAddress ?? directSolanaAddress ?? adapterSolanaAddress ?? polledSolanaAddress;

  useEffect(() => {
    const adapter = solana.wallet?.adapter;
    if (crossChainSolanaAddress || directSolanaAddress || adapterSolanaAddress) {
      setPolledSolanaAddress(null);
      return;
    }
    if (!adapter && !aptos.wallet) return;

    const tick = () => {
      const fromAdapter = adapter?.connected ? adapter.publicKey?.toBase58() ?? null : null;
      const fromDerived = getSolanaWalletAddress((aptos.wallet as AdapterWallet | null) ?? null);
      const next = fromDerived ?? fromAdapter;
      if (next) setPolledSolanaAddress(next);
    };

    tick();
    const interval = window.setInterval(tick, 500);
    const stop = window.setTimeout(() => window.clearInterval(interval), 10000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [
    solana.wallet,
    aptos.wallet,
    crossChainSolanaAddress,
    directSolanaAddress,
    adapterSolanaAddress,
  ]);

  const solanaChoices = useMemo(() => {
    const byId = new Map<string, WalletChoice>();
    const aptosRows = [...(aptos.wallets ?? []), ...(aptos.notDetectedWallets ?? [])];

    for (const wallet of aptosRows) {
      if (!wallet.name.endsWith(SOLANA_SUFFIX)) continue;
      const label = derivedWalletSourceName(wallet.name);
      const key = label.toLowerCase();
      if (SOLANA_HIDDEN.has(key)) continue;
      const installed = wallet.readyState === AptosReadyState.Installed;
      if (!installed && !SOLANA_INSTALL.has(key)) continue;
      byId.set(wallet.name, {
        id: wallet.name,
        label,
        detail: installed ? INSTALLED_DETAIL : "Not installed",
        icon: wallet.icon,
        installed,
        installUrl: wallet.url,
      });
    }

    const seenSolana = new Set<string>();
    for (const wallet of solana.wallets ?? []) {
      const label = wallet.adapter.name;
      const key = label.toLowerCase();
      if (seenSolana.has(key) || SOLANA_HIDDEN.has(key)) continue;
      seenSolana.add(key);
      const installed = wallet.readyState === SolanaReadyState.Installed;
      if (!installed && !SOLANA_INSTALL.has(key)) continue;
      const id = `${label}${SOLANA_SUFFIX}`;
      if (byId.has(id)) {
        const existing = byId.get(id)!;
        byId.set(id, {
          ...existing,
          icon: existing.icon || wallet.adapter.icon,
          installed: existing.installed || installed,
          detail: existing.installed || installed ? INSTALLED_DETAIL : existing.detail,
          installUrl: existing.installUrl || wallet.adapter.url,
        });
        continue;
      }
      byId.set(id, {
        id,
        label,
        detail: installed ? INSTALLED_DETAIL : "Not installed",
        icon: wallet.adapter.icon,
        installed,
        installUrl: wallet.adapter.url,
      });
    }

    for (const fallback of SOLANA_FALLBACKS) {
      const present = [...byId.values()].some((choice) => choice.label.toLowerCase() === fallback.label.toLowerCase());
      if (present) continue;
      byId.set(`${fallback.label}${SOLANA_SUFFIX}`, {
        id: `${fallback.label}${SOLANA_SUFFIX}`,
        label: fallback.label,
        detail: "Not installed",
        installed: false,
        installUrl: fallback.url,
      });
    }

    return [...byId.values()].sort(byPreference(SOLANA_ORDER));
  }, [aptos.wallets, aptos.notDetectedWallets, solana.wallets]);

  const aptosChoices = useMemo(() => {
    const rows = [...(aptos.wallets ?? []), ...(aptos.notDetectedWallets ?? [])];
    const byId = new Map<string, WalletChoice>();
    for (const wallet of rows) {
      if (derivedWalletChainFromName(wallet.name) || isAptosConnectSocial(wallet.name)) continue;
      const key = baseKey(wallet.name);
      const installed = wallet.readyState === AptosReadyState.Installed;
      if (!installed && !APTOS_INSTALL.has(key)) continue;
      if (byId.has(wallet.name)) continue;
      byId.set(wallet.name, {
        id: wallet.name,
        label: wallet.name,
        detail: installed ? "Native Aptos wallet" : "Not installed",
        icon: wallet.icon,
        installed,
        installUrl: wallet.url,
      });
    }
    return [...byId.values()].sort(byPreference(APTOS_ORDER));
  }, [aptos.wallets, aptos.notDetectedWallets]);

  const connectSolanaWallet = useCallback(
    async (aptosWalletName: string) => {
      setError(null);
      setPendingId(aptosWalletName);
      setDialog(null);
      try {
        const source = derivedWalletSourceName(aptosWalletName);
        window.sessionStorage.removeItem("skip_auto_connect_solana");
        window.sessionStorage.removeItem("skip_auto_connect_derived_aptos");

        const solanaHit = solana.wallets.some((wallet) => wallet.adapter.name === source);
        if (solanaHit) {
          window.localStorage.setItem("walletName", JSON.stringify(source));
          solana.select(source as WalletName);
          window.setTimeout(() => {
            void solana.connect().catch((connectError: unknown) => {
              const message = connectError instanceof Error ? connectError.message : String(connectError);
              if (!message.toLowerCase().includes("already connected")) {
                console.warn("[agent] solana connect:", message);
              }
            });
          }, 100);
        }

        const registered = aptos.wallets?.some((wallet) => wallet.name === aptosWalletName) ?? false;
        if (!registered) {
          throw new Error(
            `${source} is installed, but its derived Aptos account is not registered yet. Reload the page and try again.`
          );
        }
        await aptos.connect(aptosWalletName);
      } catch (connectError) {
        const message = rejectionMessage(connectError);
        if (message) setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [aptos, solana]
  );

  const connectAptosWallet = useCallback(
    async (walletName: string) => {
      setError(null);
      setPendingId(walletName);
      setDialog(null);
      try {
        window.sessionStorage.removeItem("skip_auto_connect_derived_aptos");
        await aptos.connect(walletName);
      } catch (connectError) {
        const message = rejectionMessage(connectError);
        if (message) setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [aptos]
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      window.sessionStorage.setItem("skip_auto_connect_solana", "1");
      window.sessionStorage.setItem("skip_auto_connect_derived_aptos", "1");
      window.localStorage.removeItem("AptosWalletName");
      window.localStorage.removeItem("walletName");
    } catch {
      /* ignore */
    }

    try {
      if (aptos.connected) await aptos.disconnect();
    } catch (disconnectError) {
      if (!isBenignDisconnect(disconnectError)) {
        const message = disconnectError instanceof Error ? disconnectError.message : "Could not disconnect.";
        setError(message);
      }
    }

    try {
      if (solana.connected || solana.wallet?.adapter?.connected) await solana.disconnect();
    } catch (disconnectError) {
      if (!isBenignDisconnect(disconnectError)) {
        const message = disconnectError instanceof Error ? disconnectError.message : "Could not disconnect.";
        setError(message);
      }
    }

    setPolledSolanaAddress(null);
  }, [aptos, solana]);

  const solanaWalletName =
    solana.wallet?.adapter?.name ??
    (derivedChain === "solana" && aptos.wallet?.name ? derivedWalletSourceName(aptos.wallet.name) : null);

  const walletIcon =
    solana.wallet?.adapter?.icon ??
    (derivedChain === "solana" ? aptos.wallet?.icon : undefined) ??
    aptos.wallet?.icon;

  const aptosKind =
    derivedChain === "solana"
      ? `Derived from ${solanaWalletName ?? "your Solana wallet"}`
      : derivedChain === "ethereum"
        ? `Derived from ${aptos.wallet?.name ? derivedWalletSourceName(aptos.wallet.name) : "your EVM wallet"}`
        : aptos.wallet?.name
          ? `Native · ${aptos.wallet.name}`
          : "Native";

  const connected = Boolean(aptosAddress || solanaAddress || aptos.connected || solana.connected);

  return {
    dialog,
    setDialog,
    closeDialog,
    pendingId,
    error,
    clearError: () => setError(null),
    solanaChoices,
    aptosChoices,
    connectSolanaWallet,
    connectAptosWallet,
    disconnect,
    connected,
    aptosAddress,
    solanaAddress,
    aptosKind,
    solanaWalletName,
    walletIcon,
    derivedChain,
    aptosConnected: aptos.connected,
  };
}
