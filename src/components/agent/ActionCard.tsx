"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ActionCard as ActionCardData } from "@/lib/advisor/tools";
import {
  chatDepositErrorText,
  chatDepositStatusLabel,
  executeChatDeposit,
  formatChatDepositAmount,
  formatChatDepositUsdc,
  pollChatDepositStatus,
  SafeMissingError,
  type ChatDepositPhase,
  type ChatDepositTracked,
} from "@/lib/agent/chatDeposit";
import type { OneClickStatusResponse } from "@/lib/agent/oneClick";
import { CreateSafeStep, KaminoStep, WalletDepositStep } from "@/components/agent/SafeSteps";

const KAMINO_STRATEGY_ID = "solana:kamino_usdc";

const POLL_MS = 5_000;

function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function ActionCard({ card }: { card: ActionCardData }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const owner = connected && publicKey ? publicKey.toBase58() : null;

  const [amount, setAmount] = useState(formatChatDepositAmount(card.amountUsdc));
  const [phase, setPhase] = useState<ChatDepositPhase>("idle");
  const [tracked, setTracked] = useState<ChatDepositTracked | null>(null);
  const [status, setStatus] = useState<OneClickStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsSafe, setNeedsSafe] = useState(false);
  const [fundedDirectly, setFundedDirectly] = useState(false);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    setAmount(formatChatDepositAmount(card.amountUsdc));
    setPhase("idle");
    setTracked(null);
    setStatus(null);
    setError(null);
    setNote(null);
    setNeedsSafe(false);
    setFundedDirectly(false);
  }, [card.action, card.amountUsdc, card.note]);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const startPolling = (deposit: ChatDepositTracked) => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    setPhase("tracking");
    const tick = async () => {
      try {
        const next = await pollChatDepositStatus(deposit.depositAddress);
        setStatus(next.status);
        if (next.done) {
          setPhase("done");
          return;
        }
      } catch (err) {
        setError(`Status: ${chatDepositErrorText(err)}`);
      }
      pollTimer.current = window.setTimeout(tick, POLL_MS);
    };
    void tick();
  };

  const parsed = parseAmount(amount);
  const isDeposit = card.action === "deposit";
  const busy = phase === "preparing" || phase === "quoting" || phase === "signing" || phase === "tracking";
  const statusLine = chatDepositStatusLabel(status, phase);

  const buttonLabel = (() => {
    if (!isDeposit) return "Withdraw";
    if (phase === "preparing") return "Checking…";
    if (phase === "quoting") return "Quoting…";
    if (phase === "signing") return "Sign…";
    if (phase === "tracking") return "Pending…";
    if (phase === "done") return "Done";
    return "Via NEAR Intents";
  })();

  return (
    <div className="gpt-chat-enter rounded-2xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-tight text-foreground">
          {isDeposit ? "Deposit to Solana Safe" : "Withdraw from Safe"}
        </p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary">
          {isDeposit ? "Wallet · 1-Click" : "USDC"}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor={`action-amount-${card.action}-${card.amountUsdc}`}>
          Amount in USDC
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            id={`action-amount-${card.action}-${card.amountUsdc}`}
            type="text"
            inputMode="decimal"
            value={amount}
            disabled={busy || phase === "done"}
            onChange={(event) => {
              setError(null);
              setNote(null);
              if (phase === "error") setPhase("idle");
              setAmount(event.target.value);
            }}
            className="h-10 w-full rounded-xl border border-border/80 bg-muted/40 px-3 pr-14 text-sm font-medium tabular-nums text-foreground outline-none transition-colors focus:border-foreground/30 focus:bg-background disabled:opacity-60"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            USDC
          </span>
        </div>
        <button
          type="button"
          disabled={parsed == null || busy || phase === "done"}
          onClick={() => {
            if (parsed == null) return;
            setError(null);
            setNote(null);

            if (!isDeposit) {
              setNote("Withdraw from your Safe on yieldai.app — this desk does not send withdraw txs yet.");
              return;
            }

            if (!owner) {
              setError("Connect a Solana wallet first, then press Deposit.");
              setPhase("error");
              return;
            }

            void (async () => {
              try {
                const result = await executeChatDeposit({
                  owner,
                  amountInput: amount.trim().replace(",", "."),
                  sendTransaction,
                  onPhase: (next) => setPhase(next),
                });
                setTracked(result.tracked);
                setStatus(null);
                startPolling(result.tracked);
              } catch (err) {
                if (err instanceof SafeMissingError) {
                  setPhase("idle");
                  setNeedsSafe(true);
                  return;
                }
                setPhase("error");
                setError(chatDepositErrorText(err));
              }
            })();
          }}
          className="inline-flex h-10 min-w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_0_24px_-8px_var(--glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {buttonLabel}
        </button>
      </div>

      {isDeposit && !needsSafe && (phase === "idle" || phase === "error") && !fundedDirectly ? (
        <WalletDepositStep
          amountInput={amount.trim().replace(",", ".")}
          onNoSafe={() => setNeedsSafe(true)}
          onDeposited={({ intoKamino }) => {
            if (intoKamino) {
              setPhase("done");
              setNote("Deposited from your wallet straight into Kamino.");
            } else {
              setFundedDirectly(true);
              setPhase("done");
              setNote("Deposited from your wallet into the Safe.");
            }
          }}
        />
      ) : null}

      {card.note ? <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{card.note}</p> : null}

      {isDeposit && phase === "idle" ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/80">
          “Via NEAR Intents” sends Solana USDC to a one-time 1-Click address that pays your Safe (~1%, a few minutes). Test range: 1–5 USDC.
        </p>
      ) : null}

      {statusLine ? (
        <p className="mt-2 text-[11px] leading-relaxed text-foreground/85" aria-live="polite">
          {statusLine}
        </p>
      ) : null}

      {tracked ? (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {formatChatDepositUsdc(BigInt(tracked.amountRaw))} USDC · tx {shorten(tracked.txSig)}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="mt-2 text-[11px] leading-relaxed text-foreground/80">{note}</p> : null}

      {isDeposit && needsSafe ? (
        <CreateSafeStep
          amountInput={amount.trim().replace(",", ".")}
          onCreated={({ withDeposit }) => {
            setNeedsSafe(false);
            if (withDeposit) {
              setFundedDirectly(true);
              setPhase("done");
              setNote("Safe created and funded from your wallet.");
            } else {
              setNote("Safe created. Press Deposit to fund it through NEAR Intents.");
            }
          }}
        />
      ) : null}

      {isDeposit && (fundedDirectly || (phase === "done" && status?.status === "SUCCESS") || card.strategyId === KAMINO_STRATEGY_ID) ? (
        <KaminoStep suggestedUsdc={parsed ?? card.amountUsdc} />
      ) : null}
    </div>
  );
}
