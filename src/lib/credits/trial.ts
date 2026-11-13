/**
 * Free trial without a wallet: a few Yield Advisor requests a day per visitor, under one daily
 * cap for all visitors together, paid from the AI pool like the free allowance.
 *
 * A visitor is an HMAC of their IP (SESSION_SECRET), stored as the usage row's wallet
 * (`guest:<hash>`). No IP is stored. Without SESSION_SECRET there is no trial.
 */
import { createHmac } from "node:crypto";

export const GUEST_PREFIX = "guest:";

export type TrialLimits = { requestsPerDay: number; allGuestsUsdPerDay: number };

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function trialLimits(): TrialLimits {
  return {
    // One advisor question is 1–3 requests (tool calls), so 10 is about three questions.
    requestsPerDay: Math.floor(envNumber("ADVISOR_TRIAL_REQUESTS_PER_DAY", 10)),
    allGuestsUsdPerDay: envNumber("ADVISOR_TRIAL_USD_PER_DAY", 0.1),
  };
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

/** The visitor's usage key, or null when there is no IP or no secret to hash it with. */
export function guestKey(ip: string | null, secret = process.env.SESSION_SECRET?.trim()): string | null {
  if (!ip || !secret || secret.length < 32) return null;
  return GUEST_PREFIX + createHmac("sha256", secret).update(`trial:${ip}`).digest("base64url").slice(0, 24);
}

export type TrialState = {
  allowed: boolean;
  requestsLeft: number;
  requestsPerDay: number;
  reason?: "visitor_limit" | "daily_cap";
};

export function trialState(input: { guestRequestsToday: number; allGuestsUsdToday: number; limits: TrialLimits }): TrialState {
  const { guestRequestsToday, allGuestsUsdToday, limits } = input;
  const requestsLeft = Math.max(0, limits.requestsPerDay - guestRequestsToday);
  if (allGuestsUsdToday >= limits.allGuestsUsdPerDay) {
    return { allowed: false, requestsLeft: 0, requestsPerDay: limits.requestsPerDay, reason: "daily_cap" };
  }
  if (requestsLeft === 0) {
    return { allowed: false, requestsLeft, requestsPerDay: limits.requestsPerDay, reason: "visitor_limit" };
  }
  return { allowed: true, requestsLeft, requestsPerDay: limits.requestsPerDay };
}

export const TRIAL_USED_UP =
  "You've used today's free tries. Connect a Solana wallet to keep chatting: $0.05 of private AI free every month.";
export const TRIAL_CAP_REACHED =
  "Free tries without a wallet are used up for today. Connect a Solana wallet to keep chatting.";
