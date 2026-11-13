/** Chat desk modes: product advisor vs free playground (no system prompt, no tools). */

import { ADVISOR_SYSTEM_PROMPT } from "./knowledge.ts";

export const CHAT_MODES = ["advisor", "free"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** Seed model context: advisor gets the product system prompt; free starts empty. */
export function seedHistoryForMode(
  mode: ChatMode
): Array<{ role: "system"; content: string }> {
  if (mode === "advisor") return [{ role: "system", content: ADVISOR_SYSTEM_PROMPT }];
  return [];
}

export const DEFAULT_CHAT_MODE: ChatMode = "advisor";

export function isChatMode(value: unknown): value is ChatMode {
  return value === "advisor" || value === "free";
}

const MODE_STORAGE_KEY = "yield-agent:chat-mode";

export function loadPreferredChatMode(): ChatMode {
  if (typeof window === "undefined") return DEFAULT_CHAT_MODE;
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return isChatMode(raw) ? raw : DEFAULT_CHAT_MODE;
  } catch {
    return DEFAULT_CHAT_MODE;
  }
}

export function savePreferredChatMode(mode: ChatMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export const CHAT_MODE_LABEL: Record<ChatMode, string> = {
  advisor: "Yield Advisor",
  free: "Open chat",
};

/** One line under each mode in the picker. */
export const CHAT_MODE_HINT: Record<ChatMode, string> = {
  advisor: "Yields, Safes, plans you sign",
  free: "Ask anything · same privacy",
};

/** Why Open chat is greyed out until the wallet has skin in the game. */
export const OPEN_CHAT_LOCKED_HINT = "Unlocks after a Safe deposit or a credits top-up";

export const CHAT_MODE_EMPTY_TITLE: Record<ChatMode, string> = {
  advisor: "How can I help?",
  free: "Ask anything",
};

export const CHAT_MODE_EMPTY_BLURB: Record<ChatMode, string> = {
  advisor: "Yields, Solana Safe routes, and a plan you sign yourself.",
  free: "Encrypted in your browser, answered inside a verified enclave.",
};

export const CHAT_MODE_PLACEHOLDER: Record<ChatMode, string> = {
  advisor: "Message Yield AI…",
  free: "Message privately…",
};

export const ADVISOR_SUGGESTIONS = [
  "Where should I put 200 USDC on Solana?",
  "What’s the best USDC yield right now?",
  "Explain Kamino vs Exponent for USDC",
] as const;

export const FREE_SUGGESTIONS = [
  "Explain what a TEE is in plain language",
  "Write a short checklist for reviewing a DeFi vault",
  "Compare fixed vs variable USDC yields conceptually",
] as const;

export function suggestionsForMode(mode: ChatMode): readonly string[] {
  return mode === "advisor" ? ADVISOR_SUGGESTIONS : FREE_SUGGESTIONS;
}
