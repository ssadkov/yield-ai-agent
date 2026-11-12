"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { INTENTS_ASSETS, SOLANA_SOL_ASSET, SOLANA_USDC_ASSET, type IntentsAsset } from "@/lib/agent/intentsAssets";
import { FINAL_STATUSES, fetchStatus, submitDepositTx, type OneClickStatusResponse } from "@/lib/agent/oneClick";
import { buildUsdcDepositTx, panelConnections, withFallback } from "@/lib/agent/solanaSafe";

type Quote = {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted: string | null;
  timeEstimate: number | null;
  deadline: string | null;
  asset: IntentsAsset;
  refundTo: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deposit into the owner's Safe from any chain or token through NEAR Intents 1-Click. The server
 * makes the quote with the Safe as recipient; Solana assets are paid by the connected wallet, the
 * rest is sent by hand to the one-time address. USDC on Solana arrives in the Safe as idle USDC.
 */
export function AnyChainDeposit({ onLanded }: { onLanded: () => void }) {
  const { publicKey, sendTransaction } = useWallet();
  // USDC on Base by default: ~30 s and ~0.2% (2026-11-13). Tron USDT then had a temporary $100 minimum.
  const [assetId, setAssetId] = useState(
    INTENTS_ASSETS.find((a) => a.chain === "base" && a.symbol === "USDC")?.id ?? SOLANA_USDC_ASSET
  );
  const [amount, setAmount] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<OneClickStatusResponse | null>(null);
  const [busy, setBusy] = useState<"quote" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  if (!publicKey) return null;
  const asset = INTENTS_ASSETS.find((a) => a.id === assetId)!;
  const walletPays = asset.chain === "solana";
  const final = status && FINAL_STATUSES.has(String(status.status)) ? String(status.status) : null;

  const reset = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setQuote(null);
    setStatus(null);
    setError(null);
  };

  const poll = (depositAddress: string) => {
    const tick = async () => {
      try {
        const next = await fetchStatus(depositAddress);
        setStatus(next);
        if (FINAL_STATUSES.has(String(next.status))) {
          if (next.status === "SUCCESS") onLanded();
          return;
        }
      } catch {
        /* keep polling */
      }
      timer.current = window.setTimeout(tick, 5_000);
    };
    void tick();
  };

  const getQuote = async () => {
    reset();
    setBusy("quote");
    try {
      const response = await fetch("/agent/api/safe-deposit/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          originAsset: asset.id,
          amount,
          ...(walletPays ? {} : { refundTo: refundTo.trim() }),
        }),
        cache: "no-store",
      });
      const json = (await response.json()) as Quote & { error?: string };
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      setQuote(json);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const payWithWallet = async () => {
    if (!quote) return;
    setBusy("pay");
    setError(null);
    try {
      const deposit = new PublicKey(quote.depositAddress);
      const { value: tx, connection } = await withFallback(
        panelConnections(window.location.host, window.location.origin),
        async (c) => {
          if (quote.asset.id === SOLANA_USDC_ASSET) return buildUsdcDepositTx(c, publicKey, deposit, BigInt(quote.amountIn));
          if (quote.asset.id === SOLANA_SOL_ASSET) {
            const t = new Transaction().add(
              SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: deposit, lamports: BigInt(quote.amountIn) })
            );
            t.feePayer = publicKey;
            t.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
            return t;
          }
          throw new Error("Send this asset by hand to the address shown.");
        }
      );
      const signature = await sendTransaction(tx, connection);
      submitDepositTx(signature, quote.depositAddress).catch(() => undefined);
      poll(quote.depositAddress);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quote.depositAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* select it by hand */
    }
  };

  const field = "h-11 w-full rounded-xl border border-border/80 bg-muted/40 px-3 text-[15px] outline-none focus:border-foreground/30";
  const primary =
    "inline-flex h-10 w-full items-center justify-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground disabled:opacity-40";
  const minutes = quote?.timeEstimate ? Math.max(1, Math.round(quote.timeEstimate / 60)) : null;

  return (
    <div className="space-y-3 text-[13px]">
      <p className="leading-relaxed text-muted-foreground">
        Pay with USDC or ETH on Base, USDT on Tron, NEAR, BTC or Solana tokens. NEAR Intents swaps and bridges it and delivers
        USDC to your account on Solana.
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={amount}
          inputMode="decimal"
          disabled={busy !== null}
          onChange={(event) => {
            setAmount(event.target.value);
            reset();
          }}
          placeholder="Amount"
          aria-label={`Amount in ${asset.symbol}`}
          className={field}
        />
        <select
          value={assetId}
          disabled={busy !== null}
          onChange={(event) => {
            setAssetId(event.target.value);
            reset();
          }}
          aria-label="Pay with"
          className="h-11 rounded-xl border border-border/80 bg-background px-2 text-[14px]"
        >
          {INTENTS_ASSETS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      {!walletPays ? (
        <input
          value={refundTo}
          disabled={busy !== null}
          onChange={(event) => {
            setRefundTo(event.target.value);
            reset();
          }}
          placeholder={`Your ${asset.chain} address, for a refund if it fails`}
          aria-label="Refund address"
          className={field}
        />
      ) : null}
      {!quote ? (
        <button
          type="button"
          disabled={busy !== null || !amount.trim() || (!walletPays && !refundTo.trim())}
          onClick={() => void getQuote()}
          className={primary}
        >
          {busy === "quote" ? "Asking NEAR Intents…" : "Get quote"}
        </button>
      ) : (
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-[14px]">
            {quote.amountInFormatted} {quote.asset.symbol} → <strong>≈ {quote.amountOutFormatted} USDC</strong> in your account
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {quote.minAmountOutFormatted ? `At least ${quote.minAmountOutFormatted} USDC` : ""}
            {minutes ? ` · about ${minutes} min` : ""} · refunds to {quote.refundTo.slice(0, 6)}…{quote.refundTo.slice(-4)}
          </p>
          {status ? (
            <p className="mt-2 text-[13px] font-medium">
              {final === "SUCCESS"
                ? `✓ ${status.swapDetails?.amountOutFormatted ?? quote.amountOutFormatted} USDC arrived. Press “Put it to work” on the card.`
                : final === "REFUNDED"
                  ? `Refunded${status.swapDetails?.refundedAmountFormatted ? ` ${status.swapDetails.refundedAmountFormatted} ${quote.asset.symbol}` : ""}${status.swapDetails?.refundReason ? `: ${status.swapDetails.refundReason}` : ""}.`
                  : final === "FAILED"
                    ? "NEAR Intents could not complete it."
                    : `NEAR Intents: ${String(status.status).toLowerCase().replace(/_/g, " ")}…`}
            </p>
          ) : walletPays ? (
            <button type="button" disabled={busy !== null} onClick={() => void payWithWallet()} className={`${primary} mt-3`}>
              {busy === "pay" ? "Confirm in your wallet…" : `Pay ${quote.amountInFormatted} ${quote.asset.symbol} from wallet`}
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-[13px]">
                Send exactly{" "}
                <strong>
                  {quote.amountInFormatted} {quote.asset.symbol}
                </strong>{" "}
                on {quote.asset.chain} to:
              </p>
              <button
                type="button"
                onClick={() => void copy()}
                title="Copy"
                className="block w-full break-all rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left font-mono text-[12px]"
              >
                {quote.depositAddress} {copied ? "✓ copied" : ""}
              </button>
              {quote.depositMemo ? (
                <p className="text-[12px]">
                  Memo: <span className="font-mono">{quote.depositMemo}</span>
                </p>
              ) : null}
              <button type="button" onClick={() => poll(quote.depositAddress)} className={primary}>
                I sent it
              </button>
              <p className="text-[12px] text-muted-foreground">
                One-time address, valid until {quote.deadline ? new Date(quote.deadline).toLocaleTimeString() : "the deadline"}.
              </p>
            </div>
          )}
          {status && final ? (
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">
              {[
                ...(status.swapDetails?.originChainTxHashes ?? []),
                // 1-Click leaves the Solana payout's explorerUrl empty.
                ...(status.swapDetails?.destinationChainTxHashes ?? []).map((tx) => ({
                  ...tx,
                  explorerUrl: tx.explorerUrl || `https://solscan.io/tx/${tx.hash}`,
                })),
              ].map(
                (tx) =>
                  tx.explorerUrl ? (
                    <li key={tx.hash}>
                      <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="underline">
                        {tx.hash.slice(0, 10)}…
                      </a>
                    </li>
                  ) : (
                    <li key={tx.hash} className="font-mono">
                      {tx.hash.slice(0, 10)}…
                    </li>
                  )
              )}
            </ul>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="text-[13px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
