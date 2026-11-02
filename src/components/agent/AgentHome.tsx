"use client";

import { useEffect, useState } from "react";
import { CANONICAL_DERIVED_SAFE_HOST } from "@/lib/protocols/yield-ai/derivedSafeHost";
import { useAgentWallets } from "@/lib/agent/useAgentWallets";
import { SessionPanel } from "@/components/agent/SessionPanel";
import { WalletDialog } from "@/components/agent/WalletDialog";

function usePageHost(): string | null {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    setHost(window.location.host);
  }, []);
  return host;
}

export function AgentHome() {
  const session = useAgentWallets();
  const host = usePageHost();
  const [disconnecting, setDisconnecting] = useState(false);
  const hostKnown = host !== null;
  const onProduction = host?.toLowerCase() === CANONICAL_DERIVED_SAFE_HOST;
  const nativeOnOtherHost = Boolean(session.aptosAddress) && session.derivedChain == null;
  const warnAboutHost = hostKnown && !onProduction && !nativeOnOtherHost;

  const closeDialog = session.closeDialog;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-12 sm:py-16">
      <header>
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Yield AI</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Agent</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Connect a Solana wallet. The same adapter as on yieldai.app derives an Aptos account for this site.
        </p>
      </header>

      <section
        aria-label="Site host"
        className={
          warnAboutHost
            ? "rounded-2xl border border-warning-border bg-warning px-5 py-4 text-warning-foreground"
            : "rounded-2xl border border-border bg-card px-5 py-4"
        }
      >
        <p className="text-sm">
          Host{" "}
          <span className="font-mono">{host ?? "…"}</span>
        </p>
        {host && !onProduction && !nativeOnOtherHost ? (
          <p role="alert" className="mt-2 text-sm leading-6">
            The Aptos address on this host is different from production. Do not create a Safe here.
          </p>
        ) : null}
        {host && !onProduction && nativeOnOtherHost ? (
          <p className="mt-2 text-sm leading-6">
            This native Aptos address is the same on every host. This page still does not create a Safe.
          </p>
        ) : null}
        {onProduction ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Production host. A derived Aptos address here matches yieldai.app.
          </p>
        ) : null}
      </section>

      {session.error ? (
        <p role="alert" className="rounded-2xl border border-border bg-card px-5 py-4 text-sm text-danger">
          {session.error}
        </p>
      ) : null}

      {session.connected ? (
        <SessionPanel
          aptosAddress={session.aptosAddress}
          solanaAddress={session.solanaAddress}
          aptosKind={session.aptosKind}
          solanaWalletName={session.solanaWalletName}
          derived={session.derivedChain != null || Boolean(session.solanaAddress)}
          disconnecting={disconnecting}
          onDisconnect={() => {
            setDisconnecting(true);
            void session.disconnect().finally(() => setDisconnecting(false));
          }}
        />
      ) : (
        <section className="rounded-2xl border border-border bg-card px-5 py-5">
          <button
            type="button"
            disabled={session.pendingId !== null}
            onClick={() => session.setDialog("solana")}
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-primary px-5 text-base font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {session.pendingId ? "Connecting…" : "Connect Solana wallet"}
          </button>
          <button
            type="button"
            disabled={session.pendingId !== null}
            onClick={() => session.setDialog("aptos")}
            className="mt-3 inline-flex h-11 w-full items-center justify-center text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            I have an Aptos wallet
          </button>
        </section>
      )}

      <WalletDialog
        open={session.dialog === "solana"}
        title="Solana wallets"
        description="Connecting derives an Aptos account for this site. You sign with the Solana wallet."
        wallets={session.solanaChoices}
        pendingId={session.pendingId}
        onClose={closeDialog}
        onConnect={(id) => {
          void session.connectSolanaWallet(id);
        }}
      />
      <WalletDialog
        open={session.dialog === "aptos"}
        title="Aptos wallets"
        description="Petra and other native Aptos wallets. The address does not depend on this site’s host."
        wallets={session.aptosChoices}
        pendingId={session.pendingId}
        onClose={closeDialog}
        onConnect={(id) => {
          void session.connectAptosWallet(id);
        }}
      />
    </main>
  );
}
