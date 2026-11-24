"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAptosAgent, type AptosAgentSafe, type AptosAgentState } from "@/lib/agent/aptosAgent";
import { fetchSafeHistory, fetchSafePaused, type SafeHistory } from "@/lib/agent/aptosSafeOps";
import { AptosActionCard } from "@/components/agent/AptosActionCard";
import { derivedAptosAddress, PRODUCTION_HOST } from "@/lib/agent/aptosDerived";

const MAIN_APP = `https://${PRODUCTION_HOST}`;

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: value < 100 ? 2 : 0, maximumFractionDigits: value < 100 ? 2 : 0 })}`;
}

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * The Aptos account Boost counts for this user: a Solana wallet's account derived on yieldai.app
 * (the same on every host, unlike the one the adapter derives here), or a native Aptos wallet.
 */
export function boostOwnerFor(solanaAddress: string | null, aptosAddress: string | null, aptosIsDerived: boolean): string | null {
  if (solanaAddress) {
    try {
      return derivedAptosAddress(solanaAddress, PRODUCTION_HOST);
    } catch {
      return null;
    }
  }
  return aptosAddress && !aptosIsDerived ? aptosAddress.toLowerCase() : null;
}

type Load = { owner: string; state: AptosAgentState | null; error: string | null };

/** One Safe: strategy, value, running or paused, what it earned, and a Pause/Resume the owner signs. */
function SafeRow({ safe, owner, version }: { safe: AptosAgentSafe; owner: string; version: number }) {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [history, setHistory] = useState<SafeHistory | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSafePaused(safe.safe).then((p) => active && setPaused(p));
    fetchSafeHistory(safe.safe, safe.balanceUsd)
      .then((h) => active && setHistory(h))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [safe.safe, safe.balanceUsd, version]);

  const pnl = history?.pnl ?? null;
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {safe.label}
            {paused != null ? (
              <span
                className={`rounded-full px-1.5 py-px text-[10px] font-medium ${paused ? "bg-warning text-warning-foreground" : "bg-primary/15 text-primary"}`}
              >
                {paused ? "paused" : "running"}
              </span>
            ) : null}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground" title={safe.safe}>
            Safe {short(safe.safe)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm tabular-nums">{usd(safe.balanceUsd)}</p>
          {pnl != null ? (
            <p className={`text-[11px] tabular-nums ${pnl < 0 ? "text-danger" : "text-primary"}`} title="Value now minus net deposits">
              {pnl < 0 ? "−" : "+"}
              {usd(Math.abs(pnl))}
              {history?.aprPct != null ? ` · ${history.aprPct.toFixed(1)}%` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {paused != null ? (
        <button
          type="button"
          onClick={() => setActing((v) => !v)}
          className="mt-1 text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
        >
          {acting ? "Close" : paused ? "Resume agent" : "Pause agent"}
        </button>
      ) : null}
      {acting && paused != null ? (
        <AptosActionCard card={{ action: paused ? "resume" : "pause", safe: safe.safe, label: safe.label }} owner={owner} />
      ) : null}
    </li>
  );
}

/** The user's Yield AI agents on Aptos and their Boost season. Pause and resume are signed here; the rest is on yieldai.app. */
export function AptosAgentPanel({
  solanaAddress,
  aptosAddress,
  aptosIsDerived,
}: {
  solanaAddress: string | null;
  aptosAddress: string | null;
  aptosIsDerived: boolean;
}) {
  const owner = useMemo(() => boostOwnerFor(solanaAddress, aptosAddress, aptosIsDerived), [solanaAddress, aptosAddress, aptosIsDerived]);
  const [load, setLoad] = useState<Load | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    const run = () =>
      fetchAptosAgent(owner)
        .then((state) => active && setLoad({ owner, state, error: null }))
        .catch((error: unknown) => active && setLoad({ owner, state: null, error: error instanceof Error ? error.message : String(error) }));
    run();
    const timer = window.setInterval(run, 5 * 60_000);
    // A pause, resume or withdraw signed in the chat or here: read the agents again.
    const changed = () => {
      run();
      setVersion((v) => v + 1);
    };
    window.addEventListener("aptos-agents-changed", changed);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("aptos-agents-changed", changed);
    };
  }, [owner]);

  if (!owner) return null;
  const current = load?.owner === owner ? load : null;
  const state = current?.state ?? null;
  const boost = state?.boost;
  // A Solana user who has never used Yield AI on Aptos does not need an empty Aptos card.
  if (solanaAddress && (!current || current.error || !state || state.safes.length === 0)) return null;

  return (
    <section className="panel-glass overflow-hidden rounded-2xl px-4 py-3" aria-label="Your Aptos agents">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">&gt;&gt; aptos agents</p>
        <span className="font-mono text-[11px] text-muted-foreground" title={owner}>
          {short(owner)}
        </span>
      </div>

      {!current ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : current.error ? (
        <p className="mt-2 text-sm text-muted-foreground">Aptos agents are unavailable right now.</p>
      ) : !state || state.safes.length === 0 ? (
        <div className="mt-2">
          <h3 className="text-sm font-semibold">No Aptos agents yet</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Agents run Aptos strategies (stablecoin compound, loops, LP, delta-neutral) in your own Safe. Boost participants also
            get a monthly private-AI allowance here.
          </p>
        </div>
      ) : (
        <>
          <h3 className="mt-1 text-lg font-semibold tabular-nums">{usd(state.totalUsd)}</h3>
          <ul className="mt-2 divide-y divide-border">
            {state.safes.map((s) => (
              <SafeRow key={s.safe} safe={s} owner={owner} version={version} />
            ))}
          </ul>
        </>
      )}

      {boost && state && state.safes.length > 0 ? (
        <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2.5">
          <p className="text-xs font-medium">
            {boost.eligible ? (
              <>
                Boost <span className="text-primary">+{boost.rateAprPct}% APR</span> · earning
              </>
            ) : (
              <>
                Boost not earning
                {boost.shortfallUsd > 0 ? ` · ${usd(boost.shortfallUsd)} more to reach ${usd(boost.minBalanceUsd)}` : ""}
              </>
            )}
          </p>
          {boost.eligible || boost.paidToDateUsd > 0 ? (
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <dt>Grain</dt>
              <dd className="text-right tabular-nums text-foreground">
                {boost.grainTotal.toFixed(2)}
                {boost.grainPerDay > 0 ? ` (+${boost.grainPerDay.toFixed(2)}/day)` : ""}
              </dd>
              <dt>Paid in USDC</dt>
              <dd className="text-right tabular-nums text-foreground">{usd(boost.paidToDateUsd)}</dd>
              <dt>Last payout</dt>
              <dd className="text-right tabular-nums text-foreground">{boost.lastPayoutAt?.slice(0, 10) ?? "none yet"}</dd>
            </dl>
          ) : null}
        </div>
      ) : null}

      <a
        href={MAIN_APP}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-full border border-border text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {state && state.safes.length > 0 ? "Manage on yieldai.app" : "Create an agent on yieldai.app"}
      </a>
    </section>
  );
}
