/**
 * What the NEAR AI proxy (`src/app/api/near/[...path]/route.ts`) will forward with our API key.
 * Anything else is refused, so the key cannot be used for other models, plaintext prompts,
 * built-in paid tools or oversized requests. Pure functions, unit-tested in proxyPolicy.test.ts.
 */
import { ADVISOR_MODELS } from "./models.ts";

export const MAX_CHAT_BODY_BYTES = 256 * 1024;
export const MAX_OUTPUT_TOKENS = 1200;
export const MAX_MESSAGES = 60;

const MODELS: ReadonlySet<string> = new Set(ADVISOR_MODELS);
const HEX = /^[0-9a-f]+$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const SIGNATURE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ATTESTATION_PARAMS = new Set([
  "model",
  "provider",
  "nonce",
  "include_tls_fingerprint",
  "signing_algo",
  "signing_address",
]);
const SIGNATURE_PARAMS = new Set(["model", "signing_algo"]);

export type PolicyResult = { ok: true } | { ok: false; status: number; error: string };

const ok: PolicyResult = { ok: true };
const deny = (status: number, error: string): PolicyResult => ({ ok: false, status, error });

/** An E2EE field: hex ciphertext with at least the 56-byte header (ephemeral key + nonce). */
function isCiphertext(value: unknown): boolean {
  return typeof value === "string" && value.length >= 112 && value.length % 2 === 0 && HEX.test(value);
}

export type ProxyRoute =
  | { kind: "chat" }
  | { kind: "attestation" }
  | { kind: "signature"; id: string };

export function resolveProxyRoute(parts: readonly string[], method: string): ProxyRoute | null {
  const path = parts.join("/");
  if (path === "v1/chat/completions" && method === "POST") return { kind: "chat" };
  if (path === "v1/attestation/report" && method === "GET") return { kind: "attestation" };
  const signature = /^v1\/signature\/([^/]+)$/.exec(path);
  if (signature && method === "GET" && SIGNATURE_ID.test(signature[1])) {
    return { kind: "signature", id: signature[1] };
  }
  return null;
}

export function checkAttestationQuery(params: URLSearchParams): PolicyResult {
  for (const key of params.keys()) {
    if (!ATTESTATION_PARAMS.has(key)) return deny(400, `Unexpected parameter: ${key}`);
  }
  const model = params.get("model");
  if (!model || !MODELS.has(model)) return deny(403, "Model not allowed");
  const provider = params.get("provider");
  if (provider !== null && provider !== "near") return deny(400, "provider must be near");
  const nonce = params.get("nonce");
  if (!nonce || !HEX_64.test(nonce)) return deny(400, "nonce must be 32 bytes of hex");
  return ok;
}

export function checkSignatureQuery(params: URLSearchParams): PolicyResult {
  for (const key of params.keys()) {
    if (!SIGNATURE_PARAMS.has(key)) return deny(400, `Unexpected parameter: ${key}`);
  }
  const model = params.get("model");
  if (model !== null && !MODELS.has(model)) return deny(403, "Model not allowed");
  return ok;
}

export function checkChatHeaders(headers: Headers): PolicyResult {
  if (headers.get("x-encryption-version") !== "2") return deny(400, "E2EE v2 required");
  if (headers.get("x-signing-algo") !== "ed25519") return deny(400, "x-signing-algo must be ed25519");
  if (!HEX_64.test(headers.get("x-client-pub-key") ?? "")) return deny(400, "x-client-pub-key required");
  if (!HEX_64.test(headers.get("x-model-pub-key") ?? "")) return deny(400, "x-model-pub-key required");
  const allFields = headers.get("x-encrypt-all-fields");
  if (allFields !== null && allFields !== "true") return deny(400, "x-encrypt-all-fields must be true");
  return ok;
}

type ChatBody = {
  model?: unknown;
  messages?: unknown;
  tools?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  n?: unknown;
};

/**
 * The body must be an E2EE request to one of our models: every message content is ciphertext,
 * tools are plain functions (no built-in web search or other paid platform tools), output is capped.
 */
export function checkChatBody(raw: string, encryptAllFields: boolean): PolicyResult {
  if (raw.length > MAX_CHAT_BODY_BYTES) return deny(413, "Request too large");
  let body: ChatBody;
  try {
    body = JSON.parse(raw) as ChatBody;
  } catch {
    return deny(400, "Body must be JSON");
  }
  if (!body || typeof body !== "object") return deny(400, "Body must be an object");
  if (typeof body.model !== "string" || !MODELS.has(body.model)) return deny(403, "Model not allowed");

  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
    return deny(400, `max_tokens must be 1..${MAX_OUTPUT_TOKENS}`);
  }
  if (body.n !== undefined && body.n !== 1) return deny(400, "n must be 1");

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return deny(400, `messages must have 1..${MAX_MESSAGES} entries`);
  }
  for (const message of body.messages as Record<string, unknown>[]) {
    if (!message || typeof message !== "object") return deny(400, "Invalid message");
    const content = message.content;
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (content === null || content === undefined) {
      if (!(message.role === "assistant" && hasToolCalls)) return deny(400, "Message content required");
    } else if (!isCiphertext(content)) {
      return deny(400, "Message content must be E2EE ciphertext");
    }
    if (hasToolCalls) {
      if (!encryptAllFields) return deny(400, "Tool calls require x-encrypt-all-fields");
      for (const call of message.tool_calls as Record<string, unknown>[]) {
        const fn = call?.function as Record<string, unknown> | undefined;
        if (!fn || !isCiphertext(fn.name) || !isCiphertext(fn.arguments)) {
          return deny(400, "Tool call fields must be E2EE ciphertext");
        }
      }
    }
  }

  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return deny(400, "tools must be an array");
    if (body.tools.length > 0 && !encryptAllFields) return deny(400, "Tools require x-encrypt-all-fields");
    for (const tool of body.tools as Record<string, unknown>[]) {
      if (tool?.type !== "function") return deny(400, "Only function tools are allowed");
      const fn = tool.function as Record<string, unknown> | undefined;
      if (!fn || !isCiphertext(fn.name) || !isCiphertext(fn.description) || !isCiphertext(fn.parameters)) {
        return deny(400, "Tool fields must be E2EE ciphertext");
      }
    }
  }
  return ok;
}
