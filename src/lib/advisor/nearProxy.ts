import {
  clientPubHex,
  createClientKeys,
  decryptFromModel,
  encryptToModel,
  randomNonceHex,
  type ClientKeys,
} from "@/lib/advisor/e2ee";
import { ADVISOR_MODELS, type AdvisorModel } from "@/lib/advisor/models";

const PROXY = "/agent/api/near";

export type AttestedModel = {
  model: AdvisorModel;
  modelPubKeyHex: string;
  nonce: string;
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
      "x-no-aliasing": "true",
    },
  });
}

export async function pickAttestedModel(): Promise<AttestedModel> {
  let lastError = "No attested model available";
  for (const model of ADVISOR_MODELS) {
    const nonce = randomNonceHex(32);
    const query = new URLSearchParams({
      model,
      provider: "near",
      signing_algo: "ed25519",
      include_tls_fingerprint: "false",
      nonce,
    });
    const response = await proxyFetch(`v1/attestation/report?${query}`);
    if (!response.ok) {
      lastError = `Attestation HTTP ${response.status} for ${model}`;
      continue;
    }
    const body = (await response.json()) as {
      model_attestations?: { signing_public_key?: string }[];
    };
    const candidates = body.model_attestations ?? [];
    const key = candidates.find((c) => typeof c.signing_public_key === "string")?.signing_public_key;
    if (!key) {
      lastError = `No signing_public_key for ${model}`;
      continue;
    }
    // Full Intel/NVIDIA quote verification is still TODO; key is taken from first candidate like the probe.
    return { model, modelPubKeyHex: key, nonce };
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

export type StreamResult = {
  text: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  inferenceId: string | null;
};

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
    reasoning_effort: "low",
  };

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
    body: JSON.stringify(body),
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
  const toolMap = new Map<number, { id: string; name: string; arguments: string }>();

  const tryDecrypt = async (value: string) => {
    try {
      return await decryptFromModel(value, keys.xSecret);
    } catch {
      return "";
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
        choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
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
  };
}
