// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PlanCheckError, REVIEWED_EXECUTOR, checkPlanTransaction } from "./safePlans.ts";
import { SAFE_PROGRAM_ID } from "./solanaSafe.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/kamino-deposit-plan.json", import.meta.url), "utf8"));
const pilotOwner = new PublicKey(fixture.state.owner.address);
const kaminoTx: string = fixture.steps[0].transaction;

const INIT = [191, 153, 207, 116, 199, 76, 81, 40];
const DEPOSIT = [242, 35, 198, 137, 82, 225, 242, 182];

function initData(agent: PublicKey, allowed: PublicKey[] = []): Buffer {
  const out = Buffer.alloc(8 + 32 + 16 + 4 + 32 * allowed.length);
  Buffer.from(INIT).copy(out, 0);
  agent.toBuffer().copy(out, 8);
  out.writeUInt32LE(allowed.length, 56);
  allowed.forEach((key, i) => key.toBuffer().copy(out, 60 + 32 * i));
  return out;
}

function depositData(amount: bigint): Buffer {
  const out = Buffer.alloc(16);
  Buffer.from(DEPOSIT).copy(out, 0);
  out.writeBigUInt64LE(amount, 8);
  return out;
}

function createTx(owner: PublicKey, instructions: TransactionInstruction[]): string {
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...instructions],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

const safeIx = (owner: PublicKey, data: Buffer) =>
  new TransactionInstruction({ programId: SAFE_PROGRAM_ID, data, keys: [{ pubkey: owner, isSigner: true, isWritable: true }] });

test("live Kamino plan passes for its owner and amount", () => {
  const tx = checkPlanTransaction(kaminoTx, { owner: pilotOwner, kind: "kamino_deposit", amountRaw: BigInt(fixture.amountRaw) });
  assert.equal(tx.version, 0);
});

test("Kamino plan is refused for another amount, owner or kind", () => {
  assert.throws(
    () => checkPlanTransaction(kaminoTx, { owner: pilotOwner, kind: "kamino_deposit", amountRaw: BigInt(5_000_000) }),
    PlanCheckError
  );
  assert.throws(
    () => checkPlanTransaction(kaminoTx, { owner: Keypair.generate().publicKey, kind: "kamino_deposit", amountRaw: BigInt(1_000_000) }),
    PlanCheckError
  );
  assert.throws(
    () => checkPlanTransaction(kaminoTx, { owner: pilotOwner, kind: "create_safe_and_deposit", amountRaw: BigInt(1_000_000) }),
    PlanCheckError
  );
});

test("create + deposit passes with the reviewed executor and the typed amount", () => {
  const owner = Keypair.generate().publicKey;
  const tx = createTx(owner, [safeIx(owner, initData(REVIEWED_EXECUTOR)), safeIx(owner, depositData(BigInt(2_500_000)))]);
  checkPlanTransaction(tx, { owner, kind: "create_safe_and_deposit", amountRaw: BigInt(2_500_000) });
  const createOnly = createTx(owner, [safeIx(owner, initData(REVIEWED_EXECUTOR))]);
  checkPlanTransaction(createOnly, { owner, kind: "create_safe" });
});

test("create is refused with another agent, an allowlist, or an extra program", () => {
  const owner = Keypair.generate().publicKey;
  const otherAgent = createTx(owner, [safeIx(owner, initData(Keypair.generate().publicKey))]);
  assert.throws(() => checkPlanTransaction(otherAgent, { owner, kind: "create_safe" }), PlanCheckError);
  const withAllowlist = createTx(owner, [safeIx(owner, initData(REVIEWED_EXECUTOR, [Keypair.generate().publicKey]))]);
  assert.throws(() => checkPlanTransaction(withAllowlist, { owner, kind: "create_safe" }), PlanCheckError);
  const drain = createTx(owner, [
    safeIx(owner, initData(REVIEWED_EXECUTOR)),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1_000_000 }),
  ]);
  assert.throws(() => checkPlanTransaction(drain, { owner, kind: "create_safe" }), PlanCheckError);
});
