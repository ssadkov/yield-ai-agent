import type { ActionCard, ProposedPlan } from "@/lib/advisor/tools";
import type { ChatMessage } from "@/lib/advisor/nearProxy";
import type { UiMessage } from "@/lib/advisor/runTurn";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/knowledge";

export const ADVISOR_CHAT_STORAGE_KEY = "yield-agent:advisor-chat-messages";

/** Cap stored history so localStorage stays small. */
export const ADVISOR_CHAT_MAX_MESSAGES = 40;

type StoredMessage = {
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

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  if (typeof msg.id !== "string") return false;
  if (msg.role !== "user" && msg.role !== "assistant") return false;
  if (typeof msg.content !== "string") return false;
  if (msg.plan !== undefined && !isProposedPlan(msg.plan)) return false;
  if (msg.actionCard !== undefined && !isActionCard(msg.actionCard)) return false;
  return true;
}

export function loadAdvisorChatHistory(): UiMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ADVISOR_CHAT_STORAGE_KEY);
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
  } catch {
    return [];
  }
}

export function saveAdvisorChatHistory(messages: UiMessage[]): void {
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
    window.localStorage.setItem(ADVISOR_CHAT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota / private mode — ignore
  }
}

export function clearAdvisorChatHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ADVISOR_CHAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Rebuild model context from visible UI messages after a reload. */
export function historyFromUiMessages(messages: UiMessage[]): ChatMessage[] {
  const history: ChatMessage[] = [{ role: "system", content: ADVISOR_SYSTEM_PROMPT }];
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
