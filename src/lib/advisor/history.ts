import type { ActionCard, ProposedPlan } from "./tools.ts";
import { seedHistoryForMode, type ChatMode } from "./modes.ts";

/** Model transcript rows rebuilt from the UI (no tool-call reconstruction). */
export type RebuiltChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Legacy key — still used for the advisor tab so existing local history survives. */
export const ADVISOR_CHAT_STORAGE_KEY = "yield-agent:advisor-chat-messages";
export const FREE_CHAT_STORAGE_KEY = "yield-agent:free-chat-messages";

const STORAGE_KEY: Record<ChatMode, string> = {
  advisor: ADVISOR_CHAT_STORAGE_KEY,
  free: FREE_CHAT_STORAGE_KEY,
};

/** Cap stored history so localStorage stays small. */
export const ADVISOR_CHAT_MAX_MESSAGES = 40;

/** Persisted / rebuilt chat rows (proof stays in-memory only). */
export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: ProposedPlan;
  actionCard?: ActionCard;
};

function isProposedPlan(value: unknown): value is ProposedPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.strategyId === "string" &&
    typeof plan.amountUsdc === "number" &&
    typeof plan.rationale === "string"
  );
}

function isActionCard(value: unknown): value is ActionCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  if (card.action !== "deposit" && card.action !== "withdraw") return false;
  if (typeof card.amountUsdc !== "number") return false;
  if (card.note !== undefined && typeof card.note !== "string") return false;
  return true;
}

function isStoredMessage(value: unknown): value is StoredChatMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  if (typeof msg.id !== "string") return false;
  if (msg.role !== "user" && msg.role !== "assistant") return false;
  if (typeof msg.content !== "string") return false;
  if (msg.plan !== undefined && !isProposedPlan(msg.plan)) return false;
  if (msg.actionCard !== undefined && !isActionCard(msg.actionCard)) return false;
  return true;
}

function parseStoredMessages(raw: string | null): StoredChatMessage[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isStoredMessage)
    .filter((msg) => msg.content.trim().length > 0 || Boolean(msg.actionCard))
    .slice(-ADVISOR_CHAT_MAX_MESSAGES)
    .map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      plan: msg.plan,
      actionCard: msg.actionCard,
    }));
}

export function loadChatHistory(mode: ChatMode): StoredChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredMessages(window.localStorage.getItem(STORAGE_KEY[mode]));
  } catch {
    return [];
  }
}

/** @deprecated Prefer loadChatHistory("advisor") */
export function loadAdvisorChatHistory(): StoredChatMessage[] {
  return loadChatHistory("advisor");
}

export function saveChatHistory(mode: ChatMode, messages: StoredChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = messages
      .filter((msg) => msg.content.trim().length > 0 || Boolean(msg.actionCard))
      .slice(-ADVISOR_CHAT_MAX_MESSAGES)
      .map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        ...(msg.plan ? { plan: msg.plan } : {}),
        ...(msg.actionCard ? { actionCard: msg.actionCard } : {}),
      }));
    window.localStorage.setItem(STORAGE_KEY[mode], JSON.stringify(trimmed));
  } catch {
    // Quota / private mode — ignore
  }
}

/** @deprecated Prefer saveChatHistory("advisor", messages) */
export function saveAdvisorChatHistory(messages: StoredChatMessage[]): void {
  saveChatHistory("advisor", messages);
}

export function clearChatHistory(mode: ChatMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY[mode]);
  } catch {
    // ignore
  }
}

/** @deprecated Prefer clearChatHistory("advisor") */
export function clearAdvisorChatHistory(): void {
  clearChatHistory("advisor");
}

export { seedHistoryForMode };

/** Rebuild model context from visible UI messages after a reload. */
export function historyFromUiMessages(
  messages: StoredChatMessage[],
  mode: ChatMode = "advisor"
): RebuiltChatMessage[] {
  const history: RebuiltChatMessage[] = [...seedHistoryForMode(mode)];
  for (const message of messages) {
    if (!message.content.trim() && !message.actionCard && !message.plan) continue;
    if (message.role === "user") {
      history.push({ role: "user", content: message.content });
      continue;
    }
    let content = message.content;
    if (message.plan) {
      content += `\n\n[Proposed plan already shown to the user: ${message.plan.amountUsdc} USDC → ${message.plan.strategyId}. Rationale: ${message.plan.rationale}]`;
    }
    if (message.actionCard) {
      content += `\n\n[Action card already shown: ${message.actionCard.action} ${message.actionCard.amountUsdc} USDC]`;
    }
    history.push({ role: "assistant", content: content || "(action card shown)" });
  }
  return history;
}
