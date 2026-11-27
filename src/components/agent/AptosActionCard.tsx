"use client";

import { useEffect, useState } from "react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import {
  fetchSafeIdle,
  fetchSafePaused,
  fromRaw,
  setPausedPayload,
  toRaw,
  withdrawPayload,
  type AptosActionCard as Card,
  type EntryPayload,
  type WithdrawToken,
} from "@/lib/agent/aptosSafeOps";
import { PRODUCTION_HOST } from "@/lib/agent/aptosDerived";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|cancel/i.test(message)) return "Cancelled in the wallet.";
  if (/E_NOT_OWNER|not.?owner/i.test(message)) return "This wallet is not the owner of the Safe.";
  return message;
}

/**
 * Pause, resume or withdraw on one Aptos agent Safe, signed by the owner's wallet (Gas Station pays).
 * The vault checks on chain that the signer owns the Safe; this card only builds the transaction.
 */
export function AptosActionCard({ card, owner }: { card: Card; owner: string | null }) {
  const aptos = useAptosWallet();
  const signer = aptos.connected && aptos.account ? String(aptos.account.address).toLowerCase() : null;
  const signerIsOwner = Boolean(signer && owner && signer.replace(/^0x0*/, "") === owner.toLowerCase().replace(/^0x0*/, ""));

  const [paused, setPaused] = useState<boolean | null>(null);
  const [idle, setIdle] = useState<Record<WithdrawToken, bigint> | null>(null);
  const token: WithdrawToken = card.token ?? "USDC";
  const [amount, setAmount] = useState(card.amount ? String(card.amount) : "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSafePaused(card.safe).then((p) => active && setPaused(p));
    if (card.action === "withdraw") {
      fetchSafeIdle(card.safe)
        .then((value) => {
          if (!active || !value) return;
          setIdle(value);
          if (!card.amount) setAmount(String(fromRaw(value[token])));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [card.safe, card.action, card.amount, token]);

  const idleRaw = idle?.[token] ?? null;
  const amountRaw = toRaw(amount);
  const already = (card.action === "pause" && paused === true) || (card.action === "resume" && paused === false);

  let blocked: string | null = null;
  if (!owner) blocked = "Connect the wallet that owns this agent.";
  else if (!signer) blocked = "Connect your Aptos wallet (header → Connect) to sign.";
  else if (!signerIsOwner)
    blocked =
      typeof window !== "undefined" && window.location.host !== PRODUCTION_HOST
        ? `Sign this on ${PRODUCTION_HOST}/agent: a Solana wallet's Aptos account depends on the site.`
        : "The connected Aptos account is not the owner of this Safe.";
  else if (already) blocked = card.action === "pause" ? "This agent is already paused." : "This agent is already running.";
  else if (card.action === "withdraw") {
    if (idleRaw === 0n) blocked = `No idle ${token} in this Safe. Funds in positions are withdrawn on ${PRODUCTION_HOST} (AI agent → Manage).`;
    else if (amountRaw == null) blocked = "Enter an amount.";
    else if (idleRaw != null && amountRaw > idleRaw) blocked = `Only ${fromRaw(idleRaw)} ${token} is idle in this Safe.`;
  }

  const title =
    card.action === "pause" ? "Pause agent" : card.action === "resume" ? "Resume agent" : `Withdraw ${token} to your wallet`;
  const detail =
    card.action === "pause"
      ? "The executor stops; positions stay as they are and you can still withdraw."
      : card.action === "resume"
        ? "The executor runs again on its next cycle."
        : "Idle tokens in the Safe go to your Aptos wallet.";

  const submit = async () => {
    if (blocked || !aptos.signAndSubmitTransaction) return;
    let payload: EntryPayload;
    if (card.action === "withdraw") {
      if (amountRaw == null) return;
      payload = withdrawPayload(card.safe, token, amountRaw);
    } else {
      payload = setPausedPayload(card.safe, card.action === "pause");
    }
    setBusy(true);
    setError(null);
    try {
      const result = await aptos.signAndSubmitTransaction({ data: payload });
      const hash = (result as { hash?: string })?.hash ?? "";
      setDone(hash);
      if (card.action !== "withdraw") setPaused(card.action === "pause");
      window.dispatchEvent(new Event("aptos-agents-changed"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-2xl border border-border bg-background/60 px-3.5 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{title}</p>
        <span className="text-[11px] text-muted-foreground">
          {card.label} · Safe {short(card.safe)}
          {paused == null ? "" : paused ? " · paused" : " · running"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>

      {card.action === "withdraw" ? (
        <label className="mt-2 flex items-center gap-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || Boolean(done)}
            className="h-9 w-32 rounded-xl border border-border bg-background px-2 text-sm tabular-nums"
            aria-label={`${token} amount`}
          />
          <span>{token}</span>
          {idleRaw != null ? <span className="text-xs text-muted-foreground">idle: {fromRaw(idleRaw)}</span> : null}
        </label>
      ) : null}

      {done !== null ? (
        <p className="mt-2 text-xs text-primary">
          Sent.{" "}
          {done ? (
            <a className="underline" href={`https://explorer.aptoslabs.com/txn/${done}?network=mainnet`} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
          ) : null}
        </p>
      ) : (
        <>
          {blocked ? <p className="mt-2 text-xs text-muted-foreground">{blocked}</p> : null}
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          <button
            type="button"
            onClick={submit}
            disabled={Boolean(blocked) || busy}
            className="mt-2 inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Waiting for the wallet…" : `Sign: ${title.toLowerCase()}`}
          </button>
        </>
      )}
    </div>
  );
}
