// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
// Billing and gating of `POST v1/images/generations` in the NEAR AI proxy.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IMAGE_LOCKED,
  IMAGE_OUT_OF_CREDITS,
  IMAGE_SIGN_IN_REQUIRED,
  billImage,
  gateImageRequest,
  type ImageGateDeps,
} from "./imageBilling.ts";
import { IMAGE_MODEL, IMAGE_PRICE_USD } from "./models.ts";
import { refusalMessage } from "./refusals.ts";

const WALLET = "So1anaWa11et1111111111111111111111111111111";

function deps(over: Partial<ImageGateDeps> = {}): ImageGateDeps {
  return {
    walletFromSession: (token) => (token === "good" ? WALLET : null),
    walletBalance: async () => ({ availableUsd: 1 }),
    openChatUnlocked: async () => true,
    ...over,
  };
}

/** A ledger that keeps rows in memory, with the table's `on conflict do nothing`. */
function ledger() {
  const rows = new Map<string, { wallet: string; estimatedUsd: number; model: string | null; costUsd: number | null }>();
  return {
    rows,
    recordUsage: async (wallet: string, id: string, estimatedUsd: number, model: string | null) => {
      if (!rows.has(id)) rows.set(id, { wallet, estimatedUsd, model, costUsd: null });
    },
    setUsageCost: async (id: string, costUsd: number) => {
      const row = rows.get(id);
      if (row) row.costUsd = costUsd;
    },
  };
}

test("a picture costs $0.012", () => {
  assert.equal(IMAGE_PRICE_USD, 0.012);
});

test("401 without a session, and nothing else is looked up", async () => {
  let lookups = 0;
  const counting = deps({
    walletBalance: async () => {
      lookups += 1;
      return { availableUsd: 1 };
    },
  });
  for (const token of [null, "", "forged"]) {
    assert.deepEqual(await gateImageRequest(token, counting), { ok: false, status: 401, error: IMAGE_SIGN_IN_REQUIRED });
  }
  assert.equal(lookups, 0);
});

test("402 below the price of one picture, allowed at exactly the price", async () => {
  const below = await gateImageRequest("good", deps({ walletBalance: async () => ({ availableUsd: 0.0119 }) }));
  assert.deepEqual(below, { ok: false, status: 402, error: IMAGE_OUT_OF_CREDITS });
  const zero = await gateImageRequest("good", deps({ walletBalance: async () => ({ availableUsd: 0 }) }));
  assert.equal(zero.ok === false && zero.status, 402);
  const exact = await gateImageRequest("good", deps({ walletBalance: async () => ({ availableUsd: 0.012 }) }));
  assert.deepEqual(exact, { ok: true, wallet: WALLET });
});

test("403 when Open chat is locked, also when the lock cannot be read", async () => {
  const locked = await gateImageRequest("good", deps({ openChatUnlocked: async () => false }));
  assert.deepEqual(locked, { ok: false, status: 403, error: IMAGE_LOCKED });
  const unreadable = await gateImageRequest(
    "good",
    deps({
      openChatUnlocked: async () => {
        throw new Error("rpc down");
      },
    })
  );
  assert.equal(unreadable.ok === false && unreadable.status, 403);
});

test("503 when the ledger cannot be read: no picture on an unknown balance", async () => {
  const result = await gateImageRequest(
    "good",
    deps({
      walletBalance: async () => {
        throw new Error("db down");
      },
    })
  );
  assert.equal(result.ok === false && result.status, 503);
});

test("a success records exactly one img:<x-request-id> row at $0.012", async () => {
  const db = ledger();
  const id = await billImage({ wallet: WALLET, requestId: "req-123", upstreamOk: true }, db);
  assert.equal(id, "img:req-123");
  assert.deepEqual([...db.rows.entries()], [
    ["img:req-123", { wallet: WALLET, estimatedUsd: 0.012, model: IMAGE_MODEL, costUsd: 0.012 }],
  ]);
  // The same response billed again (a retry of the handler) does not add a second row.
  await billImage({ wallet: WALLET, requestId: "req-123", upstreamOk: true }, db);
  assert.equal(db.rows.size, 1);
});

test("an upstream 500 records nothing", async () => {
  const db = ledger();
  assert.equal(await billImage({ wallet: WALLET, requestId: "req-500", upstreamOk: false }, db), null);
  assert.equal(db.rows.size, 0);
});

test("nothing is recorded without a wallet (credits off) or without a request id", async () => {
  const db = ledger();
  assert.equal(await billImage({ wallet: null, requestId: "req-1", upstreamOk: true }, db), null);
  assert.equal(await billImage({ wallet: WALLET, requestId: null, upstreamOk: true }, db), null);
  assert.equal(db.rows.size, 0);
});

test("a ledger write failure does not break the response", async () => {
  const failing = {
    recordUsage: async () => {
      throw new Error("db down");
    },
    setUsageCost: async () => undefined,
  };
  assert.equal(await billImage({ wallet: WALLET, requestId: "req-2", upstreamOk: true }, failing), null);
});

test("the chat shows the proxy's refusals as written", () => {
  const body = (error: string) => JSON.stringify({ error });
  assert.equal(refusalMessage(401, body(IMAGE_SIGN_IN_REQUIRED), "Picture"), "Connect a Solana wallet and sign once to create pictures.");
  assert.equal(refusalMessage(402, body(IMAGE_OUT_OF_CREDITS), "Picture"), "A picture costs $0.012. Top up AI credits to continue.");
  assert.equal(refusalMessage(403, body(IMAGE_LOCKED), "Picture"), "Pictures unlock after a Safe deposit or a credits top-up.");
});

test("a model failure reads as a sentence and says nothing was charged", () => {
  const expected =
    "Picture: the model on NEAR AI Cloud is not answering right now (HTTP 500). Nothing was charged. Try again in a few minutes.";
  // NEAR AI's own error shapes, as a string and as an object, and a non-JSON body.
  assert.equal(refusalMessage(500, JSON.stringify({ error: "Image generation failed" }), "Picture"), expected);
  assert.equal(refusalMessage(500, JSON.stringify({ error: { message: "Image generation failed" } }), "Picture"), expected);
  assert.equal(refusalMessage(500, "<html>Bad gateway</html>", "Picture"), expected);
});

test("rate limit and ledger outages are explained, other errors keep their status", () => {
  assert.match(refusalMessage(429, JSON.stringify({ error: "Rate limit exceeded" }), "Chat"), /^Too many requests/);
  assert.match(refusalMessage(503, JSON.stringify({ error: "Credit ledger unavailable" }), "Chat"), /Nothing was charged/);
  assert.equal(refusalMessage(400, "", "Picture"), "Picture HTTP 400");
  assert.equal(refusalMessage(400, JSON.stringify({ error: "Unsupported size" }), "Picture"), "Unsupported size");
});
