/** Advisor models with NEAR attestation + E2EE. Whitelist for the blind proxy. */
export const ADVISOR_MODEL_OPTIONS = [
  {
    id: "deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated",
    label: "DeepSeek V4.1 Flash Abliterated",
    shortLabel: "DeepSeek Abliterated",
  },
  {
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    shortLabel: "GLM 5.3 Flash",
  },
  {
    id: "Qwen/Qwen3.8-27B-abliterated",
    label: "Qwen Abliterated",
    shortLabel: "Qwen Abliterated",
  },
] as const;

export type AdvisorModel = (typeof ADVISOR_MODEL_OPTIONS)[number]["id"];

export const ADVISOR_MODELS: readonly AdvisorModel[] = ADVISOR_MODEL_OPTIONS.map((m) => m.id);

/** Best default for Russian yield advice (measured 2026-11-07); user can switch in the chat UI. */
export const DEFAULT_ADVISOR_MODEL: AdvisorModel = "z-ai/glm-5.3-flash";

const MODEL_SET: ReadonlySet<string> = new Set(ADVISOR_MODELS);

export function isAdvisorModel(value: string): value is AdvisorModel {
  return MODEL_SET.has(value);
}

export function advisorModelLabel(model: string): string {
  return ADVISOR_MODEL_OPTIONS.find((m) => m.id === model)?.label ?? model;
}

export function advisorModelShortLabel(model: string): string {
  return ADVISOR_MODEL_OPTIONS.find((m) => m.id === model)?.shortLabel ?? model;
}

const STORAGE_KEY = "yield-ai-advisor-model";

export function loadPreferredAdvisorModel(): AdvisorModel {
  if (typeof window === "undefined") return DEFAULT_ADVISOR_MODEL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isAdvisorModel(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_ADVISOR_MODEL;
}

export function savePreferredAdvisorModel(model: AdvisorModel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, model);
  } catch {
    /* ignore */
  }
}
