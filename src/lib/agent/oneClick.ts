/**
 * NEAR Intents 1-Click API, called straight from the browser.
 * Checked 2026-11-04: the API answers CORS with `Access-Control-Allow-Origin: *`,
 * no JWT is needed (a 0.2% fee applies without one), and there is no testnet.
 * Spec: https://1click.chaindefuser.com/docs/v0/openapi.yaml
 */

export const ONE_CLICK_BASE = "https://1click.chaindefuser.com/v0";

/** 1-Click asset ids from GET /v0/tokens (checked 2026-11-04). */
export const ASSET_SOLANA_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const ASSET_APTOS_USDC = "nep141:aptos-34ee497f210c5a511e8d5b53bc56d75b63612bb5.omft.near";

export type OneClickQuote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
};

export type OneClickQuoteResponse = {
  correlationId: string;
  timestamp: string;
  signature: string;
  quote: OneClickQuote;
};

export type TxRef = { hash: string; explorerUrl?: string };

export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export type OneClickStatusResponse = {
  status: OneClickStatus | string;
  updatedAt: string;
  swapDetails?: {
    amountOutFormatted?: string;
    originChainTxHashes?: TxRef[];
    destinationChainTxHashes?: TxRef[];
    refundedAmountFormatted?: string;
    refundReason?: string;
    depositedAmountFormatted?: string;
  };
};

export const FINAL_STATUSES = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ONE_CLICK_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : typeof body === "string" && body
          ? body
          : `HTTP ${response.status}`;
    throw new Error(`1-Click: ${message}`);
  }
  return body as T;
}

export type QuoteParams = {
  /** Raw origin amount (USDC on Solana has 6 decimals). */
  amountRaw: string;
  destinationAsset: string;
  /** Owner address on the destination chain. For a Solana Safe, the Safe PDA, never its ATA. */
  recipient: string;
  /** Solana address that receives a refund if the swap does not complete. */
  refundTo: string;
  slippageBps: number;
  /** false returns a one-time deposit address; true only prices the route. */
  dry: boolean;
};

export function requestQuote(params: QuoteParams): Promise<OneClickQuoteResponse> {
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return call<OneClickQuoteResponse>("/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: params.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: params.slippageBps,
      originAsset: ASSET_SOLANA_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: params.destinationAsset,
      amount: params.amountRaw,
      refundTo: params.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: params.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline,
    }),
  });
}

/** Optional: tells 1-Click about the deposit transaction so it does not wait for its own scan. */
export function submitDepositTx(txHash: string, depositAddress: string): Promise<unknown> {
  return call("/deposit/submit", { method: "POST", body: JSON.stringify({ txHash, depositAddress }) });
}

export function fetchStatus(depositAddress: string): Promise<OneClickStatusResponse> {
  return call<OneClickStatusResponse>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`);
}
