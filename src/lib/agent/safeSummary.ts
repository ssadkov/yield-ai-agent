/**
 * One view of an owner's Solana Safe for the left panel and for AI billing:
 * idle USDC, the Kamino position at the current share price, its gain over the tracked principal,
 * and the performance fee the program will take from that gain on exit.
 *
 * That accrued fee is the owner's AI budget from yield: the program collects it on any Kamino exit,
 * so it is safe to grant inference credits against it before it is realized.
 */

export const KAMINO_USDC_VAULT = "91b1opzHNUQobfLZxGMNYT5qDRKoqV8FdsdQBmH4wBxy";

export type SafeSummary = {
  owner: string;
  exists: boolean;
  safe: string | null;
  walletUsdc: number;
  walletSol: number;
  idleUsdc: number;
  kamino: {
    sharesRaw: string;
    valueUsdc: number;
    principalUsdc: number;
    gainUsdc: number;
    tokensPerShare: number;
  };
  performanceFeeBps: number;
  /** performanceFeeBps × gain: what the program will send to the treasury on exit. */
  accruedFeeUsdc: number;
  /** Fees already sent to the treasury on earlier exits (src/lib/credits/realizedFees.ts). */
  realizedFeeUsdc: number;
  /** The owner's AI budget from yield, all time: realized + accrued fees. */
  aiBudgetUsdc: number;
  totalUsdc: number;
  updatedAt: string;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeSafe(input: {
  owner: string;
  state: {
    exists?: boolean;
    safe?: string;
    walletUsdc?: string;
    walletSolLamports?: string;
    idleUsdc?: string;
  };
  position: { sharesRaw?: string; sharesDecimals?: number; principalUsdc?: string } | null;
  tokensPerShare: number;
  performanceFeeBps: number;
  realizedFeeUsdc?: number;
  now?: Date;
}): SafeSummary {
  const { owner, state, position, tokensPerShare, performanceFeeBps } = input;
  const sharesRaw = position?.sharesRaw ?? "0";
  const decimals = position?.sharesDecimals ?? 6;
  const shares = Number(BigInt(sharesRaw)) / 10 ** decimals;
  const valueUsdc = shares * tokensPerShare;
  const principalUsdc = num(position?.principalUsdc);
  const gainUsdc = Math.max(0, valueUsdc - principalUsdc);
  const idleUsdc = num(state.idleUsdc);
  return {
    owner,
    exists: Boolean(state.exists),
    safe: state.safe ?? null,
    walletUsdc: num(state.walletUsdc),
    walletSol: num(state.walletSolLamports) / 1e9,
    idleUsdc,
    kamino: { sharesRaw, valueUsdc, principalUsdc, gainUsdc, tokensPerShare },
    performanceFeeBps,
    accruedFeeUsdc: (gainUsdc * performanceFeeBps) / 10_000,
    realizedFeeUsdc: Math.max(0, input.realizedFeeUsdc ?? 0),
    aiBudgetUsdc: (gainUsdc * performanceFeeBps) / 10_000 + Math.max(0, input.realizedFeeUsdc ?? 0),
    totalUsdc: idleUsdc + valueUsdc,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}
