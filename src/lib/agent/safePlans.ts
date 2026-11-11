/**
 * Owner-signed Solana Safe actions built by the Solana Safe API (yield-ai-os-sol `web`,
 * `/api/mobile/v1/*`, reached through `/agent/api/solana-safe/*`):
 * - create the Safe, optionally with a first USDC deposit in the same transaction;
 * - put idle Safe USDC into the Kamino USDC vault.
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
import { SAFE_PROGRAM_ID } from "./solanaSafe.ts";

const API = "/agent/api/solana-safe";

/** The executor new Safes are created with; matches yield-ai-os-sol `mobileSafeWallet.ts`. */
export const REVIEWED_EXECUTOR = new PublicKey("3ayNPp7MoihfbnTQ4q6Ge5PVNe9tJsY5betKqKX7C8aH");

// Anchor discriminators: sha256("global:<name>")[0..8].
const DISCRIMINATORS = {
  initialize_with_limits: [191, 153, 207, 116, 199, 76, 81, 40],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  set_allocation: [119, 81, 22, 4, 114, 187, 23, 145],
  kamino_deposit: [237, 8, 188, 187, 115, 99, 49, 85],
} as const;
type SafeInstruction = keyof typeof DISCRIMINATORS;

export type PlanKind = "create_safe" | "create_safe_and_deposit" | "kamino_deposit";

/** Safe instructions each plan may contain, in order. */
const EXPECTED: Record<PlanKind, SafeInstruction[]> = {
  create_safe: ["initialize_with_limits"],
  create_safe_and_deposit: ["initialize_with_limits", "deposit"],
  // Temporary 100% Kamino allocation around the deposit, then the previous allocation back.
  kamino_deposit: ["set_allocation", "kamino_deposit", "set_allocation"],
};

export type PlanStep = {
  id: string;
  kind: string;
  transaction: string;
  transactionVersion: number;
  requiredSigners: string[];
};

export type SafePlan = {
  status: "ready" | "already_exists";
  amountRaw?: string;
  initialDepositRaw?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  steps: PlanStep[];
  cost?: { totalLamports: string; walletSolLamports: string };
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
  expected: { owner: PublicKey; kind: PlanKind; amountRaw?: bigint }
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
    if (call.name === "deposit" || call.name === "kamino_deposit") {
      if (expected.amountRaw === undefined || readU64(call.data, 8) !== expected.amountRaw) {
        throw new PlanCheckError("Plan amount differs from the amount you entered.");
      }
    }
  }
  return tx;
}

async function postPlan(path: string, body: unknown): Promise<SafePlan> {
  const response = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (SafePlan & { error?: { message?: string } | string })
    | null;
  if (!response.ok || !json) {
    const message =
      typeof json?.error === "string" ? json.error : json?.error?.message ?? `Safe API HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

const owner = (address: PublicKey) => ({ type: "solana", address: address.toBase58() });

export function requestCreationPlan(address: PublicKey, initialDepositUsdc?: string): Promise<SafePlan> {
  return postPlan("safes/creation-plan", {
    owner: owner(address),
    cluster: "mainnet",
    ...(initialDepositUsdc ? { initialDepositUsdc } : {}),
  });
}

export function requestKaminoDepositPlan(address: PublicKey, amountUsdc: string): Promise<SafePlan> {
  return postPlan("protocols/kamino/deposits/plan", {
    owner: owner(address),
    cluster: "mainnet",
    amount: amountUsdc,
    source: "safe",
  });
}

/** Check the plan, have the wallet sign and send it, and wait for confirmation. */
export async function signAndSendPlan(options: {
  plan: SafePlan;
  owner: PublicKey;
  kind: PlanKind;
  amountRaw?: bigint;
  connection: Connection;
  sendTransaction: (tx: VersionedTransaction, connection: Connection) => Promise<string>;
}): Promise<string> {
  const { plan, owner: wallet, kind, amountRaw, connection, sendTransaction } = options;
  if (plan.status !== "ready" || plan.steps.length !== 1) {
    throw new Error(plan.status === "already_exists" ? "Your Safe already exists." : "The Safe API returned no transaction.");
  }
  const tx = checkPlanTransaction(plan.steps[0].transaction, { owner: wallet, kind, amountRaw });
  const signature = await sendTransaction(tx, connection);
  if (plan.blockhash && plan.lastValidBlockHeight) {
    const result = await connection.confirmTransaction(
      { signature, blockhash: plan.blockhash, lastValidBlockHeight: plan.lastValidBlockHeight },
      "confirmed"
    );
    if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}
