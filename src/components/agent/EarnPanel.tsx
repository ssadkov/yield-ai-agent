"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  readSafeTreasury,
  requestCreationPlan,
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
import { IntentsDepositPanel } from "@/components/agent/IntentsDepositPanel";
import { TickingNumber } from "@/components/agent/TickingNumber";
import { TOKENS_PER_USD, TYPICAL_REQUEST_USD } from "@/lib/advisor/aiPool";

const SECONDS_PER_YEAR = 365 * 24 * 3600;

const KAMINO_MIN_RAW = BigInt(1_000_000);
const KAMINO_ROW_ID = "solana:kamino_usdc";

function usd(value: number, max = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: max });
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Done = { label: string; signature: string };
type Source = "wallet" | "intents";

/** Live Kamino USDC APY from /agent/api/usdc-yields; null while unknown. */
function useKaminoApy(): number | null {
  const [apy, setApy] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/agent/api/usdc-yields", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { rows?: { id: string; ratePct: number | null }[] } | null) => {
        const rate = json?.rows?.find((row) => row.id === KAMINO_ROW_ID)?.ratePct;
        if (active && typeof rate === "number" && Number.isFinite(rate)) setApy(rate);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return apy;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-foreground/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel-popover relative flex max-h-[min(92dvh,46rem)] w-full max-w-md flex-col overflow-hidden rounded-t-[24px] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * One card for the owner's money: what earns, what was earned, Deposit and Withdraw.
 * The Solana Safe is how it works (owner-only vault; its fee on the gain is the AI budget), so its
 * address and the per-leg buttons sit under "Details". Every transaction comes from the Solana
 * Safe API and is checked in this browser before the wallet signs it (src/lib/agent/safePlans.ts).
 */
export function EarnPanel() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const owner = connected && publicKey ? publicKey : null;
  const apy = useKaminoApy();
  const [summary, setSummary] = useState<SafeSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"deposit" | "withdraw" | null>(null);
  const [source, setSource] = useState<Source>("wallet");
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

  const closeDialog = useCallback(() => {
    setDialog(null);
    setError(null);
  }, []);

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

  /** Run one action; on success record its transactions and reload. */
  const run = async (id: string, action: () => Promise<Done[]>, after?: () => void) => {
    setBusy(id);
    setError(null);
    try {
      const results = await action();
      setDone((prev) => [...results, ...prev].slice(0, 6));
      await refresh(true);
      after?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const s = summary;
  const inKamino = s?.exists ? s.kamino.valueUsdc : 0;
  const idle = s?.exists ? s.idleUsdc : 0;
  const total = inKamino + idle;
  const hasMoney = total > 0;

  /** Wallet USDC into Kamino. Without a Safe: create it with the deposit, then move it into Kamino. */
  const depositFromWallet = () =>
    run(
      "deposit",
      async () => {
        if (amountRaw === null) throw new Error("Enter a USDC amount, up to 6 decimals.");
        if (amountRaw < KAMINO_MIN_RAW) throw new Error("Kamino needs at least 1 USDC.");
        const text = formatUsdc(amountRaw);
        if (!s?.exists) {
          const results: Done[] = [];
          const create = await requestCreationPlan(owner, text);
          results.push({ label: `Account created, ${text} USDC in`, signature: await sign(create, "create_safe_and_deposit", amountRaw) });
          // The API's RPC can lag a few seconds behind ours on the new Safe.
          let plan: SafePlan | null = null;
          for (let attempt = 0; attempt < 6 && !plan; attempt += 1) {
            try {
              plan = await requestKaminoDepositPlan(owner, text, "safe");
            } catch (err) {
              if (attempt === 5) throw new Error(`Account created; moving into Kamino failed: ${errorText(err)}. Use "Put it to work".`);
              await new Promise((resolve) => setTimeout(resolve, 3_000));
            }
          }
          results.push({ label: `${text} USDC → Kamino`, signature: await sign(plan!, "kamino_deposit", amountRaw) });
          return results;
        }
        const plan = await requestKaminoDepositPlan(owner, text, "wallet");
        return [{ label: `${text} USDC wallet → Kamino`, signature: await sign(plan, "kamino_deposit_from_wallet", amountRaw) }];
      },
      () => {
        setAmount("");
        setDialog(null);
      }
    );

  const createAccount = () =>
    run("create", async () => {
      const plan = await requestCreationPlan(owner);
      return [{ label: "Account created", signature: await sign(plan, "create_safe") }];
    });

  /** Idle USDC (e.g. from NEAR Intents) into Kamino. */
  const idleToKamino = () =>
    run("idle-kamino", async () => {
      const raw = parseUsdc(String(idle));
      if (raw === null || raw < KAMINO_MIN_RAW) throw new Error("Kamino needs at least 1 USDC.");
      const plan = await requestKaminoDepositPlan(owner, formatUsdc(raw), "safe");
      return [{ label: `${formatUsdc(raw)} USDC → Kamino`, signature: await sign(plan, "kamino_deposit", raw) }];
    });

  const withdrawIdle = () =>
    run("withdraw-idle", async () => {
      const plan = await requestWithdrawPlan(owner, "all");
      if (plan.status === "empty") throw new Error("Nothing idle to withdraw.");
      const planned = BigInt(plan.amountRaw ?? "0");
      return [{ label: `${formatUsdc(planned)} USDC → wallet`, signature: await sign(plan, "withdraw", planned) }];
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
          if (attempt === 5) throw new Error(`Redeemed; sending to the wallet failed: ${errorText(err)}. Use "Withdraw idle".`);
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
      if (!ret) throw new Error('Redeemed; use "Withdraw idle" to send the USDC to the wallet.');
      if (ret.status === "ready") {
        const net = BigInt(ret.amountRaw ?? "0");
        results.push({ label: `${formatUsdc(net)} USDC → wallet`, signature: await sign(ret, "withdraw", net) });
      }
      if (redeem.remainingTargetSharesRaw && BigInt(redeem.remainingTargetSharesRaw) > BigInt(0)) {
        setError("Kamino liquidity covered only part of it this time; press again for the rest.");
      }
      return results;
    });

  const disabled = busy !== null;
  const btn =
    "inline-flex h-10 items-center justify-center rounded-full px-4 text-[14px] font-medium disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const primary = `${btn} bg-primary text-primary-foreground`;
  const secondary = `${btn} border border-border text-foreground hover:bg-muted`;
  const small =
    "inline-flex h-8 items-center justify-center rounded-full border border-border px-3 text-[13px] font-medium hover:bg-muted disabled:opacity-40";
  const label = (id: string, text: string) => (busy === id ? "Sign in wallet…" : text);
  const apyText = apy !== null ? `~${apy.toFixed(1)}% APY` : "variable APY";
  // What the fee on Kamino's yield buys, live: dollars a second → GLM output tokens.
  const feeRate = (s?.performanceFeeBps ?? 0) / 10_000;
  const feeUsdPerSecond = (usdc: number) => (apy !== null ? (usdc * (apy / 100) * feeRate) / SECONDS_PER_YEAR : 0);
  const tokensPerSecond = feeUsdPerSecond(inKamino) * TOKENS_PER_USD;
  const requestsPerMonth = Math.round((feeUsdPerSecond(inKamino) * 30 * 86_400) / TYPICAL_REQUEST_USD);
  const perThousandRequests = Math.round((feeUsdPerSecond(1000) * 30 * 86_400) / TYPICAL_REQUEST_USD);
  const feeText = s?.performanceFeeBps ? `${s.performanceFeeBps / 100}%` : null;

  const errorLine = error ? (
    <p className="mt-3 text-[13px] leading-relaxed text-danger" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <section className="panel-glass overflow-hidden rounded-2xl px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight">Earn on USDC</h3>
        <span className="text-[13px] font-medium text-emerald-600 dark:text-emerald-300">{apyText}</span>
      </div>

      {!s ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{loadError ? `Could not load: ${loadError}` : "Loading…"}</p>
      ) : hasMoney ? (
        <>
          <p className="mt-3 text-[26px] font-semibold tabular-nums tracking-tight">${usd(total)}</p>
          <p className="text-[13px] text-muted-foreground">earned +${usd(s.kamino.gainUsdc, 6)}</p>
          {feeRate > 0 ? (
            <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
              <p className="text-[12px] text-muted-foreground">AI tokens your yield has paid for</p>
              <TickingNumber
                base={s.aiBudgetUsdc * TOKENS_PER_USD}
                perSecond={tokensPerSecond}
                since={Date.parse(s.updatedAt)}
                className="block text-[22px] font-semibold tracking-tight text-emerald-700 dark:text-emerald-300"
              />
              <p
                className="text-[12px] text-muted-foreground"
                title="Output tokens of GLM 5.3 Flash at $0.50 per 1M; a typical advisor request costs about $0.001."
              >
                {tokensPerSecond > 0
                  ? `+${Math.round(tokensPerSecond * 86_400).toLocaleString("en-US")} a day · ≈ ${requestsPerMonth.toLocaleString("en-US")} requests a month`
                  : "Grows while your USDC is in Kamino."}
              </p>
            </div>
          ) : null}
          {idle > 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              ${usd(idle, 6)} is not earning yet.{" "}
              <button type="button" disabled={disabled || idle < 1} onClick={() => void idleToKamino()} className="font-medium text-foreground underline underline-offset-2 disabled:opacity-40">
                {label("idle-kamino", "Put it to work")}
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Kamino lending, withdraw anytime. You keep the keys; the fee on what you earn pays for your private AI
          {perThousandRequests > 0
            ? `: every $1,000 here buys ≈ ${perThousandRequests.toLocaleString("en-US")} requests a month.`
            : "."}
        </p>
      )}

      {s ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={disabled} onClick={() => setDialog("deposit")} className={hasMoney ? primary : `${primary} col-span-2`}>
            Deposit
          </button>
          {hasMoney ? (
            <button type="button" disabled={disabled} onClick={() => setDialog("withdraw")} className={secondary}>
              Withdraw
            </button>
          ) : null}
        </div>
      ) : null}

      {dialog === null ? errorLine : null}

      {done.length ? (
        <ul className="mt-3 space-y-0.5 text-[12px] text-muted-foreground">
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

      {s ? (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Details</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">Wallet</dt>
            <dd className="text-right tabular-nums">{usd(s.walletUsdc, 6)} USDC</dd>
            <dt className="text-muted-foreground">In Kamino</dt>
            <dd className="text-right tabular-nums">{usd(inKamino, 6)} USDC</dd>
            <dt className="text-muted-foreground">Idle</dt>
            <dd className="text-right tabular-nums">{usd(idle, 6)} USDC</dd>
            {feeText ? (
              <>
                <dt className="text-muted-foreground">Fee on gain</dt>
                <dd className="text-right">{feeText}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Safe</dt>
            <dd className="text-right">
              {s.safe ? (
                <a href={`https://solscan.io/account/${s.safe}`} target="_blank" rel="noreferrer" className="underline">
                  {short(s.safe)}
                </a>
              ) : (
                "not created"
              )}
            </dd>
          </dl>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Your Safe is a Solana account only your wallet controls. The advisor proposes; you sign.
          </p>
          <button type="button" onClick={() => void refresh(true)} className="mt-2 text-[12px] text-muted-foreground underline hover:text-foreground">
            Refresh
          </button>
        </details>
      ) : null}

      {dialog === "deposit" && s ? (
        <Modal title="Deposit USDC" onClose={closeDialog}>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-[13px] font-medium" role="tablist">
            {(
              [
                ["wallet", "From this wallet"],
                ["intents", "Any chain · NEAR Intents"],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={source === id}
                onClick={() => {
                  setSource(id);
                  setError(null);
                }}
                className={["h-8 rounded-full px-2", source === id ? "bg-background shadow-sm" : "text-muted-foreground"].join(" ")}
              >
                {text}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border/70 px-3 py-2.5 text-[13px]">
            <p className="font-medium">Flexible · Kamino · {apyText}</p>
            <p className="text-muted-foreground">Withdraw anytime{feeText ? ` · ${feeText} fee on the gain pays for your AI` : ""}.</p>
          </div>

          {source === "wallet" ? (
            <>
              <label className="mt-4 block text-[13px] font-medium text-muted-foreground" htmlFor="earn-amount">
                Amount
              </label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-3">
                <input
                  id="earn-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  disabled={disabled}
                  onChange={(event) => {
                    setError(null);
                    setAmount(event.target.value.trim().replace(",", "."));
                  }}
                  placeholder="0.00"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[16px] tabular-nums outline-none"
                />
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.floor(s.walletUsdc * 1e6) / 1e6))}
                  className="text-[12px] font-medium text-primary"
                >
                  Max
                </button>
                <span className="text-[13px] text-muted-foreground">USDC</span>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">Wallet: {usd(s.walletUsdc, 6)} USDC · minimum 1 USDC</p>
              <button
                type="button"
                disabled={disabled || amountRaw === null}
                onClick={() => void depositFromWallet()}
                className={`${primary} mt-4 w-full`}
              >
                {label("deposit", amountRaw !== null ? `Deposit ${formatUsdc(amountRaw)} USDC` : "Deposit")}
              </button>
              {!s.exists ? (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  First deposit: two signatures. One creates your account (Solana charges a little SOL for rent), one puts the USDC
                  into Kamino.
                </p>
              ) : null}
            </>
          ) : !s.exists ? (
            <div className="mt-4 text-[13px] leading-relaxed">
              <p className="text-muted-foreground">
                NEAR Intents pays into your account, so it needs to exist first. One transaction; Solana charges a little SOL for
                rent.
              </p>
              <button type="button" disabled={disabled} onClick={() => void createAccount()} className={`${primary} mt-3 w-full`}>
                {label("create", "Create my account")}
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Pay from any chain or token; NEAR Intents delivers USDC to your account. Then press “Put it to work” on the card.
              </p>
              <IntentsDepositPanel aptosAddress={null} aptosIsDerived={false} embedded />
            </div>
          )}
          {errorLine}
        </Modal>
      ) : null}

      {dialog === "withdraw" && s ? (
        <Modal title="Withdraw to wallet" onClose={closeDialog}>
          {inKamino > 0 ? (
            <div>
              <p className="text-[14px]">
                In Kamino: <strong className="tabular-nums">{usd(inKamino, 6)} USDC</strong>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ["25", "25%"],
                  ["50", "50%"],
                  ["100", "All"],
                ].map(([percent, text]) => (
                  <button key={percent} type="button" disabled={disabled} onClick={() => void exitKamino(percent)} className={small}>
                    {busy === `exit-${percent}` ? "Sign in wallet…" : text}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Two signatures: redeem from Kamino{feeText ? ` (${feeText} fee on the gain)` : ""}, then send to your wallet.
              </p>
            </div>
          ) : null}
          {idle > 0 ? (
            <div className={inKamino > 0 ? "mt-4 border-t border-border pt-4" : ""}>
              <p className="text-[14px]">
                Idle: <strong className="tabular-nums">{usd(idle, 6)} USDC</strong>
              </p>
              <button type="button" disabled={disabled} onClick={() => void withdrawIdle()} className={`${small} mt-2`}>
                {label("withdraw-idle", "Withdraw idle")}
              </button>
            </div>
          ) : null}
          {!hasMoney ? <p className="text-[14px] text-muted-foreground">Nothing to withdraw.</p> : null}
          {errorLine}
        </Modal>
      ) : null}
    </section>
  );
}
