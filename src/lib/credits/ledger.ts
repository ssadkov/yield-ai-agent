/**
 * Advisor credit balance for one wallet, in dollars of NEAR AI usage.
 *
 * Sources: a monthly free allowance funded by the staked AI pool, and credits the wallet bought
 * through NEAR Intents 1-Click. Spending is the real NEAR AI cost of each request (or an
 * estimate until billing reports it). The free allowance is used first each month; only what a
 * month spends above it comes out of purchased credits, so paid credits never pay for free usage.
 */

export type MonthSpend = { month: string; usd: number };

export type CreditBalance = {
  freeMonthlyUsd: number;
  freeLeftUsd: number;
  purchasedUsd: number;
  purchasedLeftUsd: number;
  spentThisMonthUsd: number;
  availableUsd: number;
};

/** "YYYY-MM" in UTC. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function computeBalance(input: {
  freeMonthlyUsd: number;
  purchasedUsd: number;
  spendByMonth: readonly MonthSpend[];
  now: Date;
}): CreditBalance {
  const { freeMonthlyUsd, purchasedUsd, spendByMonth, now } = input;
  const current = monthKey(now);
  let paidUsed = 0;
  let spentThisMonth = 0;
  for (const row of spendByMonth) {
    const usd = Math.max(0, row.usd);
    paidUsed += Math.max(0, usd - freeMonthlyUsd);
    if (row.month === current) spentThisMonth += usd;
  }
  const freeLeft = Math.max(0, freeMonthlyUsd - spentThisMonth);
  const purchasedLeft = purchasedUsd - paidUsed;
  return {
    freeMonthlyUsd,
    freeLeftUsd: freeLeft,
    purchasedUsd,
    purchasedLeftUsd: purchasedLeft,
    spentThisMonthUsd: spentThisMonth,
    availableUsd: freeLeft + Math.max(0, purchasedLeft),
  };
}

/** Upper bound reserved before a request is forwarded; replaced by the billed cost later. */
export function estimateRequestUsd(maxTokens: number, outputUsdPerMillion = 0.5, inputUsd = 0.001): number {
  return inputUsd + (maxTokens * outputUsdPerMillion) / 1_000_000;
}

/** Whole-cent dollar amount a user may buy in one purchase. */
export const PURCHASE_OPTIONS_USD = [1, 5, 20] as const;
export const MAX_PURCHASE_USD = 50;
