/**
 * Browser side of advisor credits: wallet sign-in, the session header, balance and purchases.
 * The session token only proves which wallet is chatting; it carries no funds or keys.
 */

import { signInFieldsError, signInMessage, type SignInFields } from "./siws.ts";
import { aptosSignInMessage, canonicalAptosAddress } from "./aptosSignIn.ts";

export const SESSION_HEADER = "x-advisor-session";
const STORAGE_KEY = "agent.advisor.session.v1";
const API = "/agent/api";

export type StoredSession = { wallet: string; token: string; expiresAt: number };

export function loadSession(wallet?: string | null): StoredSession | null {
  try {
    const session = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as StoredSession | null;
    if (!session || session.expiresAt < Date.now() + 60_000) return null;
    if (wallet && session.wallet !== wallet) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("agent-session"));
}

export function sessionHeaders(): Record<string, string> {
  const session = loadSession();
  return session ? { [SESSION_HEADER]: session.token } : {};
}

/**
 * Sign in with the wallet; store the session on success.
 * The server sends fields, and this browser builds the Sign In With Solana text from them after
 * checking they name this wallet and this page. It never signs text it was sent.
 */
export async function signIn(
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<StoredSession> {
  const host = window.location.host;
  const challengeResponse = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, host }),
    cache: "no-store",
  });
  const challenge = (await challengeResponse.json()) as Partial<SignInFields> & { tag?: string; error?: string };
  if (!challengeResponse.ok) throw new Error(challenge.error ?? "Sign-in unavailable");
  const fields: SignInFields = {
    domain: host,
    wallet,
    nonce: String(challenge.nonce ?? ""),
    issuedAt: Number(challenge.issuedAt),
    expiresAt: Number(challenge.expiresAt),
  };
  if (challenge.wallet !== wallet || challenge.domain !== host) throw new Error("Sign-in challenge is for another wallet or site");
  const fieldError = signInFieldsError(fields);
  if (fieldError) throw new Error(fieldError);
  const signature = await signMessage(new TextEncoder().encode(signInMessage(fields)));
  const signatureB64 = btoa(String.fromCharCode(...signature));
  const sessionResponse = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...fields, host, tag: challenge.tag, signature: signatureB64 }),
    cache: "no-store",
  });
  return storeSession(sessionResponse);
}

async function storeSession(sessionResponse: Response): Promise<StoredSession> {
  const session = (await sessionResponse.json()) as StoredSession & { error?: string };
  if (!sessionResponse.ok || !session.token) throw new Error(session.error ?? "Sign-in failed");
  const stored = { wallet: session.wallet, token: session.token, expiresAt: session.expiresAt };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* private mode: session lasts for this page only */
  }
  window.dispatchEvent(new Event("agent-session"));
  return stored;
}

export type AptosSignMessage = (input: {
  message: string;
  nonce: string;
  address: boolean;
  application: boolean;
  chainId: boolean;
}) => Promise<{ fullMessage: string; signature: unknown }>;

function signatureHex(signature: unknown): string {
  if (signature instanceof Uint8Array) return Array.from(signature, (b) => b.toString(16).padStart(2, "0")).join("");
  if (typeof signature === "string") return signature.replace(/^0x/, "");
  const withBytes = signature as { toUint8Array?: () => Uint8Array; toString?: () => string } | null;
  if (withBytes?.toUint8Array) return signatureHex(withBytes.toUint8Array());
  if (withBytes?.toString) return withBytes.toString().replace(/^0x/, "");
  throw new Error("The wallet returned an unreadable signature");
}

/**
 * Sign in with a native Aptos wallet (aptosSignIn.ts). As with Solana, this browser builds the text
 * from the server's fields; the wallet adds the address and this page's origin before signing.
 */
export async function signInAptos(address: string, publicKey: string, signMessage: AptosSignMessage): Promise<StoredSession> {
  const host = window.location.host;
  const wallet = canonicalAptosAddress(address);
  if (!wallet) throw new Error("Invalid Aptos address");
  const challengeResponse = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain: "aptos", wallet, host }),
    cache: "no-store",
  });
  const challenge = (await challengeResponse.json()) as Partial<SignInFields> & { tag?: string; error?: string };
  if (!challengeResponse.ok) throw new Error(challenge.error ?? "Sign-in unavailable");
  if (challenge.wallet !== wallet || challenge.domain !== host) throw new Error("Sign-in challenge is for another wallet or site");
  const fields = { domain: host, wallet, nonce: String(challenge.nonce ?? ""), issuedAt: Number(challenge.issuedAt), expiresAt: Number(challenge.expiresAt) };
  const fieldError = signInFieldsError(fields);
  if (fieldError) throw new Error(fieldError);
  const signed = await signMessage({ message: aptosSignInMessage(fields), nonce: fields.nonce, address: true, application: true, chainId: true });
  const sessionResponse = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...fields,
      chain: "aptos",
      host,
      tag: challenge.tag,
      fullMessage: signed.fullMessage,
      signature: signatureHex(signed.signature),
      publicKey: publicKey.replace(/^0x/, ""),
    }),
    cache: "no-store",
  });
  return storeSession(sessionResponse);
}

export type PaymentAsset = { id: string; label: string; chain: string; symbol: string; decimals: number };

export type CreditsState = {
  enabled: boolean;
  signedIn?: boolean;
  wallet?: string;
  freeMonthlyUsd?: number;
  purchasesEnabled?: boolean;
  paymentAssets?: PaymentAsset[];
  balance?: {
    freeLeftUsd: number;
    yieldLeftUsd: number;
    purchasedLeftUsd: number;
    availableUsd: number;
    spentThisMonthUsd: number;
  };
  purchases?: { depositAddress: string; amountUsd: number; status: string; credited: boolean; createdAt: string }[];
  /** Free tries left today without a wallet; null when this visitor gets none. */
  trial?: { requestsLeft: number; requestsPerDay: number } | null;
  /** Open chat is unlocked: USDC in the wallet's Safe or any credited purchase. */
  openChat?: boolean;
  /** Yield AI Boost on Aptos for the signed-in wallet: eligible owners get `monthlyUsd` a month. */
  boost?: { owner: string; eligible: boolean; monthlyUsd: number } | null;
  /** Requests, tokens and dollars, this UTC month and all time (tokens from the proxy's metering). */
  usage?: { month: UsageTotals; total: UsageTotals };
  /** NEAR AI public price of the primary advisor model, $ per 1M tokens. */
  price?: { model: string; inputUsdPerMillion: number; outputUsdPerMillion: number } | null;
  /** What `availableUsd` buys on that model. */
  remaining?: { model: string; outputTokens: number | null; typicalRequests: number; typicalRequestUsd: number };
  error?: string;
};

export type UsageTotals = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  usd: number;
};

export async function fetchCredits(): Promise<CreditsState> {
  const response = await fetch(`${API}/credits`, { headers: sessionHeaders(), cache: "no-store" });
  return (await response.json()) as CreditsState;
}

export type PurchaseQuote = {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountUsd: number;
  asset: PaymentAsset;
  refundTo: string;
  deadline: string | null;
};

export async function requestPurchase(amountUsd: number, originAsset: string, refundTo?: string): Promise<PurchaseQuote> {
  const response = await fetch(`${API}/credits/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionHeaders() },
    body: JSON.stringify({ amountUsd, originAsset, ...(refundTo ? { refundTo } : {}) }),
    cache: "no-store",
  });
  const json = (await response.json()) as PurchaseQuote & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

export async function purchaseStatus(depositAddress: string): Promise<{ status: string; credited: boolean }> {
  const response = await fetch(`${API}/credits/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
    headers: sessionHeaders(),
    cache: "no-store",
  });
  const json = (await response.json()) as { purchase?: { status: string; credited: boolean }; error?: string };
  if (!response.ok || !json.purchase) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json.purchase;
}
