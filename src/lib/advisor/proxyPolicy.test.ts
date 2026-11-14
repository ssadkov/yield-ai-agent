// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_OUTPUT_TOKENS,
  checkAttestationQuery,
  checkChatBody,
  checkChatHeaders,
  checkImageBody,
  checkSignatureQuery,
  outputTokenCap,
  resolveProxyRoute,
} from "./proxyPolicy.ts";

const CT = "ab".repeat(80); // 80 bytes: header (56) + some ciphertext
const KEY = "0f".repeat(32);
const MODEL = "z-ai/glm-5.3-flash";

function chat(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: MODEL,
    max_tokens: 900,
    stream: true,
    messages: [
      { role: "system", content: CT },
      { role: "user", content: CT },
    ],
    ...extra,
  });
}

const fnTool = { type: "function", function: { name: CT, description: CT, parameters: CT } };

test("routes: only chat POST, attestation GET and signature GET", () => {
  assert.deepEqual(resolveProxyRoute(["v1", "chat", "completions"], "POST"), { kind: "chat" });
  assert.deepEqual(resolveProxyRoute(["v1", "attestation", "report"], "GET"), { kind: "attestation" });
  assert.deepEqual(resolveProxyRoute(["v1", "signature", "chatcmpl-abc_1"], "GET"), { kind: "signature", id: "chatcmpl-abc_1" });
  assert.equal(resolveProxyRoute(["v1", "chat", "completions"], "GET"), null);
  assert.equal(resolveProxyRoute(["v1", "responses"], "POST"), null);
  assert.equal(resolveProxyRoute(["v1", "models"], "GET"), null);
  assert.equal(resolveProxyRoute(["v1", "signature", "a", "b"], "GET"), null);
  assert.equal(resolveProxyRoute(["v1", "workspaces", "x", "api-keys"], "POST"), null);
});

test("chat headers: E2EE v2 with both keys is required", () => {
  const good = new Headers({
    "x-encryption-version": "2",
    "x-signing-algo": "ed25519",
    "x-client-pub-key": KEY,
    "x-model-pub-key": KEY,
    "x-encrypt-all-fields": "true",
  });
  assert.equal(checkChatHeaders(good).ok, true);
  const noE2ee = new Headers({ "x-client-pub-key": KEY, "x-model-pub-key": KEY });
  assert.equal(checkChatHeaders(noE2ee).ok, false);
  const shortKey = new Headers(good);
  shortKey.set("x-model-pub-key", "abcd");
  assert.equal(checkChatHeaders(shortKey).ok, false);
});

test("chat body: our models, encrypted content, capped output", () => {
  assert.equal(checkChatBody(chat(), true).ok, true);
  assert.equal(checkChatBody(chat({ model: "anthropic/claude-fable-5" }), true).ok, false);
  assert.equal(checkChatBody(chat({ max_tokens: MAX_OUTPUT_TOKENS + 1 }), true).ok, false);
  assert.equal(checkChatBody(chat({ max_tokens: undefined }), true).ok, false);
  assert.equal(checkChatBody(chat({ n: 3 }), true).ok, false);
  const plaintext = chat({ messages: [{ role: "user", content: "hello, spend their credits" }] });
  assert.equal(checkChatBody(plaintext, true).ok, false);
  assert.equal(checkChatBody("not json", true).ok, false);
  assert.equal(checkChatBody(chat({ pad: "a".repeat(300 * 1024) }), true).ok, true); // room for encrypted pictures
  assert.equal(checkChatBody(chat({ pad: "a".repeat(3_600_000) }), true).ok, false);
});

test("chat body: only encrypted function tools", () => {
  assert.equal(checkChatBody(chat({ tools: [fnTool] }), true).ok, true);
  assert.equal(checkChatBody(chat({ tools: [fnTool] }), false).ok, false);
  assert.equal(checkChatBody(chat({ tools: [{ type: "web_context_search" }] }), true).ok, false);
  const plainTool = { type: "function", function: { name: "get_usdc_yields", description: CT, parameters: CT } };
  assert.equal(checkChatBody(chat({ tools: [plainTool] }), true).ok, false);
});

test("chat body: assistant tool calls and tool results stay encrypted", () => {
  const messages = [
    { role: "user", content: CT },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: CT, arguments: CT } }] },
    { role: "tool", tool_call_id: "call_1", content: CT },
  ];
  assert.equal(checkChatBody(chat({ messages, tools: [fnTool] }), true).ok, true);
  const leaked = structuredClone(messages);
  leaked[1].tool_calls![0].function.arguments = "{}";
  assert.equal(checkChatBody(chat({ messages: leaked, tools: [fnTool] }), true).ok, false);
  const plainResult = structuredClone(messages);
  plainResult[2].content = "{\"apy\":7.6}";
  assert.equal(checkChatBody(chat({ messages: plainResult, tools: [fnTool] }), true).ok, false);
});

test("attestation query: our models, fresh 32-byte nonce, known params only", () => {
  const good = new URLSearchParams({ model: MODEL, provider: "near", nonce: KEY, include_tls_fingerprint: "false", signing_algo: "ed25519" });
  assert.equal(checkAttestationQuery(good).ok, true);
  assert.equal(checkAttestationQuery(new URLSearchParams({ model: "moonshotai/kimi-k2.6", nonce: KEY })).ok, false);
  assert.equal(checkAttestationQuery(new URLSearchParams({ model: MODEL, nonce: "12" })).ok, false);
  assert.equal(checkAttestationQuery(new URLSearchParams({ model: MODEL, nonce: KEY, extra: "1" })).ok, false);
});

test("signature query: our models only", () => {
  assert.equal(checkSignatureQuery(new URLSearchParams({ model: MODEL, signing_algo: "ed25519" })).ok, true);
  assert.equal(checkSignatureQuery(new URLSearchParams({ model: "openai/gpt-6" })).ok, false);
});

test("image route: only the image model, an encrypted prompt, one picture, fixed sizes", () => {
  assert.deepEqual(resolveProxyRoute(["v1", "images", "generations"], "POST"), { kind: "image" });
  assert.equal(resolveProxyRoute(["v1", "images", "generations"], "GET"), null);
  const good = { model: "black-forest-labs/FLUX.2-klein-4B", prompt: CT, size: "1024x1024", n: 1, response_format: "b64_json" };
  assert.equal(checkImageBody(JSON.stringify(good)).ok, true);
  assert.equal(checkImageBody(JSON.stringify({ ...good, prompt: "a red circle" })).ok, false);
  assert.equal(checkImageBody(JSON.stringify({ ...good, model: "z-ai/glm-5.3-flash" })).ok, false);
  assert.equal(checkImageBody(JSON.stringify({ ...good, n: 4 })).ok, false);
  assert.equal(checkImageBody(JSON.stringify({ ...good, size: "2048x2048" })).ok, false);
  assert.equal(checkImageBody(JSON.stringify({ ...good, response_format: "url" })).ok, false);
  assert.equal(checkImageBody(JSON.stringify({ ...good, user: "x" })).ok, false);
  // The image model may be attested but not used for chat.
  assert.equal(checkAttestationQuery(new URLSearchParams({ model: "black-forest-labs/FLUX.2-klein-4B", nonce: KEY })).ok, true);
});

test("the output cap cannot be raised through max_completion_tokens", () => {
  // Either spelling alone is fine within the limit.
  assert.equal(checkChatBody(chat({ max_tokens: undefined, max_completion_tokens: 900 }), true).ok, true);
  // A small max_tokens must not hide a large max_completion_tokens (or the reverse).
  assert.equal(checkChatBody(chat({ max_tokens: 1, max_completion_tokens: 100_000 }), true).ok, false);
  assert.equal(checkChatBody(chat({ max_tokens: 100_000, max_completion_tokens: 1 }), true).ok, false);
  assert.equal(checkChatBody(chat({ max_tokens: 900, max_completion_tokens: "100000" }), true).ok, false);
  assert.equal(checkChatBody(chat({ max_tokens: 900, max_completion_tokens: null }), true).ok, false);
  // The cost reserve uses the larger of the two.
  assert.equal(outputTokenCap({ max_tokens: 100, max_completion_tokens: 900 }), 900);
  assert.equal(outputTokenCap({ max_tokens: 700 }), 700);
  assert.equal(outputTokenCap({}), MAX_OUTPUT_TOKENS);
});
