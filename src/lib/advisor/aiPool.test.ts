// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotFromReadings, unitsToNumber, yoctoToNear, type FarmPosition } from "./aiPool.ts";

const position = (earned: string): FarmPosition => ({
  account_id: "sadkov.near",
  validator_id: "nearai.pool.near",
  staked_near_amount: "43000000000000000000000000",
  pending_reward_units: earned,
  total_earned_reward_units: earned,
  status: "Active",
});

test("fixed-point helpers", () => {
  assert.equal(unitsToNumber("111364187146917110733542"), 111364.18714691711);
  assert.equal(yoctoToNear("43000000000000000000000000"), 43);
});

test("two live readings from 2026-11-11 give the dashboard rate", () => {
  // stake.dao get_farm_position for sadkov.near, 93.994 s apart; dashboard showed $0.86/month.
  const first = { position: position("111364187146917110733542"), atMs: 0 };
  const second = { position: position("111394790638700774890277"), atMs: 93_994 };
  const snap = snapshotFromReadings(first, second);
  assert.equal(snap.stakedNear, 43);
  assert.ok(Math.abs(snap.usdPerMonth - 0.844) < 0.01, `usdPerMonth ${snap.usdPerMonth}`);
  assert.equal(snap.requestsPerMonth, 843);
  assert.equal(snap.measuredOverSeconds, 94);
  assert.ok(Math.abs(snap.earnedUsd - 0.1114) < 0.001);
});

test("readings out of order are refused", () => {
  const a = { position: position("1"), atMs: 10 };
  assert.throws(() => snapshotFromReadings(a, { ...a, atMs: 5 }));
});
