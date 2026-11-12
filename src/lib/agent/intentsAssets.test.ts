// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { toBaseUnits } from "./intentsAssets.ts";

test("decimal amounts convert to base units exactly", () => {
  assert.equal(toBaseUnits("12.5", 6), BigInt(12_500_000));
  assert.equal(toBaseUnits("0,001", 8), BigInt(100_000));
  assert.equal(toBaseUnits("1", 24), BigInt(10) ** BigInt(24));
  assert.equal(toBaseUnits("0.1", 18), BigInt(10) ** BigInt(17));
});

test("anything else is refused", () => {
  for (const bad of ["", "0", "0.000", "-1", "1e3", "abc", "1.1234567", " . "]) {
    assert.equal(toBaseUnits(bad, 6), null, bad);
  }
});
