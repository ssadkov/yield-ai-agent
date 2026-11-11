"use client";

import { useEffect, useState } from "react";
import { CANONICAL_DERIVED_SAFE_HOST } from "@/lib/protocols/yield-ai/derivedSafeHost";
import { useAgentWallets } from "@/lib/agent/useAgentWallets";
import { AgentHeader } from "@/components/agent/AgentHeader";
import { AdvisorChatShell } from "@/components/agent/AdvisorChatShell";
import { WalletDialog } from "@/components/agent/WalletDialog";
import { WalletSidePanel } from "@/components/agent/WalletSidePanel";
import { SHOW_APTOS } from "@/lib/agent/features";

type MobilePane = "chat" | "wallet";

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
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const hostKnown = host !== null;
  const onProduction = host?.toLowerCase() === CANONICAL_DERIVED_SAFE_HOST;
  const nativeOnOtherHost = Boolean(session.aptosAddress) && session.derivedChain == null;
  // The host only changes the derived Aptos address; a Solana Safe is the same everywhere.
  const warnAboutHost = SHOW_APTOS && hostKnown && !onProduction && !nativeOnOtherHost;
  const displayAddress = session.solanaAddress ?? (SHOW_APTOS ? session.aptosAddress : null);

  const closeDialog = session.closeDialog;
  /** Desktop left rail: only when there is session content or a host warning. */
  const showDesktopLeft = Boolean(
    session.connected || warnAboutHost || session.error || session.pendingId
  );
  const showSkeleton = Boolean(session.pendingId && !session.connected);
  const showMobileWallet = mobilePane === "wallet";
  const showMobileChat = mobilePane === "chat";

  const walletPanel = (
    <WalletSidePanel
      connected={session.connected}
      pending={session.pendingId !== null}
      warnAboutHost={warnAboutHost}
      error={session.error}
      showSkeleton={showSkeleton}
      solanaAddress={session.solanaAddress}
      aptosAddress={session.aptosAddress}
      aptosKind={session.aptosKind}
      solanaWalletName={session.solanaWalletName}
      aptosIsDerived={session.derivedChain === "solana"}
      onConnectSolana={() => session.setDialog("solana")}
      onConnectAptos={() => session.setDialog("aptos")}
    />
  );

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
      <AgentHeader
        connected={session.connected}
        pending={session.pendingId !== null}
        disconnecting={disconnecting}
        displayAddress={displayAddress}
        walletIcon={session.walletIcon}
        solanaAddress={session.solanaAddress}
        aptosAddress={session.aptosAddress}
        aptosKind={session.aptosKind}
        solanaWalletName={session.solanaWalletName}
        onConnectSolana={() => session.setDialog("solana")}
        onConnectAptos={() => session.setDialog("aptos")}
        onDisconnect={() => {
          setDisconnecting(true);
          void session.disconnect().finally(() => setDisconnecting(false));
        }}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col px-3 pt-3 sm:px-4 lg:pb-4 lg:pt-4">
        <div
          className={[
            "flex min-h-0 flex-1 flex-col gap-3 pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:grid lg:gap-4 lg:pb-0",
            showDesktopLeft ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-1",
          ].join(" ")}
        >
          <aside
            className={[
              "min-h-0 overflow-y-auto overscroll-contain scrollbar-hide",
              showMobileWallet ? "block flex-1" : "hidden",
              showDesktopLeft ? "lg:block lg:flex-none lg:pr-1" : "lg:hidden",
            ].join(" ")}
          >
            <div className="mb-3 lg:hidden">
              <p className="font-mono text-[10px] tracking-[0.14em] text-primary/80 uppercase">
                &gt;&gt; wallet desk
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Wallet & deposit</h2>
            </div>
            {walletPanel}
          </aside>

          <div
            className={[
              "min-h-0",
              showMobileChat ? "flex flex-1 flex-col" : "hidden",
              "lg:flex lg:min-h-0",
            ].join(" ")}
          >
            <AdvisorChatShell />
          </div>
        </div>
      </main>

      <nav
        aria-label="Agent sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-1 py-2">
          {(
            [
              {
                id: "chat" as const,
                label: "Chat",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                    <path
                      d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
                      fill="currentColor"
                      opacity="0.95"
                    />
                  </svg>
                ),
              },
              {
                id: "wallet" as const,
                label: "Wallet",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                    <path
                      d="M4 8.5h16v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5Zm2.5-4h11L19 8.5H5l1.5-4Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path d="M12 12.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                ),
              },
            ] as const
          ).map((item) => {
            const active = mobilePane === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMobilePane(item.id)}
                className={[
                  "inline-flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

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
    </div>
  );
}
