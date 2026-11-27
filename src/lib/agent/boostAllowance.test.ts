import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boostMonthlyUsd } from "./aptosAgent.ts";
import { parseBoostAccount } from "./aptosAgent.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("allowance is 30 days of the current Grain rate", () => {
  const state = parseBoostAccount(JSON.parse(readFileSync(new URL("./fixtures/boost-account.json", import.meta.url), "utf8")));
  assert.ok(state);
  // $1,510.90 at 3% on own capital: ≈ $0.124 a day, ≈ $3.73 a month. Not the campaign-wide grainTotal.
  near(boostMonthlyUsd(state.boost.grainPerDay, 1), state.boost.grainPerDay * 30);
  assert.ok(boostMonthlyUsd(state.boost.grainPerDay, 1) > 3.7 && boostMonthlyUsd(state.boost.grainPerDay, 1) < 3.8);
});

test("share scales it and 0 turns it off", () => {
  near(boostMonthlyUsd(0.1, 0.5), 1.5);
  assert.equal(boostMonthlyUsd(0.1, 0), 0);
});

test("no Grain, no allowance", () => {
  assert.equal(boostMonthlyUsd(0, 1), 0);
  assert.equal(boostMonthlyUsd(Number.NaN, 1), 0);
  assert.equal(boostMonthlyUsd(-1, 1), 0);
});
