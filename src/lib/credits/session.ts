/**
 * Wallet sign-in for the advisor, stateless.
 *
 * 1. The server issues a challenge for an allowed domain: wallet, nonce, issue and expiry times, and
 *    an HMAC over them (SESSION_SECRET). It sends fields, not text to sign.
 * 2. The browser builds the Sign In With Solana message from those fields (siws.ts) and the wallet
 *    signs it (Ed25519). SIWS-aware wallets refuse when the domain is not the page's.
 * 3. The server rebuilds the same message, checks the HMAC, expiry and signature, then issues a
 *    session token: wallet and expiry with an HMAC. Requests carry it in `x-advisor-session`.
 * A challenge can be replayed only within its 10-minute life and only by the same wallet.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { SIGN_IN_TTL_MS, signInFieldsError, signInMessage } from "./siws.ts";

export const SESSION_HEADER = "x-advisor-session";
const SESSION_TTL_MS = 24 * 60 * 60_000;

function secret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("SESSION_SECRET (32+ chars) is not configured");
  return value;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function macMatches(payload: string, tag: string): boolean {
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(tag);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function isSolanaAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/**
 * Domains a sign-in may name. A challenge for any other domain would let a page elsewhere collect
 * a signature that this server accepts. Production: yieldai.app (SESSION_ALLOWED_HOSTS adds more);
 * a Vercel preview adds its own URLs; local hosts only outside production.
 */
export function allowedSignInHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const hosts = new Set(["yieldai.app"]);
  for (const host of (env.SESSION_ALLOWED_HOSTS ?? "").split(",")) if (host.trim()) hosts.add(host.trim().toLowerCase());
  for (const key of ["VERCEL_URL", "VERCEL_BRANCH_URL"]) if (env.VERCEL_ENV === "preview" && env[key]) hosts.add(String(env[key]).toLowerCase());
  return hosts;
}

export function isAllowedSignInHost(host: string, env: Record<string, string | undefined> = process.env): boolean {
  if (allowedSignInHosts(env).has(host)) return true;
  return env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host);
}

/** What the browser needs to build the message; it never receives text to sign. */
export type Challenge = { wallet: string; domain: string; nonce: string; issuedAt: number; expiresAt: number; tag: string };

function challengePayload(c: Omit<Challenge, "tag">): string {
  return `challenge|v2|${c.wallet}|${c.domain}|${c.nonce}|${c.issuedAt}|${c.expiresAt}`;
}

export function issueChallenge(wallet: string, domain: string, now = Date.now()): Challenge {
  const fields = { wallet, domain, nonce: randomBytes(16).toString("hex"), issuedAt: now, expiresAt: now + SIGN_IN_TTL_MS };
  return { ...fields, tag: mac(challengePayload(fields)) };
}

export function verifyChallenge(input: Challenge & { signature: string; now?: number }): { ok: true; token: string; expiresAt: number } | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  if (!isSolanaAddress(input.wallet)) return { ok: false, error: "Invalid wallet" };
  const fieldError = signInFieldsError(input, now);
  if (fieldError) return { ok: false, error: fieldError };
  if (!macMatches(challengePayload(input), input.tag)) return { ok: false, error: "Challenge was not issued here" };
  const signature = new Uint8Array(Buffer.from(input.signature, "base64"));
  const message = new TextEncoder().encode(signInMessage(input));
  const valid = signature.length === 64 && ed25519.verify(signature, message, new PublicKey(input.wallet).toBytes());
  if (!valid) return { ok: false, error: "Signature does not match the wallet" };
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `session|${input.wallet}|${expiresAt}`;
  return { ok: true, token: `${input.wallet}.${expiresAt}.${mac(payload)}`, expiresAt };
}

/** Wallet behind a session token, or null when it is missing, forged or expired. */
export function walletFromSession(token: string | null, now = Date.now()): string | null {
  if (!token) return null;
  const [wallet, expiresRaw, tag] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!wallet || !tag || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  try {
    return macMatches(`session|${wallet}|${expiresAt}`, tag) ? wallet : null;
  } catch {
    return null;
  }
}
