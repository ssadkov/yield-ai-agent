/**
 * Wallet sign-in for the advisor, stateless.
 *
 * 1. The server issues a challenge: wallet, expiry and an HMAC over both (SESSION_SECRET).
 * 2. The wallet signs the human-readable message built from it (Solana `signMessage`, Ed25519).
 * 3. The server checks the HMAC, expiry and signature, then issues a session token: wallet and
 *    expiry with an HMAC. Requests carry it in `x-advisor-session`.
 * A challenge can be replayed only within its 10-minute life and only by the same wallet.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";

export const SESSION_HEADER = "x-advisor-session";
const CHALLENGE_TTL_MS = 10 * 60_000;
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

export type Challenge = { wallet: string; nonce: string; expiresAt: number; tag: string; message: string };

export function challengeMessage(wallet: string, nonce: string, expiresAt: number, host: string): string {
  return [
    "Yield AI advisor sign-in",
    "",
    "Sign to use the private advisor with this wallet. This does not move funds.",
    "",
    `Wallet: ${wallet}`,
    `Host: ${host}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
}

export function issueChallenge(wallet: string, host: string, now = Date.now()): Challenge {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const tag = mac(`challenge|${wallet}|${nonce}|${expiresAt}|${host}`);
  return { wallet, nonce, expiresAt, tag, message: challengeMessage(wallet, nonce, expiresAt, host) };
}

export function verifyChallenge(input: {
  wallet: string;
  nonce: string;
  expiresAt: number;
  tag: string;
  host: string;
  signature: string;
  now?: number;
}): { ok: true; token: string; expiresAt: number } | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  if (!isSolanaAddress(input.wallet)) return { ok: false, error: "Invalid wallet" };
  if (!Number.isFinite(input.expiresAt) || input.expiresAt < now) return { ok: false, error: "Challenge expired" };
  if (!macMatches(`challenge|${input.wallet}|${input.nonce}|${input.expiresAt}|${input.host}`, input.tag)) {
    return { ok: false, error: "Challenge was not issued here" };
  }
  const signature = new Uint8Array(Buffer.from(input.signature, "base64"));
  const message = new TextEncoder().encode(challengeMessage(input.wallet, input.nonce, input.expiresAt, input.host));
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
