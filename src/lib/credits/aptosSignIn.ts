/**
 * Sign-in with a native Aptos wallet (Petra and other AIP-62 wallets), shared by browser and server.
 *
 * The browser asks the wallet to sign `message` with `nonce`, `address` and `application` included.
 * The wallet itself writes `application` (the page's origin) into the text it signs, so a
 * signature collected on another site names that site and is refused here. The server sends only a
 * nonce and times, never text to sign, as with Solana (siws.ts).
 *
 * Wallets sign this full text:
 *   APTOS
 *   address: 0x…
 *   application: https://yieldai.app
 *   chainId: 1
 *   message: <message>
 *   nonce: <nonce>
 *
 * Kept free of `@/` imports and Node APIs: it runs in the browser and under plain `node --test`.
 */
import { SIWS_STATEMENT, signInFieldsError } from "./siws.ts";

export type AptosSignInFields = {
  /** Origin the wallet will report, e.g. https://yieldai.app */
  application: string;
  /** Canonical 0x + 64 hex. */
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export function aptosSignInMessage(fields: Pick<AptosSignInFields, "issuedAt" | "expiresAt">): string {
  return [SIWS_STATEMENT, `Issued At: ${new Date(fields.issuedAt).toISOString()}`, `Expiration Time: ${new Date(fields.expiresAt).toISOString()}`].join("\n");
}

/** 0x + 64 lowercase hex, or null. */
export function canonicalAptosAddress(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,64}$/.test(hex)) return null;
  return `0x${hex.padStart(64, "0")}`;
}

/** Fields the wallet put into the signed text, or an error. */
export function parseAptosFullMessage(full: string): { address?: string; application?: string; chainId?: string; message: string; nonce: string } | string {
  if (!full.startsWith("APTOS\n")) return "Not an Aptos signed message";
  const messageStart = full.indexOf("\nmessage: ");
  const nonceStart = full.lastIndexOf("\nnonce: ");
  if (messageStart < 0 || nonceStart < messageStart) return "Signed message has no message or nonce";
  const header: Record<string, string> = {};
  for (const line of full.slice("APTOS\n".length, messageStart).split("\n")) {
    const colon = line.indexOf(": ");
    if (colon <= 0) return "Unreadable signed message header";
    const key = line.slice(0, colon);
    if (!["address", "application", "chainId"].includes(key) || key in header) return "Unexpected field in signed message";
    header[key] = line.slice(colon + 2);
  }
  return {
    ...header,
    message: full.slice(messageStart + "\nmessage: ".length, nonceStart),
    nonce: full.slice(nonceStart + "\nnonce: ".length),
  };
}

/** Everything about the signed text except the signature itself. */
export function aptosFullMessageError(full: string, expected: AptosSignInFields, now = Date.now()): string | null {
  const fieldError = signInFieldsError(
    { domain: new URL(expected.application).host, wallet: expected.address, nonce: expected.nonce, issuedAt: expected.issuedAt, expiresAt: expected.expiresAt },
    now
  );
  if (fieldError) return fieldError;
  const parsed = parseAptosFullMessage(full);
  if (typeof parsed === "string") return parsed;
  if (!parsed.address || canonicalAptosAddress(parsed.address) !== expected.address) return "Signed for another address";
  if (!parsed.application || parsed.application.replace(/\/$/, "") !== expected.application) return "Signed on another site";
  if (parsed.chainId !== undefined && parsed.chainId !== "1") return "Signed for another Aptos network";
  if (parsed.nonce !== expected.nonce) return "Wrong sign-in nonce";
  if (parsed.message !== aptosSignInMessage(expected)) return "Signed another message";
  return null;
}
