"use client";

import { useEffect, useState } from "react";
import {
  fetchOwnerSafes,
  fetchWalletBalance,
  type BalanceResult,
  type OwnerSafes,
} from "@/lib/agent/ownerData";

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function aptosExplorer(address: string): string {
  return `https://explorer.aptoslabs.com/account/${encodeURIComponent(address)}?network=mainnet`;
}

function solanaExplorer(address: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied("copied");
          window.setTimeout(() => setCopied("idle"), 1500);
        } catch {
          setCopied("failed");
        }
      }}
      className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : label}
    </button>
  );
}

function AddressBlock({
  chain,
  kind,
  address,
  pending,
  explorerHref,
}: {
  chain: string;
  kind: string | null;
  address: string | null;
  pending: string;
  explorerHref: ((address: string) => string) | null;
}) {
  return (
    <div className="border-b border-border px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{chain}</h3>
        {kind ? <p className="text-xs text-muted-foreground">{kind}</p> : null}
      </div>
      {address ? (
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 break-all font-mono text-sm leading-6">{address}</p>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <CopyButton value={address} label="Copy" />
            {explorerHref ? (
              <a
                href={explorerHref(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-full border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Explorer
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{pending}</p>
      )}
    </div>
  );
}

function SkeletonLines() {
  return (
    <div className="mt-3 space-y-2" aria-hidden="true">
      <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
      <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
    </div>
  );
}

function SafesBlock({ aptosAddress }: { aptosAddress: string | null }) {
  const [state, setState] = useState<LoadState<OwnerSafes>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!aptosAddress) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchOwnerSafes(aptosAddress)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Could not load Safes.";
        setState({ status: "error", message });
      });
    return () => controller.abort();
  }, [aptosAddress, attempt]);

  return (
    <div className="border-b border-border px-5 py-4">
      <h3 className="text-sm font-semibold">Safes</h3>
      {!aptosAddress ? (
        <p className="mt-2 text-sm text-muted-foreground">Waiting for the Aptos address.</p>
      ) : state.status === "loading" ? (
        <>
          <p className="sr-only">Loading Safes</p>
          <SkeletonLines />
        </>
      ) : state.status === "error" ? (
        <div className="mt-2">
          <p className="text-sm text-danger">{state.message}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-3 inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      ) : state.data.safeAddresses.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Safes for this Aptos address.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {state.data.safeAddresses.map((address) => (
            <li key={address} className="flex items-start justify-between gap-3">
              <a
                href={aptosExplorer(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 break-all font-mono text-sm leading-6 underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {address}
              </a>
              <CopyButton value={address} label="Copy" />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">This page does not create Safes.</p>
    </div>
  );
}

function BalanceList({ title, result }: { title: string; result: BalanceResult | null }) {
  if (!result) return <SkeletonLines />;
  if (result.status === "unauthorized") {
    return <p className="mt-2 text-sm text-muted-foreground">{title}: the balance API declined the browser request.</p>;
  }
  if (result.status === "error") {
    return <p className="mt-2 text-sm text-danger">{title}: {result.message}</p>;
  }
  if (result.balance.tokens.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{title}: no tokens.</p>;
  }
  const total = result.balance.tokens.reduce((sum, token) => sum + token.valueUSD, 0);
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">
        {title}
        <span className="ml-2 font-normal text-muted-foreground">{usd.format(total)}</span>
      </p>
      <ul className="mt-1 space-y-1">
        {result.balance.tokens.slice(0, 8).map((token) => (
          <li key={`${title}-${token.symbol}-${token.name}`} className="flex justify-between gap-3 text-sm">
            <span className="truncate">
              {token.symbol}
              <span className="text-muted-foreground"> · {token.amount}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{usd.format(token.valueUSD)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BalancesBlock({
  aptosAddress,
  solanaAddress,
}: {
  aptosAddress: string | null;
  solanaAddress: string | null;
}) {
  const [aptosBalance, setAptosBalance] = useState<BalanceResult | null>(null);
  const [solanaBalance, setSolanaBalance] = useState<BalanceResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setAptosBalance(null);
    setSolanaBalance(null);
    if (aptosAddress) {
      fetchWalletBalance(aptosAddress)
        .then((result) => {
          if (!controller.signal.aborted) setAptosBalance(result);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setAptosBalance({ status: "error", message: "Could not load the Aptos balance." });
          }
        });
    }
    if (solanaAddress) {
      fetchWalletBalance(solanaAddress)
        .then((result) => {
          if (!controller.signal.aborted) setSolanaBalance(result);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSolanaBalance({ status: "error", message: "Could not load the Solana balance." });
          }
        });
    }
    return () => controller.abort();
  }, [aptosAddress, solanaAddress, attempt]);

  const bothUnauthorized =
    (!aptosAddress || aptosBalance?.status === "unauthorized") &&
    (!solanaAddress || solanaBalance?.status === "unauthorized") &&
    (aptosBalance !== null || !aptosAddress) &&
    (solanaBalance !== null || !solanaAddress);

  return (
    <div className="border-b border-border px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Balances</h3>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Refresh
        </button>
      </div>
      {bothUnauthorized ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Token balances are not available from the browser. The public API requires a key, and this page does not ship one.
        </p>
      ) : (
        <>
          {solanaAddress ? <BalanceList title="Solana" result={solanaBalance} /> : null}
          {aptosAddress ? <BalanceList title="Aptos" result={aptosBalance} /> : null}
        </>
      )}
    </div>
  );
}

export function SessionPanel({
  aptosAddress,
  solanaAddress,
  aptosKind,
  solanaWalletName,
  derived,
  onDisconnect,
  disconnecting,
}: {
  aptosAddress: string | null;
  solanaAddress: string | null;
  aptosKind: string;
  solanaWalletName: string | null;
  derived: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <AddressBlock
        chain="Solana"
        kind={solanaWalletName}
        address={solanaAddress}
        pending={derived ? "Waiting for the Solana wallet…" : "No Solana wallet connected."}
        explorerHref={solanaAddress ? solanaExplorer : null}
      />
      <AddressBlock
        chain="Aptos"
        kind={aptosAddress ? aptosKind : null}
        address={aptosAddress}
        pending={derived || solanaAddress ? "Waiting for the derived Aptos account…" : "No Aptos wallet connected."}
        explorerHref={aptosAddress ? aptosExplorer : null}
      />
      <SafesBlock aptosAddress={aptosAddress} />
      <BalancesBlock aptosAddress={aptosAddress} solanaAddress={solanaAddress} />
      <div className="px-5 py-4">
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto sm:px-5"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </section>
  );
}
