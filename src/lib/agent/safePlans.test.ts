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
import { KAMINO_SHARES_MINT, PlanCheckError, REVIEWED_EXECUTOR, checkPlanTransaction, kaminoSharesAta } from "./safePlans.ts";
import { SAFE_PROGRAM_ID, USDC_MINT, safeAddress, usdcAta } from "./solanaSafe.ts";

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

const depositFixture = JSON.parse(readFileSync(new URL("./fixtures/usdc-deposit-plan.json", import.meta.url), "utf8"));
const walletKaminoFixture = JSON.parse(
  readFileSync(new URL("./fixtures/kamino-deposit-from-wallet-plan.json", import.meta.url), "utf8")
);
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function createAtaIx(payer: PublicKey, ata: PublicKey, wallet: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

test("live wallet → Safe deposit plan passes for its owner and amount", () => {
  checkPlanTransaction(depositFixture.steps[0].transaction, {
    owner: pilotOwner,
    kind: "deposit",
    amountRaw: BigInt(depositFixture.amountRaw),
  });
  assert.throws(
    () => checkPlanTransaction(depositFixture.steps[0].transaction, { owner: pilotOwner, kind: "deposit", amountRaw: BigInt(2_000_000) }),
    PlanCheckError
  );
});

test("live wallet → Kamino plan passes only as kamino_deposit_from_wallet", () => {
  const tx = walletKaminoFixture.steps[0].transaction;
  const amountRaw = BigInt(walletKaminoFixture.amountRaw);
  checkPlanTransaction(tx, { owner: pilotOwner, kind: "kamino_deposit_from_wallet", amountRaw });
  assert.throws(() => checkPlanTransaction(tx, { owner: pilotOwner, kind: "kamino_deposit", amountRaw }), PlanCheckError);
  assert.throws(() => checkPlanTransaction(tx, { owner: pilotOwner, kind: "deposit", amountRaw }), PlanCheckError);
});

test("a deposit may create the Safe's own USDC account, and nothing else", () => {
  const owner = Keypair.generate().publicKey;
  const safe = safeAddress(owner);
  const ok = createTx(owner, [createAtaIx(owner, usdcAta(safe), safe, USDC_MINT), safeIx(owner, depositData(BigInt(1_000_000)))]);
  checkPlanTransaction(ok, { owner, kind: "deposit", amountRaw: BigInt(1_000_000) });

  const stranger = Keypair.generate().publicKey;
  const otherAccount = createTx(owner, [
    createAtaIx(owner, usdcAta(stranger), stranger, USDC_MINT),
    safeIx(owner, depositData(BigInt(1_000_000))),
  ]);
  assert.throws(() => checkPlanTransaction(otherAccount, { owner, kind: "deposit", amountRaw: BigInt(1_000_000) }), PlanCheckError);

  // Outside a plain deposit the ATA program is not expected at all.
  assert.throws(() => checkPlanTransaction(ok, { owner, kind: "create_safe_and_deposit", amountRaw: BigInt(1_000_000) }), PlanCheckError);
});

const withdrawFixture = JSON.parse(readFileSync(new URL("./fixtures/usdc-withdraw-plan.json", import.meta.url), "utf8"));
const WITHDRAW = [183, 18, 70, 156, 148, 109, 161, 34];
const KAMINO_WITHDRAW = [199, 101, 41, 45, 213, 98, 224, 200];

function u64Data(discriminator: number[], amount: bigint, extra: number[] = []): Buffer {
  const out = Buffer.alloc(16 + extra.length);
  Buffer.from(discriminator).copy(out, 0);
  out.writeBigUInt64LE(amount, 8);
  Buffer.from(extra).copy(out, 16);
  return out;
}

test("live Safe → wallet withdrawal passes for its owner and amount only", () => {
  const tx = withdrawFixture.steps[0].transaction;
  checkPlanTransaction(tx, { owner: pilotOwner, kind: "withdraw", amountRaw: BigInt(withdrawFixture.amountRaw) });
  assert.throws(() => checkPlanTransaction(tx, { owner: pilotOwner, kind: "withdraw", amountRaw: BigInt(2_000_000) }), PlanCheckError);
  assert.throws(() => checkPlanTransaction(tx, { owner: pilotOwner, kind: "deposit", amountRaw: BigInt(withdrawFixture.amountRaw) }), PlanCheckError);
});

test("a withdrawal may create only the owner's own USDC account", () => {
  const owner = Keypair.generate().publicKey;
  const ok = createTx(owner, [createAtaIx(owner, usdcAta(owner), owner, USDC_MINT), safeIx(owner, u64Data(WITHDRAW, BigInt(500_000)))]);
  checkPlanTransaction(ok, { owner, kind: "withdraw", amountRaw: BigInt(500_000) });
  const stranger = Keypair.generate().publicKey;
  const elsewhere = createTx(owner, [
    createAtaIx(owner, usdcAta(stranger), stranger, USDC_MINT),
    safeIx(owner, u64Data(WITHDRAW, BigInt(500_000))),
  ]);
  assert.throws(() => checkPlanTransaction(elsewhere, { owner, kind: "withdraw", amountRaw: BigInt(500_000) }), PlanCheckError);
});

test("a Kamino redeem burns the expected shares and may create only the treasury's USDC account", () => {
  const owner = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;
  const shares = BigInt(937_000);
  const redeem = safeIx(owner, u64Data(KAMINO_WITHDRAW, shares, [0]));
  const ok = createTx(owner, [createAtaIx(owner, usdcAta(treasury), treasury, USDC_MINT), redeem]);
  checkPlanTransaction(ok, { owner, kind: "kamino_redeem", amountRaw: shares, treasury });
  assert.throws(() => checkPlanTransaction(ok, { owner, kind: "kamino_redeem", amountRaw: shares + BigInt(1), treasury }), PlanCheckError);
  // Without the on-chain treasury to compare with, no account creation is accepted.
  assert.throws(() => checkPlanTransaction(ok, { owner, kind: "kamino_redeem", amountRaw: shares }), PlanCheckError);
  const other = Keypair.generate().publicKey;
  const wrongTreasury = createTx(owner, [createAtaIx(owner, usdcAta(other), other, USDC_MINT), redeem]);
  assert.throws(() => checkPlanTransaction(wrongTreasury, { owner, kind: "kamino_redeem", amountRaw: shares, treasury }), PlanCheckError);
});

const SET_ALLOCATION = [119, 81, 22, 4, 114, 187, 23, 145];
const KAMINO_DEPOSIT = [237, 8, 188, 187, 115, 99, 49, 85];

test("Kamino share account address matches a live first-deposit plan", () => {
  // Live plan 2026-11-13 for Safe Gq7om9…3g3b created its share account 2ZHJm8…fPUt.
  assert.equal(
    kaminoSharesAta(new PublicKey("Gq7om9Z1DKeXLvV6UqE36tHMMHePZuHFr4oj2Qmd3g3b")).toBase58(),
    "2ZHJm82hQ6z85unymGcpJbt6pK3yKW4Xy23Ez53vfPUt"
  );
});

test("a first Kamino deposit may create the Safe's own share account, and nothing else", () => {
  const owner = Keypair.generate().publicKey;
  const safe = safeAddress(owner);
  const amount = BigInt(1_000_000);
  const body = [
    safeIx(owner, Buffer.from([...SET_ALLOCATION, 0, 0])),
    safeIx(owner, u64Data(KAMINO_DEPOSIT, amount)),
    safeIx(owner, Buffer.from([...SET_ALLOCATION, 0, 0])),
  ];
  const ok = createTx(owner, [createAtaIx(owner, kaminoSharesAta(safe), safe, KAMINO_SHARES_MINT), ...body]);
  checkPlanTransaction(ok, { owner, kind: "kamino_deposit", amountRaw: amount });

  const stranger = Keypair.generate().publicKey;
  const strangers = createTx(owner, [createAtaIx(owner, kaminoSharesAta(stranger), stranger, KAMINO_SHARES_MINT), ...body]);
  assert.throws(() => checkPlanTransaction(strangers, { owner, kind: "kamino_deposit", amountRaw: amount }), PlanCheckError);

  const usdcInstead = createTx(owner, [createAtaIx(owner, usdcAta(safe), safe, USDC_MINT), ...body]);
  assert.throws(() => checkPlanTransaction(usdcInstead, { owner, kind: "kamino_deposit", amountRaw: amount }), PlanCheckError);

  // A plain wallet → Safe deposit still may not create the share account.
  const wrongKind = createTx(owner, [
    createAtaIx(owner, kaminoSharesAta(safe), safe, KAMINO_SHARES_MINT),
    safeIx(owner, depositData(amount)),
  ]);
  assert.throws(() => checkPlanTransaction(wrongKind, { owner, kind: "deposit", amountRaw: amount }), PlanCheckError);
});
