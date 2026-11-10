"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/agent/ThemeToggle";

function truncateAddress(address: string | null | undefined): string {
  if (!address) return "Unknown";
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm">{truncateAddress(value)}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch {
            /* ignore */
          }
        }}
        className="inline-flex h-8 shrink-0 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function AgentHeader({
  connected,
  pending,
  disconnecting,
  displayAddress,
  walletIcon,
  solanaAddress,
  aptosAddress,
  aptosKind,
  solanaWalletName,
  onConnectSolana,
  onConnectAptos,
  onDisconnect,
}: {
  connected: boolean;
  pending: boolean;
  disconnecting: boolean;
  displayAddress: string | null;
  walletIcon?: string;
  solanaAddress: string | null;
  aptosAddress: string | null;
  aptosKind: string;
  solanaWalletName: string | null;
  onConnectSolana: () => void;
  onConnectAptos: () => void;
  onDisconnect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!connected) setMenuOpen(false);
  }, [connected]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55">
      <div className="mx-auto flex h-12 w-full max-w-[1400px] items-center justify-between gap-2 px-3 sm:h-14 sm:gap-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_-6px_var(--glow)]">
            <span className="text-sm font-semibold tracking-tight">Y</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">
              Yield <span className="text-primary">AI</span>
            </h1>
            <p className="hidden font-mono text-[10px] tracking-[0.14em] text-primary/80 uppercase sm:block">
              &gt;&gt; private desk
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-border/70 bg-surface px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground md:inline-flex">
            <span className="status-dot h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            enclave://ready
          </span>

          <ThemeToggle />

          {connected ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((open) => !open)}
                className="inline-flex h-9 max-w-[9.5rem] items-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-none sm:gap-2 sm:px-3.5"
              >
                {walletIcon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={walletIcon} alt="" className="h-4 w-4 rounded-sm" />
                ) : null}
                <span className="truncate">{truncateAddress(displayAddress)}</span>
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="panel-glass absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl"
                >
                  <div className="space-y-3 divide-y divide-border px-3 py-1">
                    {solanaAddress ? (
                      <div className="py-3">
                        <CopyRow
                          label={solanaWalletName ? `Solana · ${solanaWalletName}` : "Solana"}
                          value={solanaAddress}
                        />
                      </div>
                    ) : null}
                    {aptosAddress ? (
                      <div className="py-3">
                        <CopyRow label={`Aptos · ${aptosKind}`} value={aptosAddress} />
                      </div>
                    ) : null}
                    {!solanaAddress ? (
                      <div className="py-2">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            onConnectSolana();
                          }}
                          className="inline-flex h-9 w-full items-center rounded-xl px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Connect Solana
                        </button>
                      </div>
                    ) : null}
                    {!aptosAddress ? (
                      <div className="py-2">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            onConnectAptos();
                          }}
                          className="inline-flex h-9 w-full items-center rounded-xl px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Connect Aptos
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="border-t border-border p-2">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={disconnecting}
                      onClick={() => {
                        setMenuOpen(false);
                        onDisconnect();
                      }}
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={onConnectSolana}
                className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground shadow-[0_0_28px_-8px_var(--glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 sm:px-4"
              >
                {pending ? "Connecting…" : <span className="sm:hidden">Connect</span>}
                {pending ? null : <span className="hidden sm:inline">Connect Wallet</span>}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onConnectAptos}
                className="hidden h-9 items-center px-1 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex disabled:opacity-50"
              >
                Aptos
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
