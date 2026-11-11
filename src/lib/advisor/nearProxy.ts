import {
  clientPubHex,
  createClientKeys,
  decryptFromModel,
  encryptToModel,
  type ClientKeys,
} from "@/lib/advisor/e2ee";
import { ADVISOR_MODELS, type AdvisorModel } from "@/lib/advisor/models";
import type { VerifiedModelAttestation } from "@nearai/inference-sdk";
import { sessionHeaders } from "@/lib/credits/client";
import { parseUsage, type TokenUsage } from "@/lib/advisor/usage";

const PROXY = "/agent/api/near";

/** What the NEAR SDK verified before we encrypt anything to this model. */
export type AttestationSummary = {
  /** Intel TDX quote verified; TCB status accepted by the SDK's default policy. */
  tcbStatus: string;
  /** NVIDIA GPU evidence: verified, or the enclave did not provide any. */
  gpuEvidence: "verified" | "not_provided";
  /** Model signer bound to our nonce in the verified quote. */
  signingAddress: string;
  verifiedAt: number;
};

export type AttestedModel = {
  model: AdvisorModel;
  modelPubKeyHex: string;
  nonce: string;
  attestation: AttestationSummary;
  /** SDK results kept in memory; response signatures must match one of these signers. */
  verifiedAttestations: readonly VerifiedModelAttestation[];
};

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${PROXY}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      ...sessionHeaders(),
      "x-no-aliasing": "true",
    },
  });
}

/**
 * Pick the first advisor model whose NEAR attestation verifies, and use the E2EE key bound to it.
 * `@nearai/inference-sdk` checks every candidate: Intel TDX quote and TCB status, report data
 * binding our fresh nonce and the signer, RTMR3 event log, MRCONFIGID, and NVIDIA GPU evidence
 * when present (collateral via NEAR AI's CORS proxies). Every candidate must pass and they must
 * agree on the key; otherwise we try the next model and never send anything to this one.
 * The SDK is loaded on first use so it stays out of the page's initial bundle.
 */
export async function pickAttestedModel(): Promise<AttestedModel> {
  const { AttestationClient, verifyModelAttestation } = await import("@nearai/inference-sdk");
  const client = new AttestationClient({ baseUrl: `${window.location.origin}${PROXY}/v1` });
  let lastError = "No attested model available";
  for (const model of ADVISOR_MODELS) {
    try {
      const fetched = await client.fetchModelAttestations({ model, signingAlgo: "ed25519" });
      if (fetched.attestations.length === 0) {
        lastError = `No NEAR attestation for ${model}`;
        continue;
      }
      const verified = await Promise.all(
        fetched.attestations.map((attestation) =>
          verifyModelAttestation({ attestation, clientBinding: fetched.clientBinding })
        )
      );
      const keys = new Set(verified.map((v) => v.signingPublicKey).filter((k): k is string => Boolean(k)));
      if (keys.size !== 1) {
        lastError = `Attestation for ${model} has ${keys.size} distinct E2EE keys`;
        continue;
      }
      const [key] = keys;
      const first = verified[0];
      return {
        model,
        modelPubKeyHex: key,
        nonce: fetched.clientBinding.nonce,
        attestation: {
          tcbStatus: first.tcbStatus,
          gpuEvidence: verified.every((v) => v.gpuEvidence === "verified") ? "verified" : "not_provided",
          signingAddress: first.signer.signingAddress,
          verifiedAt: Date.now(),
        },
        verifiedAttestations: verified,
      };
    } catch (error) {
      lastError = `Attestation failed for ${model}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(lastError);
}

export function createSessionKeys(): ClientKeys {
  return createClientKeys();
}

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

async function encryptTools(tools: ToolDef[], modelPub: string) {
  return Promise.all(
    tools.map(async (tool) => ({
      type: "function" as const,
      function: {
        name: await encryptToModel(tool.function.name, modelPub),
        description: await encryptToModel(tool.function.description, modelPub),
        parameters: await encryptToModel(JSON.stringify(tool.function.parameters), modelPub),
      },
    }))
  );
}

async function encryptMessages(messages: ChatMessage[], modelPub: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: await encryptToModel(message.content, modelPub),
      });
      continue;
    }
    if (message.role === "assistant" && "tool_calls" in message && message.tool_calls) {
      out.push({
        role: "assistant",
        content: message.content ? await encryptToModel(message.content, modelPub) : null,
        tool_calls: await Promise.all(
          message.tool_calls.map(async (tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: await encryptToModel(tc.function.name, modelPub),
              arguments: await encryptToModel(tc.function.arguments || "{}", modelPub),
            },
          }))
        ),
      });
      continue;
    }
    out.push({
      role: message.role,
      content: await encryptToModel(message.content ?? "", modelPub),
    });
  }
  return out;
}

export type StreamHandlers = {
  onText?: (chunk: string) => void;
  onStatus?: (status: string) => void;
};

/** Exact bytes of one completion, kept so the browser can check NEAR's signature over them. */
export type CompletionEvidence = {
  completionId: string;
  requestBody: Uint8Array;
  responseBody: Uint8Array;
};

export type StreamResult = {
  text: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  inferenceId: string | null;
  evidence: CompletionEvidence | null;
  usage: TokenUsage | null;
};

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function streamChatCompletion(options: {
  attested: AttestedModel;
  keys: ClientKeys;
  messages: ChatMessage[];
  tools: ToolDef[];
  handlers?: StreamHandlers;
}): Promise<StreamResult> {
  const { attested, keys, messages, tools, handlers } = options;
  const body = {
    model: attested.model,
    messages: await encryptMessages(messages, attested.modelPubKeyHex),
    tools: await encryptTools(tools, attested.modelPubKeyHex),
    max_tokens: 900,
    stream: true,
    // Final chunk carries token counts in plain text; the proxy meters them per wallet.
    stream_options: { include_usage: true },
    reasoning_effort: "low",
  };

  const requestJson = JSON.stringify(body);
  const response = await proxyFetch("v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signing-Algo": "ed25519",
      "X-Client-Pub-Key": clientPubHex(keys),
      "X-Model-Pub-Key": attested.modelPubKeyHex,
      "X-Encryption-Version": "2",
      "X-Encrypt-All-Fields": "true",
    },
    body: requestJson,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Chat HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }

  const inferenceId = response.headers.get("inference-id");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completionId = "";
  let usage: TokenUsage | null = null;
  const rawChunks: Uint8Array[] = [];
  const toolMap = new Map<number, { id: string; name: string; arguments: string }>();

  // Every streamed field must decrypt with our key. A field that does not is either tampering or
  // a reply that did not come from the attested model, so the whole answer is rejected.
  const tryDecrypt = async (value: string) => {
    try {
      return await decryptFromModel(value, keys.xSecret);
    } catch {
      throw new Error("A reply field did not decrypt with this session's key; the answer was discarded.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawChunks.push(value);
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: {
        id?: string;
        choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (!completionId && typeof parsed.id === "string") completionId = parsed.id;
      usage = parseUsage((parsed as { usage?: unknown }).usage) ?? usage;
      const delta = parsed.choices?.[0]?.delta ?? {};
      if (delta.content) {
        const piece = await tryDecrypt(delta.content);
        if (piece) {
          text += piece;
          handlers?.onText?.(piece);
        }
      }
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? 0;
        const current = toolMap.get(index) ?? { id: "", name: "", arguments: "" };
        if (tc.id) current.id = tc.id;
        if (tc.function?.name) current.name += await tryDecrypt(tc.function.name);
        if (tc.function?.arguments) current.arguments += await tryDecrypt(tc.function.arguments);
        toolMap.set(index, current);
      }
    }
  }

  return {
    text: text.replace(/^\n+/, ""),
    toolCalls: [...toolMap.values()].filter((t) => t.id && t.name),
    inferenceId,
    evidence: completionId
      ? { completionId, requestBody: new TextEncoder().encode(requestJson), responseBody: concatBytes(rawChunks) }
      : null,
    usage,
  };
}

export type AnswerProof = {
  verified: boolean;
  /** provider_tee: signed inside the model's TEE by the attested signer. */
  signatureKind?: string;
  signer?: string;
  completionIds: string[];
  error?: string;
  /** First bytes of the last request as it left the browser (ciphertext), for the proof panel. */
  requestExcerpt: string;
  requestBytes: number;
  modelKeyFingerprint: string;
  checkedAt: number;
};

/**
 * Check NEAR's signature over the exact request and response bytes of every completion in a turn,
 * and that the signer is the model whose attestation we verified before encrypting. Signature
 * records expire after about an hour, so this runs right after the answer.
 */
export async function verifyAnswer(attested: AttestedModel, evidence: CompletionEvidence[]): Promise<AnswerProof> {
  const last = evidence[evidence.length - 1];
  const base: AnswerProof = {
    verified: false,
    completionIds: evidence.map((e) => e.completionId),
    requestExcerpt: last ? new TextDecoder().decode(last.requestBody.slice(0, 600)) : "",
    requestBytes: last?.requestBody.length ?? 0,
    modelKeyFingerprint: `${attested.modelPubKeyHex.slice(0, 8)}…${attested.modelPubKeyHex.slice(-8)}`,
    checkedAt: Date.now(),
  };
  if (evidence.length === 0) return { ...base, error: "No completion id to check" };
  try {
    const { AttestationClient, verifyModelResponse } = await import("@nearai/inference-sdk");
    const client = new AttestationClient({ baseUrl: `${window.location.origin}${PROXY}/v1` });
    let kind = "";
    let signer = "";
    for (const item of evidence) {
      const signature = await client.fetchCompletionSignature({ completionId: item.completionId, signingAlgo: "ed25519" });
      const attestation = attested.verifiedAttestations.find(
        (v) => v.signer.signingAddress.toLowerCase() === signature.signer.signingAddress.toLowerCase()
      );
      if (!attestation) throw new Error("Signer does not match the attested model");
      verifyModelResponse({
        requestBody: item.requestBody,
        responseBody: item.responseBody,
        signature,
        attestation,
      });
      kind = signature.kind;
      signer = signature.signer.signingAddress;
    }
    return { ...base, verified: true, signatureKind: kind, signer };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}
