// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { guestKey, trialState } from "./trial.ts";

const limits = { requestsPerDay: 10, allGuestsUsdPerDay: 0.1 };
const secret = "s".repeat(32);

test("guest key hides the IP and needs a secret", () => {
  const key = guestKey("203.0.113.7", secret);
  assert.ok(key?.startsWith("guest:"));
  assert.ok(!key?.includes("203"));
  assert.equal(key, guestKey("203.0.113.7", secret));
  assert.notEqual(key, guestKey("203.0.113.8", secret));
  assert.equal(guestKey(null, secret), null);
  assert.equal(guestKey("203.0.113.7", "short"), null);
});

test("trial counts requests per visitor and stops at the daily cap", () => {
  assert.deepEqual(trialState({ guestRequestsToday: 0, allGuestsUsdToday: 0, limits }), {
    allowed: true,
    requestsLeft: 10,
    requestsPerDay: 10,
  });
  assert.equal(trialState({ guestRequestsToday: 9, allGuestsUsdToday: 0.02, limits }).requestsLeft, 1);
  assert.equal(trialState({ guestRequestsToday: 10, allGuestsUsdToday: 0.02, limits }).reason, "visitor_limit");
  const capped = trialState({ guestRequestsToday: 0, allGuestsUsdToday: 0.1, limits });
  assert.equal(capped.allowed, false);
  assert.equal(capped.reason, "daily_cap");
});
