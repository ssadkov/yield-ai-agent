"use client";

import { useEffect, useState } from "react";
import { fetchOwnerSafes, type OwnerSafes } from "@/lib/agent/ownerData";

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function aptosExplorer(address: string): string {
  return `https://explorer.aptoslabs.com/account/${encodeURIComponent(address)}?network=mainnet`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-border px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SkeletonLines() {
  return (
    <div className="mt-3 space-y-2" aria-hidden="true">
      <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
      <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export function SessionPanel({ aptosAddress }: { aptosAddress: string | null }) {
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
    <section className="panel-glass overflow-hidden rounded-2xl">
      <div className="px-4 py-3">
        <p className="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">&gt;&gt; safes</p>
        <h3 className="mt-1 text-sm font-semibold">Your vaults</h3>
        {!aptosAddress ? (
          <p className="mt-2 text-xs text-muted-foreground">Waiting for Aptos address.</p>
        ) : state.status === "loading" ? (
          <>
            <p className="sr-only">Loading Safes</p>
            <SkeletonLines />
          </>
        ) : state.status === "error" ? (
          <div className="mt-2">
            <p className="text-xs text-danger">{state.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-2 inline-flex h-8 items-center justify-center rounded-full border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Retry
            </button>
          </div>
        ) : state.data.safeAddresses.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No Safes yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {state.data.safeAddresses.map((address) => (
              <li key={address} className="flex items-start justify-between gap-2">
                <a
                  href={aptosExplorer(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-all font-mono text-xs leading-5 underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {address}
                </a>
                <CopyButton value={address} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
