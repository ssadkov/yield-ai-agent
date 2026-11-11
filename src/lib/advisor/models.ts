/**
 * Models the chat may use. All have NEAR attestation + E2EE (checked 2026-11-12).
 * Prices, $ per 1M input / output tokens (NEAR AI `/v1/models`, 2026-11-12):
 *   GLM 5.3 Flash 0.08 / 0.50 · Qwen 3.8 27B 0.04 / 1.35 · DeepSeek V4.1 Flash abliterated 0.30 / 1.20.
 */

/** Yield Advisor always uses this one; credit estimates are priced on it. Best for Russian advice (2026-11-07). */
export const DEFAULT_ADVISOR_MODEL = "z-ai/glm-5.3-flash";
/** Used by the advisor only when the default model's attestation does not verify. */
export const ADVISOR_FALLBACK_MODEL = "Qwen/Qwen3.8-27B";
/** Refusals removed ("abliterated"). Open chat only, and only for wallets that unlocked it. */
export const UNCENSORED_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated";

/** Whitelist for the blind proxy. */
export const ADVISOR_MODELS = [DEFAULT_ADVISOR_MODEL, ADVISOR_FALLBACK_MODEL, UNCENSORED_MODEL] as const;

export type AdvisorModel = (typeof ADVISOR_MODELS)[number];

/** What Open chat offers. */
export const OPEN_CHAT_MODEL_OPTIONS = [
  { id: DEFAULT_ADVISOR_MODEL, label: "Standard", hint: "Same model as the advisor" },
  { id: UNCENSORED_MODEL, label: "Uncensored", hint: "Fewer refusals · about 2.5× the cost" },
] as const satisfies readonly { id: AdvisorModel; label: string; hint: string }[];

export type OpenChatModel = (typeof OPEN_CHAT_MODEL_OPTIONS)[number]["id"];

const MODEL_NAMES: Record<AdvisorModel, string> = {
  [DEFAULT_ADVISOR_MODEL]: "GLM 5.3 Flash",
  [ADVISOR_FALLBACK_MODEL]: "Qwen 3.8 27B",
  [UNCENSORED_MODEL]: "DeepSeek V4.1 Flash (uncensored)",
};

const MODEL_SET: ReadonlySet<string> = new Set(ADVISOR_MODELS);

export function isAdvisorModel(value: string): value is AdvisorModel {
  return MODEL_SET.has(value);
}

function isOpenChatModel(value: string): value is OpenChatModel {
  return OPEN_CHAT_MODEL_OPTIONS.some((option) => option.id === value);
}

/** Human name of a model, for the privacy badge and proof line. */
export function advisorModelShortLabel(model: string): string {
  return isAdvisorModel(model) ? MODEL_NAMES[model] : model;
}

export function openChatModelLabel(model: OpenChatModel): string {
  return OPEN_CHAT_MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model;
}

const STORAGE_KEY = "yield-ai-open-chat-model";

export function loadPreferredOpenChatModel(): OpenChatModel {
  if (typeof window === "undefined") return DEFAULT_ADVISOR_MODEL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isOpenChatModel(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_ADVISOR_MODEL;
}

export function savePreferredOpenChatModel(model: OpenChatModel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, model);
  } catch {
    /* ignore */
  }
}
