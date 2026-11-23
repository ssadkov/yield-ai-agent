/**
 * The sign-in message, built the same way by the browser and the server.
 *
 * It follows Sign In With Solana (SIWS). Wallets that recognise the format, Phantom first, check
 * that its domain is the page asking for the signature and refuse otherwise, so a signature cannot
 * be collected on another site and replayed here. The browser builds the text itself from a few
 * fields it validates; it never signs text the server sends, so a compromised server cannot get a
 * signature over anything but a sign-in for this wallet on this domain.
 *
 * Kept free of `@/` imports and Node APIs: it runs in the browser and under plain `node --test`.
 */

export const SIWS_STATEMENT = "Sign in to the Yield AI private advisor. This does not move funds or approve a transaction.";
export const SIGN_IN_TTL_MS = 10 * 60_000;

export type SignInFields = {
  /** Host of the page, e.g. `yieldai.app` or `localhost:3040`. */
  domain: string;
  wallet: string;
  /** 32 hex characters from the server. */
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

const NONCE = /^[0-9a-f]{32}$/;
const DOMAIN = /^[a-z0-9.-]+(:\d{1,5})?$/;

function isLocal(domain: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain);
}

/** Reject fields a browser should not sign, whoever sent them. */
export function signInFieldsError(fields: SignInFields, now = Date.now()): string | null {
  if (!DOMAIN.test(fields.domain)) return "Invalid sign-in domain";
  if (!NONCE.test(fields.nonce)) return "Invalid sign-in nonce";
  if (!Number.isFinite(fields.issuedAt) || !Number.isFinite(fields.expiresAt)) return "Invalid sign-in time";
  if (fields.expiresAt <= fields.issuedAt || fields.expiresAt - fields.issuedAt > SIGN_IN_TTL_MS) return "Invalid sign-in lifetime";
  if (fields.expiresAt < now) return "Sign-in challenge expired";
  return null;
}

export function signInMessage(fields: SignInFields): string {
  const scheme = isLocal(fields.domain) ? "http" : "https";
  return [
    `${fields.domain} wants you to sign in with your Solana account:`,
    fields.wallet,
    "",
    SIWS_STATEMENT,
    "",
    `URI: ${scheme}://${fields.domain}/agent`,
    "Version: 1",
    `Nonce: ${fields.nonce}`,
    `Issued At: ${new Date(fields.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(fields.expiresAt).toISOString()}`,
  ].join("\n");
}
