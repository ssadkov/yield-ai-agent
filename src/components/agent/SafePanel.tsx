"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  readSafeTreasury,
  requestCreationPlan,
  requestDepositPlan,
  requestKaminoDepositPlan,
  requestKaminoRedeemPlan,
  requestKaminoReturnPlan,
  requestWithdrawPlan,
  signAndSendPlan,
  type PlanKind,
  type SafePlan,
} from "@/lib/agent/safePlans";
import { formatUsdc, panelConnections, parseUsdc, withFallback } from "@/lib/agent/solanaSafe";
import type { SafeSummary } from "@/lib/agent/safeSummary";

const KAMINO_MIN_RAW = BigInt(1_000_000);

function usd(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Done = { label: string; signature: string };

/**
 * The owner's Solana Safe with plain buttons, like the regular Safe app: create, deposit from the
 * wallet (into the Safe or straight into Kamino), move idle USDC into Kamino, exit Kamino back to
 * the wallet, withdraw idle USDC. Every transaction comes from the Solana Safe API and is checked
 * in this browser before the wallet signs it (src/lib/agent/safePlans.ts).
 */
export function SafePanel() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const owner = connected && publicKey ? publicKey : null;
  const [summary, setSummary] = useState<SafeSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);

  const refresh = useCallback(
    async (fresh = false) => {
      if (!owner) return;
      try {
        const response = await fetch(`/agent/api/safe-summary?owner=${owner.toBase58()}${fresh ? "&fresh=1" : ""}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as SafeSummary & { error?: string };
        if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
        setSummary(json);
        setLoadError(null);
      } catch (err) {
        setLoadError(errorText(err));
      }
    },
    [owner]
  );

  useEffect(() => {
    setSummary(null);
    setDone([]);
    void refresh();
  }, [refresh]);

  if (!owner) return null;

  const amountRaw = parseUsdc(amount);
  const connection = async (): Promise<Connection> =>
    (
      await withFallback(panelConnections(window.location.host, window.location.origin), async (c) => {
        await c.getLatestBlockhash("confirmed");
        return c;
      })
    ).value;

  const sign = async (plan: SafePlan, kind: PlanKind, raw?: bigint, treasury?: PublicKey) =>
    signAndSendPlan({ plan, owner, kind, amountRaw: raw, treasury, connection: await connection(), sendTransaction });

  /** Run one action; on success record its transactions and reload the Safe. */
  const run = async (id: string, action: () => Promise<Done[]>) => {
    setBusy(id);
    setError(null);
    try {
      const results = await action();
      setDone((prev) => [...results, ...prev].slice(0, 6));
      await refresh(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const needAmount = (): bigint => {
    if (amountRaw === null) throw new Error("Enter a USDC amount, up to 6 decimals.");
    return amountRaw;
  };

  const createSafe = (withDeposit: boolean) =>
    run(withDeposit ? "create-deposit" : "create", async () => {
      const raw = withDeposit ? needAmount() : undefined;
      const plan = await requestCreationPlan(owner, raw === undefined ? undefined : formatUsdc(raw));
      const signature = await sign(plan, withDeposit ? "create_safe_and_deposit" : "create_safe", raw);
      return [{ label: withDeposit ? `Safe created, ${formatUsdc(raw!)} USDC in` : "Safe created", signature }];
    });

  const deposit = (intoKamino: boolean) =>
    run(intoKamino ? "deposit-kamino" : "deposit", async () => {
      const raw = needAmount();
      if (intoKamino && raw < KAMINO_MIN_RAW) throw new Error("Kamino needs at least 1 USDC.");
      const plan = intoKamino
        ? await requestKaminoDepositPlan(owner, formatUsdc(raw), "wallet")
        : await requestDepositPlan(owner, formatUsdc(raw));
      const signature = await sign(plan, intoKamino ? "kamino_deposit_from_wallet" : "deposit", raw);
      return [{ label: `${formatUsdc(raw)} USDC ${intoKamino ? "wallet → Kamino" : "wallet → Safe"}`, signature }];
    });

  const idleToKamino = () =>
    run("idle-kamino", async () => {
      const raw = needAmount();
      if (raw < KAMINO_MIN_RAW) throw new Error("Kamino needs at least 1 USDC.");
      const plan = await requestKaminoDepositPlan(owner, formatUsdc(raw), "safe");
      return [{ label: `${formatUsdc(raw)} USDC Safe → Kamino`, signature: await sign(plan, "kamino_deposit", raw) }];
    });

  const withdrawIdle = (all: boolean) =>
    run(all ? "withdraw-all" : "withdraw", async () => {
      const raw = all ? null : needAmount();
      const plan = await requestWithdrawPlan(owner, raw === null ? "all" : formatUsdc(raw));
      if (plan.status === "empty") throw new Error("No idle USDC in the Safe.");
      const planned = BigInt(plan.amountRaw ?? "0");
      return [{ label: `${formatUsdc(planned)} USDC Safe → wallet`, signature: await sign(plan, "withdraw", planned) }];
    });

  /** Kamino exit: redeem shares into the Safe (program takes its fee), then send that USDC to the wallet. */
  const exitKamino = (percent: string) =>
    run(`exit-${percent}`, async () => {
      const results: Done[] = [];
      const treasury = await readSafeTreasury(await connection());
      const redeem = await requestKaminoRedeemPlan(owner, percent);
      if (redeem.status === "redeemed") throw new Error("Nothing left in Kamino to redeem.");
      const redeemSig = await sign(redeem, "kamino_redeem", BigInt(redeem.legSharesRaw ?? "0"), treasury);
      results.push({ label: `Kamino redeemed (${percent}%)`, signature: redeemSig });
      // The API reads the confirmed redemption receipt; its RPC can lag a few seconds behind ours.
      let ret: SafePlan | null = null;
      for (let attempt = 0; attempt < 6 && !ret; attempt += 1) {
        try {
          ret = await requestKaminoReturnPlan(owner, redeemSig);
        } catch (err) {
          if (attempt === 5) throw new Error(`Redeemed; sending to the wallet failed: ${errorText(err)}. Use "Withdraw all".`);
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
      if (!ret) throw new Error('Redeemed; use "Withdraw all" to send the USDC to the wallet.');
      if (ret.status === "ready") {
        const net = BigInt(ret.amountRaw ?? "0");
        results.push({ label: `${formatUsdc(net)} USDC Safe → wallet`, signature: await sign(ret, "withdraw", net) });
      }
      if (redeem.remainingTargetSharesRaw && BigInt(redeem.remainingTargetSharesRaw) > BigInt(0)) {
        setError("Kamino liquidity covered only part of it this time; press again for the rest.");
      }
      return results;
    });

  const s = summary;
  const disabled = busy !== null;
  const btn =
    "inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const primary = `${btn} bg-primary text-primary-foreground`;
  const secondary = `${btn} border border-border text-foreground hover:bg-muted`;
  const label = (id: string, text: string) => (busy === id ? "Sign…" : text);

  return (
    <section className="panel-glass overflow-hidden rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">&gt;&gt; solana safe</p>
          <h3 className="mt-1 text-sm font-semibold">
            {s?.safe ? (
              <a href={`https://solscan.io/account/${s.safe}`} target="_blank" rel="noreferrer" className="hover:underline">
                Safe {short(s.safe)}
              </a>
            ) : (
              "Your Safe"
            )}
          </h3>
        </div>
        <button type="button" onClick={() => void refresh(true)} className="text-[11px] text-muted-foreground hover:text-foreground">
          Refresh
        </button>
      </div>

      {!s ? (
        <p className="mt-2 text-xs text-muted-foreground">{loadError ? `Could not load the Safe: ${loadError}` : "Loading…"}</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Wallet</dt>
              <dd className="font-medium tabular-nums">{usd(s.walletUsdc)} USDC</dd>
            </div>
            {s.exists ? (
              <>
                <div>
                  <dt className="text-muted-foreground">Idle in Safe</dt>
                  <dd className="font-medium tabular-nums">{usd(s.idleUsdc)} USDC</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">In Kamino</dt>
                  <dd className="font-medium tabular-nums">{usd(s.kamino.valueUsdc)} USDC</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Earned in Kamino</dt>
                  <dd className="font-medium tabular-nums">+{usd(s.kamino.gainUsdc)} USDC</dd>
                </div>
              </>
            ) : null}
          </dl>

          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              disabled={disabled}
              onChange={(event) => {
                setError(null);
                setAmount(event.target.value.trim().replace(",", "."));
              }}
              placeholder="Amount"
              aria-label="Amount in USDC"
              className="h-9 min-w-0 flex-1 rounded-xl border border-border/80 bg-muted/40 px-3 text-sm tabular-nums outline-none focus:border-foreground/30"
            />
            <span className="text-xs text-muted-foreground">USDC</span>
          </div>

          {!s.exists ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] text-muted-foreground">No Safe yet. Creation is one transaction; Solana charges a little SOL for rent.</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={disabled} onClick={() => void createSafe(false)} className={primary}>
                  {label("create", "Create Safe")}
                </button>
                <button type="button" disabled={disabled || amountRaw === null} onClick={() => void createSafe(true)} className={secondary}>
                  {label("create-deposit", "Create + deposit")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Deposit from wallet</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" disabled={disabled || amountRaw === null} onClick={() => void deposit(false)} className={primary}>
                    {label("deposit", "To Safe")}
                  </button>
                  <button type="button" disabled={disabled || amountRaw === null} onClick={() => void deposit(true)} className={secondary}>
                    {label("deposit-kamino", "To Kamino")}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Idle USDC in the Safe</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" disabled={disabled || amountRaw === null} onClick={() => void idleToKamino()} className={secondary}>
                    {label("idle-kamino", "Put into Kamino")}
                  </button>
                  <button type="button" disabled={disabled || amountRaw === null} onClick={() => void withdrawIdle(false)} className={secondary}>
                    {label("withdraw", "Withdraw")}
                  </button>
                  <button type="button" disabled={disabled || s.idleUsdc <= 0} onClick={() => void withdrawIdle(true)} className={secondary}>
                    {label("withdraw-all", "Withdraw all")}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Exit Kamino to wallet{s.performanceFeeBps ? ` · ${s.performanceFeeBps / 100}% fee on the gain` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {["25", "50", "100"].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      disabled={disabled || s.kamino.sharesRaw === "0"}
                      onClick={() => void exitKamino(percent)}
                      className={secondary}
                    >
                      {busy === `exit-${percent}` ? "Sign…" : `${percent}%`}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">Two signatures: redeem into the Safe, then send to the wallet.</p>
              </div>
            </div>
          )}
        </>
      )}

      {error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {done.length ? (
        <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {done.map((item) => (
            <li key={item.signature}>
              ✓ {item.label} ·{" "}
              <a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer" className="underline">
                {short(item.signature)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
