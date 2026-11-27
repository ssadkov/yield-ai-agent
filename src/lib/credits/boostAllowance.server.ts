/**
 * Yield AI Boost participants get a monthly private-AI allowance: 30 days of the Season 3 Grain
 * they earn now. `grainPerDay` from the Boost API is the current season's rate on own capital;
 * the API's `grainTotal` covers the whole campaign since 2026-09-07, so it is not used here.
 *
 * The owner is the Aptos account whose agents Boost counts: a native Aptos wallet signs in as
 * itself; a Solana wallet maps to its derived Aptos account on yieldai.app (the address Phantom
 * uses there). Eligibility comes from the main app's public Boost API, cached for ten minutes.
 */
import { derivedAptosAddress, PRODUCTION_HOST } from "../agent/aptosDerived.ts";
import { boostMonthlyUsd, fetchAptosAgent, isAptosAddress, type AptosAgentState } from "../agent/aptosAgent.ts";
import { isSolanaAddress } from "./session.ts";

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; state: AptosAgentState | null }>();

/** Share of the monthly Grain given as AI credits: `ADVISOR_BOOST_GRAIN_SHARE`, default 1; 0 turns it off. */
export function boostGrainShare(): number {
  const value = Number(process.env.ADVISOR_BOOST_GRAIN_SHARE ?? "1");
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** The Aptos owner Boost knows this signed-in wallet as. */
export function boostOwner(wallet: string): string | null {
  if (isAptosAddress(wallet)) return wallet.toLowerCase();
  if (isSolanaAddress(wallet)) return derivedAptosAddress(wallet, PRODUCTION_HOST);
  return null;
}

export async function boostState(wallet: string): Promise<AptosAgentState | null> {
  const owner = boostOwner(wallet);
  if (!owner) return null;
  const hit = cache.get(owner);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const origin = process.env.YIELD_AI_API_ORIGIN?.trim() || `https://${PRODUCTION_HOST}`;
  try {
    const state = await fetchAptosAgent(owner, origin);
    cache.set(owner, { at: Date.now(), state });
    return state;
  } catch {
    // The main app is down: no allowance this time, but do not cache the failure.
    return null;
  }
}

/**
 * The allowance this wallet earns from Boost: 30 days of its current Grain while eligible. It
 * follows the balance, so a deposit or withdrawal changes it once the ten-minute cache expires.
 */
export async function boostAllowanceUsd(
  wallet: string
): Promise<{ owner: string; eligible: boolean; grainPerDay: number; monthlyUsd: number } | null> {
  const state = await boostState(wallet);
  if (!state) return null;
  const grainPerDay = state.boost.eligible ? state.boost.grainPerDay : 0;
  return { owner: state.owner, eligible: state.boost.eligible, grainPerDay, monthlyUsd: boostMonthlyUsd(grainPerDay, boostGrainShare()) };
}
