/**
 * Owner-signed Solana Safe actions built by the Solana Safe API (yield-ai-os-sol `web`,
 * `/api/mobile/v1/*`, reached through `/agent/api/solana-safe/*`):
 * - create the Safe, optionally with a first USDC deposit in the same transaction;
 * - deposit USDC from the wallet, into the Safe or straight into Kamino;
 * - put idle Safe USDC into the Kamino USDC vault;
 * - exit Kamino (redeem, then return the USDC to the wallet) and withdraw idle USDC.
 *
 * The API returns an unsigned v0 transaction. Before the wallet sees it, `checkPlanTransaction`
 * requires: the owner is the only signer and the fee payer; every instruction belongs to the
 * Compute Budget or the Safe program; the Safe instructions are exactly the expected ones; the
 * amount is the one the user typed; a new Safe gets the reviewed executor. No executor key is
 * involved: the owner signs, and the program takes its performance fee on any Kamino exit.
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { SAFE_PROGRAM_ID, USDC_MINT, safeAddress, usdcAta } from "./solanaSafe.ts";

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const API = "/agent/api/solana-safe";

/** The executor new Safes are created with; matches yield-ai-os-sol `mobileSafeWallet.ts`. */
export const REVIEWED_EXECUTOR = new PublicKey("3ayNPp7MoihfbnTQ4q6Ge5PVNe9tJsY5betKqKX7C8aH");

// Anchor discriminators: sha256("global:<name>")[0..8].
const DISCRIMINATORS = {
  initialize_with_limits: [191, 153, 207, 116, 199, 76, 81, 40],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  set_allocation: [119, 81, 22, 4, 114, 187, 23, 145],
  kamino_deposit: [237, 8, 188, 187, 115, 99, 49, 85],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  kamino_withdraw: [199, 101, 41, 45, 213, 98, 224, 200],
} as const;
type SafeInstruction = keyof typeof DISCRIMINATORS;

export type PlanKind =
  | "create_safe"
  | "create_safe_and_deposit"
  | "deposit"
  | "kamino_deposit"
  | "kamino_deposit_from_wallet"
  | "withdraw"
  | "kamino_redeem";

/** Safe instructions each plan may contain, in order. */
const EXPECTED: Record<PlanKind, SafeInstruction[]> = {
  create_safe: ["initialize_with_limits"],
  create_safe_and_deposit: ["initialize_with_limits", "deposit"],
  // USDC from the owner's wallet into the Safe's USDC account.
  deposit: ["deposit"],
  // Temporary 100% Kamino allocation around the deposit, then the previous allocation back.
  kamino_deposit: ["set_allocation", "kamino_deposit", "set_allocation"],
  // Same, with the wallet → Safe deposit in the same transaction.
  kamino_deposit_from_wallet: ["set_allocation", "deposit", "kamino_deposit", "set_allocation"],
  // Idle Safe USDC back to the owner's own USDC account (also the "return" step after a Kamino exit).
  withdraw: ["withdraw"],
  // Redeem Kamino shares into the Safe's USDC; the program sends its performance fee to the treasury.
  kamino_redeem: ["kamino_withdraw"],
};

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** Share mint of the Kamino USDC kVault `91b1op…` (SPL Token), read from a live plan 2026-11-13. */
export const KAMINO_SHARES_MINT = new PublicKey("B9t9wg8r39Lxm2D9Gmqn2rJ5pVQQwjtGBfSsHAXSEnVe");

/** The Safe's Kamino share account. */
export function kaminoSharesAta(safe: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [safe.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), KAMINO_SHARES_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/** A token account a plan may create: its address, its holder, and the mint when it must be checked directly. */
type AllowedAccount = { ata: PublicKey; holder: PublicKey; mint: PublicKey | null };

/**
 * The only non-Safe instruction a plan may carry: idempotently creating one expected token
 * account, paid by the owner — the Safe's USDC account before a deposit, the owner's before a
 * withdrawal, the fee treasury's before a Kamino exit, and the Safe's Kamino share account before
 * its first Kamino deposit. Anything else from the ATA program is refused.
 */
function checkAccountCreation(
  ix: { accountKeyIndexes: number[]; data: Uint8Array },
  keys: PublicKey[],
  owner: PublicKey,
  allowed: AllowedAccount[]
): void {
  const at = (i: number) => keys[ix.accountKeyIndexes[i]] ?? null;
  const isCreateIdempotent = ix.data.length === 1 && ix.data[0] === 1;
  const payer = at(0);
  const ata = at(1);
  const holder = at(2);
  const match = allowed.find((a) => ata?.equals(a.ata) && holder?.equals(a.holder));
  // The share mint sits in the plan's lookup table; the ATA address is derived from holder, token
  // program and mint, so a matching address already pins the mint. USDC accounts are checked as before.
  const mintOk = match && (match.mint === null || Boolean(at(3)?.equals(match.mint)));
  if (!isCreateIdempotent || !payer?.equals(owner) || !match || !mintOk) {
    throw new PlanCheckError("The plan creates a token account other than the expected one.");
  }
}

/** Which token accounts a plan of this kind may create. */
function allowedAccounts(kind: PlanKind, owner: PublicKey, treasury?: PublicKey): AllowedAccount[] {
  const safe = safeAddress(owner);
  const usdc = (holder: PublicKey): AllowedAccount => ({ ata: usdcAta(holder), holder, mint: USDC_MINT });
  if (kind === "deposit") return [usdc(safe)];
  if (kind === "withdraw") return [usdc(owner)];
  if (kind === "kamino_redeem") return treasury ? [usdc(treasury)] : [];
  if (kind === "kamino_deposit" || kind === "kamino_deposit_from_wallet") {
    return [{ ata: kaminoSharesAta(safe), holder: safe, mint: null }];
  }
  return [];
}

export type PlanStep = {
  id: string;
  kind: string;
  transaction: string;
  transactionVersion: number;
  requiredSigners: string[];
};

export type SafePlan = {
  status: "ready" | "already_exists" | "empty" | "redeemed";
  amountRaw?: string;
  initialDepositRaw?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  steps: PlanStep[];
  cost?: { totalLamports: string; walletSolLamports: string };
  /** Kamino redeem: shares in this transaction, and what is left of the selection afterwards. */
  legSharesRaw?: string;
  remainingTargetSharesRaw?: string;
  performanceFeeBps?: number;
  /** Kamino return: USDC the redemption added to the Safe, after the performance fee. */
  netUsdc?: string;
};

export class PlanCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanCheckError";
  }
}

function instructionName(data: Uint8Array): SafeInstruction | null {
  for (const [name, bytes] of Object.entries(DISCRIMINATORS) as [SafeInstruction, readonly number[]][]) {
    if (bytes.every((byte, i) => data[i] === byte)) return name;
  }
  return null;
}

function readU64(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data).readBigUInt64LE(offset);
}

/**
 * Deserialize and check a plan transaction against what the user asked for.
 * `amountRaw` is the USDC amount in base units for deposits; omit it for `create_safe`.
 */
export function checkPlanTransaction(
  base64: string,
  expected: { owner: PublicKey; kind: PlanKind; amountRaw?: bigint; treasury?: PublicKey }
): VersionedTransaction {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const message = tx.message;
  const keys = message.staticAccountKeys;
  if (message.header.numRequiredSignatures !== 1 || !keys[0]?.equals(expected.owner)) {
    throw new PlanCheckError("The plan must be signed and paid by your wallet only.");
  }

  const safeCalls: { name: SafeInstruction; data: Uint8Array }[] = [];
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program) throw new PlanCheckError("Instruction program is not a static account.");
    if (program.equals(ComputeBudgetProgram.programId)) continue;
    if (program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const allowed = allowedAccounts(expected.kind, expected.owner, expected.treasury);
      if (allowed.length === 0) throw new PlanCheckError("This plan must not create token accounts.");
      checkAccountCreation(ix, keys, expected.owner, allowed);
      continue;
    }
    if (!program.equals(SAFE_PROGRAM_ID)) {
      throw new PlanCheckError(`Unexpected program in the plan: ${program.toBase58()}`);
    }
    const name = instructionName(ix.data);
    if (!name) throw new PlanCheckError("Unknown Safe instruction in the plan.");
    safeCalls.push({ name, data: ix.data });
  }

  const wanted = EXPECTED[expected.kind];
  if (safeCalls.length !== wanted.length || safeCalls.some((call, i) => call.name !== wanted[i])) {
    throw new PlanCheckError(
      `Plan does not match ${expected.kind}: got ${safeCalls.map((c) => c.name).join(", ") || "nothing"}.`
    );
  }

  for (const call of safeCalls) {
    if (call.name === "initialize_with_limits") {
      // args: agent pubkey, allocation_bps [u16; 8], allowed_programs Vec<Pubkey>
      const agent = new PublicKey(call.data.subarray(8, 40));
      if (!agent.equals(REVIEWED_EXECUTOR)) throw new PlanCheckError("New Safe would get an unexpected agent.");
      const allowedCount = Buffer.from(call.data).readUInt32LE(56);
      if (allowedCount !== 0) throw new PlanCheckError("New Safe must start with an empty program allowlist.");
    }
    if (
      call.name === "deposit" ||
      call.name === "kamino_deposit" ||
      call.name === "withdraw" ||
      call.name === "kamino_withdraw"
    ) {
      // u64 amount (USDC base units; Kamino shares for kamino_withdraw) right after the discriminator.
      if (expected.amountRaw === undefined || readU64(call.data, 8) !== expected.amountRaw) {
        throw new PlanCheckError("Plan amount differs from the amount you entered.");
      }
    }
  }
  return tx;
}

async function postPlan(path: string, body: unknown): Promise<SafePlan> {
  let response: Response;
  try {
    response = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new SafeApiError("The Safe API did not answer in 45 s. Try again.", "TIMEOUT");
    }
    throw error;
  }
  const json = (await response.json().catch(() => null)) as
    | (SafePlan & { error?: { message?: string } | string })
    | null;
  if (!response.ok || !json) {
    const message =
      typeof json?.error === "string" ? json.error : json?.error?.message ?? `Safe API HTTP ${response.status}`;
    const code = typeof json?.error === "object" ? (json.error as { code?: string }).code : undefined;
    throw new SafeApiError(message, code);
  }
  return json;
}

/** Error from the Solana Safe API; `code` e.g. SAFE_NOT_CREATED, INSUFFICIENT_USDC, INSUFFICIENT_SOL. */
export class SafeApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "SafeApiError";
    this.code = code;
  }
}

const owner = (address: PublicKey) => ({ type: "solana", address: address.toBase58() });

/** Demo ceiling for money coming in from the wallet while the program has one admin key (until Squads). */
export const DEMO_MAX_DEPOSIT_USDC = 101;

function assertDemoCap(amountUsdc: string | undefined) {
  if (amountUsdc !== undefined && Number(amountUsdc) > DEMO_MAX_DEPOSIT_USDC) {
    throw new Error(`Demo limit: up to ${DEMO_MAX_DEPOSIT_USDC} USDC per deposit.`);
  }
}

export async function requestCreationPlan(address: PublicKey, initialDepositUsdc?: string): Promise<SafePlan> {
  assertDemoCap(initialDepositUsdc);
  return postPlan("safes/creation-plan", {
    owner: owner(address),
    cluster: "mainnet",
    ...(initialDepositUsdc ? { initialDepositUsdc } : {}),
  });
}

/** USDC from the owner's wallet straight into the Safe. */
export async function requestDepositPlan(address: PublicKey, amountUsdc: string): Promise<SafePlan> {
  assertDemoCap(amountUsdc);
  return postPlan("deposits/plan", { owner: owner(address), cluster: "mainnet", amount: amountUsdc });
}

/** Into the Kamino USDC vault from the Safe's idle USDC, or straight from the wallet in one transaction. */
export async function requestKaminoDepositPlan(
  address: PublicKey,
  amountUsdc: string,
  source: "safe" | "wallet" = "safe"
): Promise<SafePlan> {
  if (source === "wallet") assertDemoCap(amountUsdc);
  return postPlan("protocols/kamino/deposits/plan", {
    owner: owner(address),
    cluster: "mainnet",
    amount: amountUsdc,
    source,
  });
}

/** Idle Safe USDC to the owner's wallet; "all" takes everything idle. */
export function requestWithdrawPlan(address: PublicKey, amountUsdc: string | "all"): Promise<SafePlan> {
  return postPlan("withdrawals/plan", { owner: owner(address), cluster: "mainnet", amount: amountUsdc });
}

/** Step 1 of a Kamino exit: redeem a percent ("25", "100.00") of the Safe's shares into Safe USDC. */
export function requestKaminoRedeemPlan(address: PublicKey, percent: string): Promise<SafePlan> {
  return postPlan("protocols/kamino/withdrawals/plan", {
    owner: owner(address),
    cluster: "mainnet",
    phase: "redeem",
    percent,
  });
}

/** Step 2: send exactly what that redemption added to the Safe on to the wallet. */
export function requestKaminoReturnPlan(address: PublicKey, redemptionSignature: string): Promise<SafePlan> {
  return postPlan("protocols/kamino/withdrawals/plan", {
    owner: owner(address),
    cluster: "mainnet",
    phase: "return",
    redemptionSignature,
  });
}

/** The fee treasury from the Safe program's config account (bytes 40..72 after the admin key). */
export async function readSafeTreasury(connection: Connection): Promise<PublicKey> {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], SAFE_PROGRAM_ID);
  const info = await connection.getAccountInfo(config, "confirmed");
  if (!info || !info.owner.equals(SAFE_PROGRAM_ID) || info.data.length < 75) throw new Error("Safe config is unavailable");
  return new PublicKey(info.data.subarray(40, 72));
}

/** Check the plan, have the wallet sign and send it, and wait for confirmation. */
export async function signAndSendPlan(options: {
  plan: SafePlan;
  owner: PublicKey;
  kind: PlanKind;
  amountRaw?: bigint;
  treasury?: PublicKey;
  connection: Connection;
  sendTransaction: (tx: VersionedTransaction, connection: Connection) => Promise<string>;
  /** "wallet" right before the wallet is asked to sign, "confirming" once it sent the transaction. */
  onStage?: (stage: "wallet" | "confirming") => void;
}): Promise<string> {
  const { plan, owner: wallet, kind, amountRaw, treasury, connection, sendTransaction, onStage } = options;
  if (plan.status !== "ready" || plan.steps.length !== 1) {
    throw new Error(plan.status === "already_exists" ? "Your Safe already exists." : "The Safe API returned no transaction.");
  }
  const tx = checkPlanTransaction(plan.steps[0].transaction, { owner: wallet, kind, amountRaw, treasury });
  onStage?.("wallet");
  const signature = await sendTransaction(tx, connection);
  onStage?.("confirming");
  if (plan.blockhash && plan.lastValidBlockHeight) {
    const result = await connection.confirmTransaction(
      { signature, blockhash: plan.blockhash, lastValidBlockHeight: plan.lastValidBlockHeight },
      "confirmed"
    );
    if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}
