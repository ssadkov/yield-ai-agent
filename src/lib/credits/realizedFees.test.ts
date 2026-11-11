// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { USDC_MINT, treasuryUsdcGain } from "./realizedFees.ts";

const TREASURY = "8xwjNX3hWwG9BEBVL3SCZqtsqPGgA8ARXq7eSzCTee9A";
const OWNER = "EP9fKzBpQzyZC2GYjjAF9tKEeUwi7dqNqMStmxdYu4h2";
const bal = (owner: string, amount: string, mint = USDC_MINT) => ({ owner, mint, uiTokenAmount: { amount } });

test("fee = the treasury's USDC gain in the transaction", () => {
  const tx = {
    meta: {
      err: null,
      preTokenBalances: [bal(TREASURY, "1000000"), bal(OWNER, "0")],
      postTokenBalances: [bal(TREASURY, "1012500"), bal(OWNER, "237500")],
    },
  };
  assert.equal(treasuryUsdcGain(tx, TREASURY), BigInt(12500));
});

test("first fee into a new treasury account counts from zero", () => {
  const tx = { meta: { err: null, preTokenBalances: [], postTokenBalances: [bal(TREASURY, "500")] } };
  assert.equal(treasuryUsdcGain(tx, TREASURY), BigInt(500));
});

test("failed, unrelated, other-mint and outgoing transactions add nothing", () => {
  const failed = { meta: { err: { InstructionError: [0, "x"] }, preTokenBalances: [], postTokenBalances: [bal(TREASURY, "9")] } };
  assert.equal(treasuryUsdcGain(failed, TREASURY), BigInt(0));
  const unrelated = { meta: { err: null, preTokenBalances: [bal(OWNER, "5")], postTokenBalances: [bal(OWNER, "9")] } };
  assert.equal(treasuryUsdcGain(unrelated, TREASURY), BigInt(0));
  const otherMint = { meta: { err: null, preTokenBalances: [], postTokenBalances: [bal(TREASURY, "9", "So11111111111111111111111111111111111111112")] } };
  assert.equal(treasuryUsdcGain(otherMint, TREASURY), BigInt(0));
  const outgoing = { meta: { err: null, preTokenBalances: [bal(TREASURY, "9")], postTokenBalances: [bal(TREASURY, "1")] } };
  assert.equal(treasuryUsdcGain(outgoing, TREASURY), BigInt(0));
  assert.equal(treasuryUsdcGain(null, TREASURY), BigInt(0));
});
