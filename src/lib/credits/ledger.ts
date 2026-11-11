/**
 * Advisor credit balance for one wallet, in dollars of NEAR AI usage.
 *
 * Sources, in the order they are spent:
 * 1. a monthly free allowance funded by the staked AI pool;
 * 2. the wallet's own Safe yield: the performance fee the Safe program has accrued on its Kamino
 *    gain (collected on exit, so it is granted before it is realized);
 * 3. credits bought through NEAR Intents 1-Click.
 * Spending is the real NEAR AI cost of each request (or an estimate until billing reports it).
 * Only what a month spends above the free allowance draws on yield, then on purchases, so paid
 * credits are used last.
 */

export type MonthSpend = { month: string; usd: number };

export type CreditBalance = {
  freeMonthlyUsd: number;
  freeLeftUsd: number;
  yieldUsd: number;
  yieldLeftUsd: number;
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
  /** Accrued performance fee on the wallet's Safe yield, in dollars. */
  yieldUsd?: number;
  purchasedUsd: number;
  spendByMonth: readonly MonthSpend[];
  now: Date;
}): CreditBalance {
  const { freeMonthlyUsd, purchasedUsd, spendByMonth, now } = input;
  const yieldUsd = Math.max(0, input.yieldUsd ?? 0);
  const current = monthKey(now);
  let paidUsed = 0;
  let spentThisMonth = 0;
  for (const row of spendByMonth) {
    const usd = Math.max(0, row.usd);
    paidUsed += Math.max(0, usd - freeMonthlyUsd);
    if (row.month === current) spentThisMonth += usd;
  }
  const freeLeft = Math.max(0, freeMonthlyUsd - spentThisMonth);
  const fromYield = Math.min(paidUsed, yieldUsd);
  const yieldLeft = yieldUsd - fromYield;
  const purchasedLeft = purchasedUsd - (paidUsed - fromYield);
  return {
    freeMonthlyUsd,
    freeLeftUsd: freeLeft,
    yieldUsd,
    yieldLeftUsd: yieldLeft,
    purchasedUsd,
    purchasedLeftUsd: purchasedLeft,
    spentThisMonthUsd: spentThisMonth,
    availableUsd: freeLeft + yieldLeft + Math.max(0, purchasedLeft),
  };
}

/** Upper bound reserved before a request is forwarded; replaced by the billed cost later. */
export function estimateRequestUsd(maxTokens: number, outputUsdPerMillion = 0.5, inputUsd = 0.001): number {
  return inputUsd + (maxTokens * outputUsdPerMillion) / 1_000_000;
}

/**
 * Whole-dollar purchase sizes. 1-Click's route costs about $0.23 whatever the size (2026-11-11:
 * $1 of credits cost 1.232 USDC, $5 cost 5.061), so $5 is the smallest that makes sense.
 */
export const PURCHASE_OPTIONS_USD = [5, 10, 20] as const;
export const MIN_PURCHASE_USD = 5;
export const MAX_PURCHASE_USD = 50;
