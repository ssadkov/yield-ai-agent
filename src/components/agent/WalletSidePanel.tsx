"use client";

import { SessionPanel } from "@/components/agent/SessionPanel";
import { IntentsDepositPanel } from "@/components/agent/IntentsDepositPanel";
import { SHOW_APTOS } from "@/lib/agent/features";
import { SafePanel } from "@/components/agent/SafePanel";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletSidePanel({
  connected,
  pending,
  warnAboutHost,
  error,
  showSkeleton,
  solanaAddress,
  aptosAddress,
  aptosKind,
  solanaWalletName,
  aptosIsDerived,
  onConnectSolana,
  onConnectAptos,
}: {
  connected: boolean;
  pending: boolean;
  warnAboutHost: boolean;
  error: string | null;
  showSkeleton: boolean;
  solanaAddress: string | null;
  aptosAddress: string | null;
  aptosKind: string;
  solanaWalletName: string | null;
  aptosIsDerived: boolean;
  onConnectSolana: () => void;
  onConnectAptos: () => void;
}) {
  const showDeposit = Boolean(connected && solanaAddress);

  return (
    <div className="flex flex-col gap-3">
      {warnAboutHost ? (
        <section
          role="alert"
          className="rounded-2xl border border-warning-border bg-warning px-4 py-3 text-warning-foreground"
        >
          <p className="text-xs leading-5">
            Not on yieldai.app — Aptos address differs from production. Do not create a Safe here.
          </p>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="panel-glass rounded-2xl px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {showSkeleton ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading wallet panel">
          <section className="panel-glass overflow-hidden rounded-2xl px-4 py-3">
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </section>
          <section className="panel-glass overflow-hidden rounded-2xl px-4 py-3">
            <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-3">
              <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
              <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
              <div className="h-11 w-full animate-pulse rounded-full bg-muted" />
            </div>
          </section>
        </div>
      ) : null}

      {!connected && !showSkeleton ? (
        <section className="panel-glass overflow-hidden rounded-2xl px-4 py-5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">&gt;&gt; wallet</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight">Connect to continue</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {SHOW_APTOS
              ? "Phantom derives an Aptos account for this host. Then you can deposit USDC and talk to the advisor with your Safe in context."
              : "Connect a Solana wallet to deposit USDC into your Solana Safe and talk to the advisor with your Safe in context."}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onConnectSolana}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-[0_0_28px_-8px_var(--glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {pending ? "Connecting…" : "Connect Solana wallet"}
          </button>
          {SHOW_APTOS ? (
            <button
              type="button"
              disabled={pending}
              onClick={onConnectAptos}
              className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-full text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              I have an Aptos wallet
            </button>
          ) : null}
        </section>
      ) : null}

      {connected ? (
        <section className="panel-glass overflow-hidden rounded-2xl px-4 py-3">
          <p className="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">&gt;&gt; session</p>
          <h3 className="mt-1 text-sm font-semibold">Connected</h3>
          <dl className="mt-3 space-y-2.5">
            {solanaAddress ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {solanaWalletName ? `Solana · ${solanaWalletName}` : "Solana"}
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{truncateAddress(solanaAddress)}</dd>
              </div>
            ) : null}
            {SHOW_APTOS && aptosAddress ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Aptos · {aptosKind}
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{truncateAddress(aptosAddress)}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {SHOW_APTOS && connected ? <SessionPanel aptosAddress={aptosAddress} /> : null}

      {connected && solanaAddress ? <SafePanel /> : null}

      {showDeposit ? (
        <IntentsDepositPanel
          aptosAddress={SHOW_APTOS ? aptosAddress : null}
          aptosIsDerived={SHOW_APTOS && aptosIsDerived}
        />
      ) : null}
    </div>
  );
}
