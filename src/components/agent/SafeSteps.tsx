"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  requestCreationPlan,
  requestKaminoDepositPlan,
  signAndSendPlan,
  type PlanKind,
} from "@/lib/agent/safePlans";
import { formatUsdc, panelConnections, parseUsdc, readSolanaSafe, withFallback } from "@/lib/agent/solanaSafe";

const KAMINO_MIN_RAW = BigInt(1_000_000);

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useOwnerSigner() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const owner = connected && publicKey ? publicKey : null;
  const run = async (kind: PlanKind, request: () => ReturnType<typeof requestCreationPlan>, amountRaw?: bigint) => {
    if (!owner) throw new Error("Connect a Solana wallet first.");
    const plan = await request();
    const connections = panelConnections(window.location.host, window.location.origin);
    const { connection } = await withFallback(connections, async (c) => {
      await c.getLatestBlockhash("confirmed");
      return c;
    });
    return signAndSendPlan({ plan, owner, kind, amountRaw, connection, sendTransaction });
  };
  return { owner, run };
}

function TxLine({ label, signature }: { label: string; signature: string }) {
  return (
    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
      {label} ·{" "}
      <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="underline">
        {shorten(signature)}
      </a>
    </p>
  );
}

/**
 * Shown when the wallet has no Solana Safe. Creating it is one owner-signed transaction; with a
 * first deposit, the same transaction also moves USDC from the wallet into the Safe.
 */
export function CreateSafeStep({
  amountInput,
  onCreated,
}: {
  amountInput: string;
  onCreated: (result: { withDeposit: boolean }) => void;
}) {
  const { owner, run } = useOwnerSigner();
  const [busy, setBusy] = useState<"create" | "create_deposit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const amountRaw = parseUsdc(amountInput);

  const create = async (withDeposit: boolean) => {
    if (!owner) return setError("Connect a Solana wallet first.");
    if (withDeposit && amountRaw === null) return setError("Enter a USDC amount, up to 6 decimals.");
    setError(null);
    setBusy(withDeposit ? "create_deposit" : "create");
    try {
      const sig = withDeposit
        ? await run("create_safe_and_deposit", () => requestCreationPlan(owner, formatUsdc(amountRaw!)), amountRaw!)
        : await run("create_safe", () => requestCreationPlan(owner));
      setSignature(sig);
      onCreated({ withDeposit });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2.5 rounded-xl border border-border/70 bg-muted/30 p-2.5">
      <p className="text-[11px] leading-relaxed text-foreground/85">
        No Solana Safe yet. Creating it is one transaction you sign; Solana charges a little SOL for account rent.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || Boolean(signature)}
          onClick={() => void create(false)}
          className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy === "create" ? "Sign…" : "Create Safe"}
        </button>
        <button
          type="button"
          disabled={busy !== null || Boolean(signature) || amountRaw === null}
          onClick={() => void create(true)}
          className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-medium text-foreground disabled:opacity-40"
        >
          {busy === "create_deposit" ? "Sign…" : `Create + deposit ${amountRaw === null ? "" : formatUsdc(amountRaw)} USDC from wallet`}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
        “Create Safe” then use Deposit to fund it through NEAR Intents. “Create + deposit” moves USDC straight from this wallet.
      </p>
      {signature ? <TxLine label="Safe created" signature={signature} /> : null}
      {error ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Put idle Safe USDC into the Kamino USDC vault with one owner-signed transaction. */
export function KaminoStep({ suggestedUsdc }: { suggestedUsdc: number }) {
  const { owner, run } = useOwnerSigner();
  const [idleRaw, setIdleRaw] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    void (async () => {
      try {
        const connections = panelConnections(window.location.host, window.location.origin);
        const { value } = await withFallback(connections, (c) => readSolanaSafe(c, new PublicKey(owner)));
        if (!active) return;
        setIdleRaw(value.safeUsdcRaw);
        const suggestedRaw = parseUsdc(String(suggestedUsdc)) ?? value.safeUsdcRaw;
        const start = suggestedRaw < value.safeUsdcRaw ? suggestedRaw : value.safeUsdcRaw;
        setAmount(formatUsdc(start));
      } catch (err) {
        if (active) setError(`Safe balance: ${errorText(err)}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [owner, suggestedUsdc]);

  const amountRaw = parseUsdc(amount);
  const tooSmall = amountRaw !== null && amountRaw < KAMINO_MIN_RAW;
  const tooBig = amountRaw !== null && idleRaw !== null && amountRaw > idleRaw;

  const place = async () => {
    if (!owner || amountRaw === null) return;
    setError(null);
    setBusy(true);
    try {
      const sig = await run("kamino_deposit", () => requestKaminoDepositPlan(owner, formatUsdc(amountRaw)), amountRaw);
      setSignature(sig);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!owner) return null;
  return (
    <div className="mt-2.5 rounded-xl border border-border/70 bg-muted/30 p-2.5">
      <p className="text-[11px] leading-relaxed text-foreground/85">
        Put Safe USDC into Kamino (variable APY). You sign once; the funds stay in your Safe’s Kamino position.
        {idleRaw !== null ? ` Idle in Safe: ${formatUsdc(idleRaw)} USDC.` : ""}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          disabled={busy || Boolean(signature)}
          onChange={(event) => {
            setError(null);
            setAmount(event.target.value.trim().replace(",", "."));
          }}
          aria-label="USDC to put into Kamino"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border/80 bg-background px-2.5 text-xs tabular-nums outline-none"
        />
        <button
          type="button"
          disabled={busy || Boolean(signature) || amountRaw === null || tooSmall || tooBig}
          onClick={() => void place()}
          className="inline-flex h-8 shrink-0 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? "Sign…" : signature ? "Done" : "Put into Kamino"}
        </button>
      </div>
      {tooSmall ? <p className="mt-1 text-[10px] text-muted-foreground">Kamino needs at least 1 USDC.</p> : null}
      {tooBig ? <p className="mt-1 text-[10px] text-muted-foreground">More than the Safe holds.</p> : null}
      {signature ? <TxLine label="In Kamino" signature={signature} /> : null}
      {error ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
