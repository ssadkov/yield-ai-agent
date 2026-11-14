"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ActionCard as ActionCardData } from "@/lib/advisor/tools";
import { formatChatDepositAmount } from "@/lib/agent/chatDeposit";
import { panelConnections, readSolanaSafe, withFallback } from "@/lib/agent/solanaSafe";
import { AnyChainDeposit } from "@/components/agent/AnyChainDeposit";
import { CreateSafeStep, KaminoStep, WalletDepositStep } from "@/components/agent/SafeSteps";

const KAMINO_STRATEGY_ID = "solana:kamino_usdc";

function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The deposit (or withdraw) card the advisor puts under a plan. Two ways in: USDC from the
 * connected Solana wallet, or any chain and token through NEAR Intents 1-Click, which pays the
 * Safe and then offers the one signature that puts the USDC into Kamino.
 */
export function ActionCard({ card }: { card: ActionCardData }) {
  const { publicKey, connected } = useWallet();
  const owner = connected && publicKey ? publicKey : null;

  const [amount, setAmount] = useState(formatChatDepositAmount(card.amountUsdc));
  const [intents, setIntents] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsSafe, setNeedsSafe] = useState(false);
  const [fundedDirectly, setFundedDirectly] = useState(false);

  useEffect(() => {
    setAmount(formatChatDepositAmount(card.amountUsdc));
    setIntents(false);
    setError(null);
    setNote(null);
    setNeedsSafe(false);
    setFundedDirectly(false);
  }, [card.action, card.amountUsdc, card.note]);

  const parsed = parseAmount(amount);
  const isDeposit = card.action === "deposit";
  const amountInput = amount.trim().replace(",", ".");

  /** 1-Click pays the Safe's address whether or not the Safe exists, so check before quoting. */
  const openIntents = async () => {
    setError(null);
    setNote(null);
    if (!owner) {
      setError("Connect a Solana wallet first. NEAR Intents pays into your account, which belongs to that wallet.");
      return;
    }
    setChecking(true);
    try {
      const { value } = await withFallback(panelConnections(window.location.host, window.location.origin), (c) =>
        readSolanaSafe(c, owner)
      );
      if (value.safeExists) setIntents(true);
      else setNeedsSafe(true);
    } catch (err) {
      setError(`Could not read your account: ${errorText(err)}`);
    } finally {
      setChecking(false);
    }
  };

  const primaryButton =
    "inline-flex h-10 min-w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-[0_0_24px_-8px_var(--glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

  return (
    <div className="gpt-chat-enter rounded-2xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold tracking-tight text-foreground">
          {isDeposit ? "Deposit to Solana Safe" : "Withdraw from Safe"}
        </p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11.5px] tracking-wide text-primary">
          {isDeposit ? (intents ? "Any chain · 1-Click" : "Wallet · 1-Click") : "USDC"}
        </span>
      </div>

      {isDeposit && intents ? (
        <div className="mt-2.5">
          <AnyChainDeposit initialAmount={amountInput} onLanded={() => undefined} />
          <button
            type="button"
            onClick={() => setIntents(false)}
            className="mt-2 py-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Pay from this Solana wallet instead
          </button>
        </div>
      ) : (
        <>
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
                disabled={checking}
                onChange={(event) => {
                  setError(null);
                  setNote(null);
                  setAmount(event.target.value);
                }}
                className="h-10 w-full rounded-xl border border-border/80 bg-muted/40 px-3 pr-14 text-[15px] font-medium tabular-nums text-foreground outline-none transition-colors focus:border-foreground/30 focus:bg-background disabled:opacity-60"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted-foreground">
                USDC
              </span>
            </div>
            <button
              type="button"
              disabled={(isDeposit && checking) || parsed == null}
              onClick={() => {
                if (!isDeposit) {
                  setNote("Withdraw with the Withdraw button on the Earn card.");
                  return;
                }
                void openIntents();
              }}
              className={primaryButton}
            >
              {!isDeposit ? "Withdraw" : checking ? "Checking…" : "Via NEAR Intents"}
            </button>
          </div>

          {isDeposit && !needsSafe && !fundedDirectly ? (
            <WalletDepositStep
              amountInput={amountInput}
              onNoSafe={() => setNeedsSafe(true)}
              onDeposited={({ intoKamino }) => {
                if (intoKamino) {
                  setNote("Deposited from your wallet straight into Kamino.");
                } else {
                  setFundedDirectly(true);
                  setNote("Deposited from your wallet into the Safe.");
                }
              }}
            />
          ) : null}

          {isDeposit ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
              “Via NEAR Intents” takes USDC, USDT, ETH, BTC, NEAR and more from other chains and delivers USDC to your Safe in a
              few minutes. Demo range: 1–101 USDC arriving.
            </p>
          ) : null}
        </>
      )}

      {card.note ? <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{card.note}</p> : null}

      {error ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/80">{note}</p> : null}

      {isDeposit && needsSafe ? (
        <CreateSafeStep
          amountInput={amountInput}
          onCreated={({ withDeposit }) => {
            setNeedsSafe(false);
            if (withDeposit) {
              setFundedDirectly(true);
              setNote("Safe created and funded from your wallet.");
            } else {
              setNote("Safe created. Now pay from any chain.");
              setIntents(true);
            }
          }}
        />
      ) : null}

      {isDeposit && !intents && (fundedDirectly || card.strategyId === KAMINO_STRATEGY_ID) ? (
        <KaminoStep suggestedUsdc={parsed ?? card.amountUsdc} />
      ) : null}
    </div>
  );
}
