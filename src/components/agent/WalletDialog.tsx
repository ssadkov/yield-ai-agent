"use client";

import { useEffect, useRef } from "react";
import type { WalletChoice } from "@/lib/agent/useAgentWallets";

type WalletDialogProps = {
  open: boolean;
  title: string;
  description: string;
  wallets: WalletChoice[];
  pendingId: string | null;
  onClose: () => void;
  onConnect: (id: string) => void;
};

export function WalletDialog({
  open,
  title,
  description,
  wallets,
  pendingId,
  onClose,
  onConnect,
}: WalletDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = () =>
      [...node.querySelectorAll<HTMLElement>("button, a[href]")].filter((element) => !element.hasAttribute("disabled"));

    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-foreground/40"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
        className="panel-glass relative flex max-h-[min(88dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-t-[24px] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="wallet-dialog-title" className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto px-3 py-3">
          {wallets.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              No wallet found. Install Phantom or Solflare, then reload this page.
            </p>
          ) : (
            wallets.map((wallet) => (
              <div
                key={wallet.id}
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
              >
                {wallet.icon ? (
                  <img src={wallet.icon} alt="" className="h-8 w-8 shrink-0 rounded-md" />
                ) : (
                  <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-md bg-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{wallet.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{wallet.detail}</span>
                </span>
                {wallet.installed ? (
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => onConnect(wallet.id)}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {pendingId === wallet.id ? "Connecting…" : "Connect"}
                  </button>
                ) : wallet.installUrl ? (
                  <a
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Install
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
