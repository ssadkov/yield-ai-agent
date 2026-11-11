/**
 * Token usage of one completion. With `stream_options.include_usage`, NEAR AI sends a final stream
 * chunk with `usage` in plain text (only the message fields are encrypted), so both the browser and
 * the proxy can read it. Shared by `nearProxy.ts` (browser) and the NEAR AI proxy route (metering).
 */

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Parse a `usage` object from a chat completion (stream chunk or full response). */
export function parseUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const details = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const promptTokens = count(u.prompt_tokens);
  const completionTokens = count(u.completion_tokens);
  if (promptTokens === 0 && completionTokens === 0) return null;
  return {
    promptTokens,
    completionTokens,
    reasoningTokens: count(u.reasoning_tokens ?? details.reasoning_tokens),
    totalTokens: count(u.total_tokens) || promptTokens + completionTokens,
  };
}

/** The last `usage` found in SSE text (`data: {...}` lines). */
export function usageFromSse(text: string): TokenUsage | null {
  let found: TokenUsage | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:") || !trimmed.includes('"usage"')) continue;
    try {
      const usage = parseUsage((JSON.parse(trimmed.slice(5)) as { usage?: unknown }).usage);
      if (usage) found = usage;
    } catch {
      /* not JSON */
    }
  }
  return found;
}
