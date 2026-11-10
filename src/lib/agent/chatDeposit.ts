/**
 * 1-Click Solana → Solana Safe deposit used by the chat action card.
 * Same mainnet test limits as IntentsDepositPanel (1–5 USDC).
 */

import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import {
  ASSET_SOLANA_USDC,
  FINAL_STATUSES,
  fetchStatus,
  requestQuote,
  submitDepositTx,
  type OneClickStatusResponse,
} from "@/lib/agent/oneClick";
import {
  buildUsdcDepositTx,
  formatUsdc,
  panelConnections,
  parseUsdc,
  readSolanaSafe,
  withFallback,
} from "@/lib/agent/solanaSafe";

export const CHAT_DEPOSIT_MIN_RAW = BigInt(1_000_000);
export const CHAT_DEPOSIT_MAX_RAW = BigInt(5_000_000);
const SLIPPAGE_BPS = 100;
const STORAGE_KEY = "agent.intents.lastDeposit.v1";

export type ChatDepositTracked = {
  solanaOwner: string;
  destination: "solana-safe";
  recipient: string;
  depositAddress: string;
  txSig: string;
  amountRaw: string;
  recipientBeforeRaw: string;
  startedAt: number;
};

export type ChatDepositPhase = "idle" | "preparing" | "quoting" | "signing" | "tracking" | "done" | "error";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function formatChatDepositAmount(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Keep up to 6 decimals; strip trailing zeros for the input.
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed || "0";
}

export function loadChatDepositTracked(): ChatDepositTracked | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatDepositTracked;
    if (!parsed || parsed.destination !== "solana-safe") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveChatDepositTracked(value: ChatDepositTracked | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export type ExecuteChatDepositArgs = {
  owner: string;
  amountInput: string;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  onPhase?: (phase: Exclude<ChatDepositPhase, "idle" | "done" | "error">) => void;
};

export type ExecuteChatDepositResult = {
  tracked: ChatDepositTracked;
  amountOutFormatted?: string;
};

/** Quote + sign USDC transfer into the Solana Safe via NEAR Intents 1-Click. */
export async function executeChatDeposit(args: ExecuteChatDepositArgs): Promise<ExecuteChatDepositResult> {
  const { owner, amountInput, sendTransaction, onPhase } = args;
  const amountRaw = parseUsdc(amountInput);
  if (amountRaw === null) throw new Error("Enter a USDC amount, up to 6 decimals.");
  if (amountRaw < CHAT_DEPOSIT_MIN_RAW || amountRaw > CHAT_DEPOSIT_MAX_RAW) {
    throw new Error("Test amounts only: 1 to 5 USDC.");
  }

  onPhase?.("preparing");
  const connections = panelConnections(window.location.host, window.location.origin);
  if (connections.length === 0) throw new Error("No Solana RPC endpoint configured.");

  const ownerKey = new PublicKey(owner);
  const safe = (await withFallback(connections, (c) => readSolanaSafe(c, ownerKey))).value;
  if (safe.walletUsdcRaw < amountRaw) {
    throw new Error(`This wallet holds ${formatUsdc(safe.walletUsdcRaw)} USDC on Solana.`);
  }
  if (!safe.safeExists) {
    throw new Error("This wallet has no Solana Safe yet. Create it in the Yield AI Solana app first.");
  }
  if (!safe.safeUsdcAtaExists) {
    throw new Error("The Safe has no USDC account yet. Re-open it in the Safe app so it is created.");
  }

  const recipient = safe.safe.toBase58();
  onPhase?.("quoting");
  const quoteResponse = await requestQuote({
    amountRaw: amountRaw.toString(),
    destinationAsset: ASSET_SOLANA_USDC,
    recipient,
    refundTo: owner,
    slippageBps: SLIPPAGE_BPS,
    dry: false,
  });

  const depositAddress = quoteResponse.quote.depositAddress;
  const echoed = (quoteResponse as unknown as { quoteRequest?: Record<string, unknown> }).quoteRequest ?? {};
  if (
    !depositAddress ||
    echoed.recipient !== recipient ||
    echoed.refundTo !== owner ||
    echoed.destinationAsset !== ASSET_SOLANA_USDC ||
    echoed.originAsset !== ASSET_SOLANA_USDC ||
    String(echoed.amount) !== amountRaw.toString()
  ) {
    throw new Error("The quote does not match what was requested. Try again.");
  }
  if (quoteResponse.quote.deadline && Date.parse(quoteResponse.quote.deadline) < Date.now() + 5 * 60 * 1000) {
    throw new Error("The quote expires within 5 minutes. Try again.");
  }

  let depositKey: PublicKey;
  try {
    depositKey = new PublicKey(depositAddress);
  } catch {
    throw new Error("1-Click returned an invalid Solana deposit address.");
  }

  onPhase?.("signing");
  const before = safe.safeUsdcRaw;
  const { value: tx, connection } = await withFallback(connections, (c) =>
    buildUsdcDepositTx(c, ownerKey, depositKey, amountRaw)
  );
  const txSig = await sendTransaction(tx, connection);

  const tracked: ChatDepositTracked = {
    solanaOwner: owner,
    destination: "solana-safe",
    recipient,
    depositAddress,
    txSig,
    amountRaw: amountRaw.toString(),
    recipientBeforeRaw: before.toString(),
    startedAt: Date.now(),
  };
  saveChatDepositTracked(tracked);
  submitDepositTx(txSig, depositAddress).catch(() => undefined);

  return {
    tracked,
    amountOutFormatted: quoteResponse.quote.amountOutFormatted,
  };
}

export async function pollChatDepositStatus(
  depositAddress: string
): Promise<{ done: boolean; status: OneClickStatusResponse }> {
  const status = await fetchStatus(depositAddress);
  return { done: FINAL_STATUSES.has(String(status.status)), status };
}

export function chatDepositStatusLabel(status: OneClickStatusResponse | null, phase: ChatDepositPhase): string {
  if (phase === "preparing") return "Checking Safe & balance…";
  if (phase === "quoting") return "Getting 1-Click quote…";
  if (phase === "signing") return "Confirm the transfer in your wallet…";
  if (phase === "tracking") {
    const code = status?.status ? String(status.status) : "PENDING_DEPOSIT";
    if (code === "SUCCESS") return "Deposit landed in your Solana Safe.";
    if (code === "REFUNDED") return "Deposit refunded to your wallet.";
    if (code === "FAILED") return "Deposit failed.";
    if (code === "PROCESSING") return "1-Click is processing…";
    return "Waiting for 1-Click to see the deposit…";
  }
  if (phase === "done") {
    const code = status?.status ? String(status.status) : "SUCCESS";
    if (code === "REFUNDED") return "Deposit refunded to your wallet.";
    if (code === "FAILED") return "Deposit failed.";
    return "Deposit landed in your Solana Safe.";
  }
  return "";
}

export { errorText as chatDepositErrorText, formatUsdc as formatChatDepositUsdc };
