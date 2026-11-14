/**
 * Who may ask the proxy for a picture, and what a picture costs them.
 * Used by `src/app/api/near/[...path]/route.ts` for `POST v1/images/generations`.
 * The ledger and session are passed in, so the rules are unit-tested without a database
 * (imageBilling.test.ts).
 */
import { IMAGE_MODEL, IMAGE_PRICE_USD } from "./models.ts";

export type ImageGateDeps = {
  /** The wallet a session token belongs to, or null when the token is missing, forged or expired. */
  walletFromSession: (token: string | null) => string | null;
  walletBalance: (wallet: string) => Promise<{ availableUsd: number }>;
  openChatUnlocked: (wallet: string) => Promise<boolean>;
};

export type ImageGateResult = { ok: true; wallet: string } | { ok: false; status: number; error: string };

/** The sentences the chat shows as they are, so they are written for people. */
export const IMAGE_SIGN_IN_REQUIRED = "Connect a Solana wallet and sign once to create pictures.";
export const IMAGE_OUT_OF_CREDITS = `A picture costs $${IMAGE_PRICE_USD}. Top up AI credits to continue.`;
export const IMAGE_LOCKED = "Pictures unlock after a Safe deposit or a credits top-up.";
export const LEDGER_UNAVAILABLE = "Credit ledger unavailable";

/**
 * A picture is for a signed-in wallet that can pay for it and has unlocked Open chat.
 * Never on the no-wallet trial. If the ledger or the Safe cannot be read, the answer is no.
 */
export async function gateImageRequest(sessionToken: string | null, deps: ImageGateDeps): Promise<ImageGateResult> {
  const wallet = deps.walletFromSession(sessionToken);
  if (!wallet) return { ok: false, status: 401, error: IMAGE_SIGN_IN_REQUIRED };
  let availableUsd: number;
  try {
    availableUsd = (await deps.walletBalance(wallet)).availableUsd;
  } catch {
    return { ok: false, status: 503, error: LEDGER_UNAVAILABLE };
  }
  if (availableUsd < IMAGE_PRICE_USD) return { ok: false, status: 402, error: IMAGE_OUT_OF_CREDITS };
  const unlocked = await deps.openChatUnlocked(wallet).catch(() => false);
  if (!unlocked) return { ok: false, status: 403, error: IMAGE_LOCKED };
  return { ok: true, wallet };
}

export type ImageBillingDeps = {
  recordUsage: (wallet: string, id: string, estimateUsd: number, model: string | null) => Promise<unknown>;
  setUsageCost: (id: string, costUsd: number) => Promise<unknown>;
};

/**
 * Charge one picture at list price, once, and only when the model answered.
 * NEAR AI returns no billing id for pictures (only x-request-id, which /v1/billing/costs does not
 * price), so the list price is recorded as the final cost under `img:<x-request-id>`.
 * Returns the ledger id, or null when nothing was recorded.
 */
export async function billImage(
  input: { wallet: string | null; requestId: string | null; upstreamOk: boolean },
  deps: ImageBillingDeps
): Promise<string | null> {
  const { wallet, requestId, upstreamOk } = input;
  if (!wallet || !requestId || !upstreamOk) return null;
  const id = `img:${requestId}`;
  try {
    await deps.recordUsage(wallet, id, IMAGE_PRICE_USD, IMAGE_MODEL);
  } catch {
    return null;
  }
  await deps.setUsageCost(id, IMAGE_PRICE_USD).catch(() => undefined);
  return id;
}
