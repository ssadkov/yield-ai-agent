import { ADVISOR_FALLBACK_MODEL, DEFAULT_ADVISOR_MODEL, type AdvisorModel } from "@/lib/advisor/models";
import { seedHistoryForMode, type ChatMode } from "@/lib/advisor/modes";
import {
  createSessionKeys,
  pickAttestedModel,
  streamChatCompletion,
  type AnswerProof,
  type AttestedModel,
  type ChatMessage,
  type CompletionEvidence,
} from "@/lib/advisor/nearProxy";
import type { ClientKeys } from "@/lib/advisor/e2ee";
import {
  ADVISOR_TOOLS,
  runAdvisorTool,
  validateActionCard,
  validateProposePlan,
  type ActionCard,
  type ProposedPlan,
} from "@/lib/advisor/tools";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: ProposedPlan;
  actionCard?: ActionCard;
  /** Response-signature check for this answer; checked in this browser, not restored from history. */
  proof?: AnswerProof;
  /** Pictures the user attached (data URLs); kept in memory only, not in saved history. */
  images?: string[];
};

export type AdvisorSession = {
  attested: AttestedModel;
  keys: ClientKeys;
  history: ChatMessage[];
  mode: ChatMode;
};

export async function startAdvisorSession(
  seedHistory?: ChatMessage[],
  model: AdvisorModel = DEFAULT_ADVISOR_MODEL,
  mode: ChatMode = "advisor"
): Promise<AdvisorSession> {
  // The advisor may fall back to a second attested model; Open chat uses exactly what was picked.
  const attested = await pickAttestedModel(mode === "advisor" ? [DEFAULT_ADVISOR_MODEL, ADVISOR_FALLBACK_MODEL] : [model]);
  const keys = createSessionKeys();
  const history = seedHistory !== undefined ? seedHistory : seedHistoryForMode(mode);
  return {
    attested,
    keys,
    history,
    mode,
  };
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAdvisorTurn(options: {
  session: AdvisorSession;
  userText: string;
  /** Pictures attached to this message, as data URLs (already downscaled by the browser). */
  images?: string[];
  onAssistantDelta?: (text: string) => void;
  onStatus?: (status: string) => void;
}): Promise<{
  assistantText: string;
  plan: ProposedPlan | null;
  actionCard: ActionCard | null;
  model: string;
  /** NEAR AI `inference-id` of every completion in this turn, for cost metering. */
  inferenceIds: string[];
  /** Exact bytes of every completion in this turn, for the response-signature check. */
  evidence: CompletionEvidence[];
}> {
  const { session, userText, images, onAssistantDelta, onStatus } = options;
  session.history.push(
    images && images.length > 0
      ? {
          role: "user",
          content: [
            ...(userText ? [{ type: "text" as const, text: userText }] : []),
            ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ],
        }
      : { role: "user", content: userText }
  );

  const tools = session.mode === "advisor" ? ADVISOR_TOOLS : undefined;
  const maxSteps = session.mode === "advisor" ? 4 : 1;

  const inferenceIds: string[] = [];
  const evidence: CompletionEvidence[] = [];
  let plan: ProposedPlan | null = null;
  let actionCard: ActionCard | null = null;
  let finalText = "";

  for (let step = 0; step < maxSteps; step += 1) {
    onStatus?.(step === 0 ? "Thinking…" : "Using tools…");
    const result = await streamChatCompletion({
      attested: session.attested,
      keys: session.keys,
      messages: session.history,
      tools,
      handlers: {
        onText: (chunk) => {
          finalText += chunk;
          onAssistantDelta?.(finalText.replace(/^\n+/, ""));
        },
      },
    });
    if (result.inferenceId) inferenceIds.push(result.inferenceId);
    if (result.evidence) evidence.push(result.evidence);

    if (result.toolCalls.length === 0 || session.mode === "free") {
      finalText = result.text || finalText;
      session.history.push({ role: "assistant", content: finalText });
      break;
    }

    session.history.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      })),
    });

    for (const tc of result.toolCalls) {
      onStatus?.(`Tool: ${tc.name}`);
      const toolResult = await runAdvisorTool(tc.name, tc.arguments || "{}");
      if (tc.name === "propose_plan") {
        try {
          const parsed = JSON.parse(toolResult) as { ok?: boolean; plan?: ProposedPlan };
          if (parsed.ok && parsed.plan) {
            const checked = validateProposePlan(parsed.plan);
            if (checked.ok) {
              plan = checked.plan;
              if (!actionCard) {
                actionCard = { action: "deposit", amountUsdc: checked.plan.amountUsdc, note: checked.plan.rationale };
              }
              actionCard = { ...actionCard, strategyId: checked.plan.strategyId };
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (tc.name === "show_action_card") {
        try {
          const parsed = JSON.parse(toolResult) as { ok?: boolean; card?: ActionCard };
          if (parsed.ok && parsed.card) {
            const checked = validateActionCard(parsed.card);
            if (checked.ok) actionCard = checked.card;
          }
        } catch {
          /* ignore */
        }
      }
      session.history.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });
    }
    finalText = "";
  }

  return {
    assistantText: finalText.replace(/^\n+/, "") || "I could not produce an answer.",
    plan,
    actionCard,
    model: session.attested.model,
    inferenceIds,
    evidence,
  };
}

export function makeUiMessage(
  role: "user" | "assistant",
  content: string,
  extras?: { plan?: ProposedPlan; actionCard?: ActionCard }
): UiMessage {
  return { id: id(), role, content, plan: extras?.plan, actionCard: extras?.actionCard };
}
