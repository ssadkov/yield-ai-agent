"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  fetchCredits,
  loadSession,
  purchaseStatus,
  requestPurchase,
  signIn,
  type CreditsState,
  type PurchaseQuote,
} from "@/lib/credits/client";
import { buildUsdcDepositTx, panelConnections, withFallback } from "@/lib/agent/solanaSafe";
import { AiPoolMeter } from "@/components/agent/AiPoolMeter";
import { MAX_PURCHASE_USD, MIN_PURCHASE_USD, PURCHASE_OPTIONS_USD, purchaseAmountUnits } from "@/lib/credits/ledger";

const AMOUNTS = PURCHASE_OPTIONS_USD;
const SOLANA_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOLANA_SOL = "nep141:sol.omft.near";
const FINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

function usd(value: number): string {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Advisor credits above the composer: sign in with the wallet, see the balance, top up with any
 * listed token through NEAR Intents 1-Click. Hidden when the server has credits off.
 */
export function CreditsPanel({ onState }: { onState?: (state: CreditsState | null, wallet: string | null) => void } = {}) {
  const { publicKey, connected, signMessage, sendTransaction } = useWallet();
  const wallet = connected && publicKey ? publicKey.toBase58() : null;
  const [state, setState] = useState<CreditsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState<string>(String(PURCHASE_OPTIONS_USD[0]));
  const [asset, setAsset] = useState(SOLANA_USDC);
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showPool, setShowPool] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    fetchCredits()
      .then(setState)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("agent-session", refresh);
    window.addEventListener("agent-inference-ids", refresh);
    return () => {
      window.removeEventListener("agent-session", refresh);
      window.removeEventListener("agent-inference-ids", refresh);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [refresh, wallet]);

  useEffect(() => {
    onState?.(state, wallet);
  }, [onState, state, wallet]);

  if (!state?.enabled) return null;

  const signedInAs = loadSession(wallet)?.wallet ?? null;
  const selected = state.paymentAssets?.find((a) => a.id === asset);
  const walletPays = selected?.chain === "solana";
  const amount = purchaseAmountUnits(amountText.replace(",", "."))?.usd ?? null;

  const poll = (depositAddress: string) => {
    const tick = async () => {
      try {
        const next = await purchaseStatus(depositAddress);
        setStatus(next.status);
        if (FINAL.has(next.status)) {
          refresh();
          return;
        }
      } catch (err) {
        setError(errorText(err));
      }
      timer.current = window.setTimeout(tick, 5_000);
    };
    void tick();
  };

  const doSignIn = async () => {
    if (!wallet || !signMessage) return setError("This wallet cannot sign messages.");
    setBusy("signin");
    setError(null);
    try {
      await signIn(wallet, signMessage);
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const doQuote = async () => {
    if (amount === null) return setError(`Enter $${MIN_PURCHASE_USD}–$${MAX_PURCHASE_USD}, to the cent.`);
    setBusy("quote");
    setError(null);
    setQuote(null);
    setStatus(null);
    try {
      setQuote(await requestPurchase(amount, asset, walletPays ? undefined : refundTo.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const payWithWallet = async () => {
    if (!quote || !publicKey) return;
    setBusy("pay");
    setError(null);
    try {
      const connections = panelConnections(window.location.host, window.location.origin);
      const deposit = new PublicKey(quote.depositAddress);
      const { value: tx, connection } = await withFallback(connections, async (c) => {
        if (quote.asset.id === SOLANA_USDC) return buildUsdcDepositTx(c, publicKey, deposit, BigInt(quote.amountIn));
        if (quote.asset.id === SOLANA_SOL) {
          const t = new Transaction().add(
            SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: deposit, lamports: BigInt(quote.amountIn) })
          );
          t.feePayer = publicKey;
          t.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
          return t;
        }
        throw new Error("Send this asset manually to the address shown.");
      });
      await sendTransaction(tx, connection);
      poll(quote.depositAddress);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const balance = state.balance;
  return (
    <div className="mx-3.5 mb-1.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[12.5px] leading-relaxed sm:mx-5">
      {!wallet ? (
        <p className="text-muted-foreground">
          {state.trial && state.trial.requestsLeft > 0
            ? `Try it without a wallet: ${state.trial.requestsLeft} free requests left today. `
            : state.trial
              ? "Today's free tries are used. "
              : ""}
          Connect a Solana wallet for ${(state.freeMonthlyUsd ?? 0).toFixed(2)} of private AI free every month.
        </p>
      ) : !signedInAs || !state.signedIn ? (
        // Signing is only asked for when it buys something: the trial covers the first requests.
        state.trial && state.trial.requestsLeft > 0 ? (
          <p className="text-muted-foreground">
            {state.trial.requestsLeft} free requests left today.{" "}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void doSignIn()}
              className="font-medium text-foreground underline underline-offset-2 disabled:opacity-40"
            >
              {busy === "signin" ? "Sign…" : "Sign once"}
            </button>{" "}
            for ${(state.freeMonthlyUsd ?? 0).toFixed(2)} of private AI every month, Open chat and top-ups.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {state.trial ? "Today's free tries are used. " : ""}Sign once with your wallet to keep chatting: $
              {(state.freeMonthlyUsd ?? 0).toFixed(2)} of private AI free every month.
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void doSignIn()}
              className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-[12.5px] font-medium text-primary-foreground disabled:opacity-40"
            >
              {busy === "signin" ? "Sign…" : "Sign once"}
            </button>
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              AI credits: <strong>{usd(balance?.availableUsd ?? 0)}</strong>
              <span className="text-muted-foreground">
                {" "}
                · free left {usd(balance?.freeLeftUsd ?? 0)} · from your Safe yield {usd(balance?.yieldLeftUsd ?? 0)} · bought{" "}
                {usd(Math.max(0, balance?.purchasedLeftUsd ?? 0))}
              </span>
              <button
                type="button"
                aria-expanded={showPool}
                aria-label="Where free AI comes from"
                title="Where free AI comes from"
                onClick={() => setShowPool((v) => !v)}
                className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10.5px] text-muted-foreground align-middle hover:text-foreground"
              >
                i
              </button>
            </span>
            {state.purchasesEnabled ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-medium underline">
                {open ? "Close" : "Top up with any token"}
              </button>
            ) : null}
          </div>
          {state.remaining || state.usage ? (
            <p
              className="mt-0.5 text-muted-foreground"
              title={
                state.price
                  ? `${state.price.model}: $${state.price.inputUsdPerMillion} / $${state.price.outputUsdPerMillion} per 1M input / output tokens (NEAR AI). A typical advisor request is about $${state.remaining?.typicalRequestUsd}.`
                  : undefined
              }
            >
              {state.remaining
                ? `≈ ${state.remaining.typicalRequests.toLocaleString("en-US")} requests${
                    state.remaining.outputTokens !== null
                      ? ` or ${state.remaining.outputTokens.toLocaleString("en-US")} output tokens`
                      : ""
                  } left`
                : null}
              {state.usage
                ? ` · this month: ${state.usage.month.requests} requests, ${(
                    state.usage.month.promptTokens + state.usage.month.completionTokens
                  ).toLocaleString("en-US")} tokens, ${usd(state.usage.month.usd)}`
                : null}
            </p>
          ) : null}
          {showPool ? <AiPoolMeter className="mt-0.5 text-[12px] text-muted-foreground" /> : null}
          {open ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {AMOUNTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setAmountText(String(value));
                      setQuote(null);
                    }}
                    className={[
                      "h-7 rounded-full border px-2.5",
                      amount === value ? "border-foreground/50 bg-background" : "border-border text-muted-foreground",
                    ].join(" ")}
                  >
                    ${value}
                  </button>
                ))}
                <label className="inline-flex h-7 items-center rounded-full border border-border bg-background pl-2.5">
                  $
                  <input
                    value={amountText}
                    onChange={(event) => {
                      setAmountText(event.target.value);
                      setQuote(null);
                    }}
                    inputMode="decimal"
                    aria-label={`Amount in dollars, ${MIN_PURCHASE_USD} to ${MAX_PURCHASE_USD}`}
                    className="h-full w-14 rounded-full bg-transparent px-1 outline-none"
                  />
                </label>
                <select
                  value={asset}
                  onChange={(event) => {
                    setAsset(event.target.value);
                    setQuote(null);
                  }}
                  aria-label="Pay with"
                  className="h-7 rounded-lg border border-border bg-background px-2"
                >
                  {state.paymentAssets?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {!walletPays ? (
                <input
                  value={refundTo}
                  onChange={(event) => setRefundTo(event.target.value)}
                  placeholder={`Your ${selected?.chain ?? ""} address for refunds`}
                  className="h-7 w-full rounded-lg border border-border bg-background px-2"
                />
              ) : null}
              <button
                type="button"
                disabled={busy !== null || amount === null || (!walletPays && !refundTo.trim())}
                onClick={() => void doQuote()}
                className="inline-flex h-7 items-center rounded-full bg-primary px-3 font-medium text-primary-foreground disabled:opacity-40"
              >
                {busy === "quote"
                  ? "Quoting…"
                  : amount === null
                    ? `Enter $${MIN_PURCHASE_USD}–$${MAX_PURCHASE_USD}`
                    : `Get ${usd(amount)} of credits`}
              </button>
              {quote ? (
                <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                  <p>
                    Pay <strong>{quote.amountInFormatted} {quote.asset.symbol}</strong> → {usd(quote.amountUsd)} of credits via NEAR
                    Intents 1-Click. Refunds go to {quote.refundTo.slice(0, 6)}…{quote.refundTo.slice(-4)}.
                  </p>
                  {walletPays ? (
                    <button
                      type="button"
                      disabled={busy !== null || status !== null}
                      onClick={() => void payWithWallet()}
                      className="mt-1.5 inline-flex h-7 items-center rounded-full bg-primary px-3 font-medium text-primary-foreground disabled:opacity-40"
                    >
                      {busy === "pay" ? "Sign…" : "Pay with wallet"}
                    </button>
                  ) : (
                    <p className="mt-1 break-all font-mono text-[11.5px]">
                      Send exactly {quote.amountInFormatted} {quote.asset.symbol} on {quote.asset.chain} to {quote.depositAddress}
                      {quote.depositMemo ? ` (memo ${quote.depositMemo})` : ""}
                      <button type="button" onClick={() => poll(quote.depositAddress)} className="ml-2 underline">
                        I sent it
                      </button>
                    </p>
                  )}
                  {status ? <p className="mt-1">1-Click: {status === "SUCCESS" ? "credited ✓" : status}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className="mt-1 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
