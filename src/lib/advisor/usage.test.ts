// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUsage, usageFromSse } from "./usage.ts";

// Final chunk of a streamed E2EE completion from z-ai/glm-5.3-flash, 2026-11-11.
const LIVE_CHUNK =
  'data: {"id":"572d7bf76870464fb2817f363ec9780a","object":"chat.completion.chunk","created":1794400548,"model":"z-ai/glm-5.3-flash","choices":[],"usage":{"prompt_tokens":14,"total_tokens":17,"completion_tokens":3,"prompt_tokens_details":null,"reasoning_tokens":1,"completion_tokens_details":{"reasoning_tokens":1}}}';

test("usage from the live final chunk", () => {
  const sse = ['data: {"choices":[{"delta":{"content":"abcd"}}]}', "", LIVE_CHUNK, "", "data: [DONE]", ""].join("\n");
  assert.deepEqual(usageFromSse(sse), { promptTokens: 14, completionTokens: 3, reasoningTokens: 1, totalTokens: 17 });
});

test("no usage chunk, or an empty one", () => {
  assert.equal(usageFromSse('data: {"choices":[]}\n\ndata: [DONE]\n'), null);
  assert.equal(parseUsage({ prompt_tokens: 0, completion_tokens: 0 }), null);
  assert.equal(parseUsage(null), null);
});

test("reasoning tokens from completion_tokens_details, total filled in", () => {
  assert.deepEqual(parseUsage({ prompt_tokens: 100, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 12 } }), {
    promptTokens: 100,
    completionTokens: 40,
    reasoningTokens: 12,
    totalTokens: 140,
  });
});
