"use client";

import { useEffect, useState } from "react";
import { TOKENS_PER_USD, type AiPoolSnapshot } from "@/lib/advisor/aiPool";
import { TickingNumber } from "@/components/agent/TickingNumber";

const SECONDS_PER_MONTH = 30 * 24 * 3600;

/** Start of the current UTC month, in ms. */
function monthStart(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

const STORAGE_KEY = "agent.advisor.inferenceIds.v1";
const MAX_STORED_IDS = 200;

/** Inference ids of this browser's advisor requests, for the cost line. Not content, only ids. */
export function rememberInferenceIds(ids: string[]) {
  if (ids.length === 0) return;
  try {
    const current = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    const next = [...current, ...ids].slice(-MAX_STORED_IDS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("agent-inference-ids"));
  } catch {
    /* private mode */
  }
}

export function forgetInferenceIds() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("agent-inference-ids"));
  } catch {
    /* private mode */
  }
}

function storedIds(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function usd(value: number): string {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/**
 * One line under the chat: what the staked AI pool funds per month (read from NEAR mainnet) and
 * what this chat has cost so far (NEAR AI billing, by inference id).
 */
export function AiPoolMeter({ className }: { className?: string } = {}) {
  const [pool, setPool] = useState<AiPoolSnapshot | null>(null);
  const [spent, setSpent] = useState<{ usd: number; requests: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/agent/api/ai-pool", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active && json && typeof json.usdPerMonth === "number") setPool(json as AiPoolSnapshot);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const ids = storedIds().slice(-50);
      if (ids.length === 0) {
        setSpent(null);
        return;
      }
      fetch("/agent/api/ai-pool/costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestIds: ids }),
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (active && json && typeof json.totalUsd === "number") setSpent({ usd: json.totalUsd, requests: ids.length });
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("agent-inference-ids", refresh);
    return () => {
      active = false;
      window.removeEventListener("agent-inference-ids", refresh);
    };
  }, []);

  if (!pool && !spent) return null;
  return (
    <p
      className={className ?? "px-3.5 pb-1 text-[10.5px] leading-relaxed text-muted-foreground sm:px-5"}
      title={
        pool
          ? `NEAR staked by ${pool.account} on ${pool.validator} via NEAR AI Staking for Inference. Rate measured on-chain over ${pool.measuredOverSeconds}s at ${pool.measuredAt}; ~$0.001 per advisor request.`
          : undefined
      }
    >
      {pool ? (
        <>
          {`Free AI comes from our NEAR staking pool: ${pool.stakedNear.toLocaleString("en-US", { maximumFractionDigits: 2 })} NEAR staked → ${usd(pool.usdPerMonth)}/month ≈ ${pool.requestsPerMonth.toLocaleString("en-US")} private requests. This month so far: `}
          <TickingNumber
            base={0}
            perSecond={(pool.usdPerMonth / SECONDS_PER_MONTH) * TOKENS_PER_USD}
            since={monthStart()}
            className="font-medium text-foreground"
          />
          {" AI tokens"}
        </>
      ) : null}
      {pool && spent ? " · " : null}
      {spent ? `this browser: ${spent.requests} requests, ${usd(spent.usd)}` : null}
    </p>
  );
}
