/** Prefer models with NEAR attestation + E2EE. Primary first. */
export const ADVISOR_MODELS = ["z-ai/glm-5.3-flash", "Qwen/Qwen3.8-27B"] as const;

export type AdvisorModel = (typeof ADVISOR_MODELS)[number];
