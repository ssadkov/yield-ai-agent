import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/knowledge";
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
};

export type AdvisorSession = {
  attested: AttestedModel;
  keys: ClientKeys;
  history: ChatMessage[];
};

export async function startAdvisorSession(seedHistory?: ChatMessage[]): Promise<AdvisorSession> {
  const attested = await pickAttestedModel();
  const keys = createSessionKeys();
  const history =
    seedHistory && seedHistory.length > 0
      ? seedHistory
      : [{ role: "system" as const, content: ADVISOR_SYSTEM_PROMPT }];
  return {
    attested,
    keys,
    history,
  };
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAdvisorTurn(options: {
  session: AdvisorSession;
  userText: string;
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
  const { session, userText, onAssistantDelta, onStatus } = options;
  session.history.push({ role: "user", content: userText });

  const inferenceIds: string[] = [];
  const evidence: CompletionEvidence[] = [];
  let plan: ProposedPlan | null = null;
  let actionCard: ActionCard | null = null;
  let finalText = "";

  for (let step = 0; step < 4; step += 1) {
    onStatus?.(step === 0 ? "Thinking…" : "Using tools…");
    const result = await streamChatCompletion({
      attested: session.attested,
      keys: session.keys,
      messages: session.history,
      tools: ADVISOR_TOOLS,
      handlers: {
        onText: (chunk) => {
          finalText += chunk;
          onAssistantDelta?.(finalText.replace(/^\n+/, ""));
        },
      },
    });
    if (result.inferenceId) inferenceIds.push(result.inferenceId);
    if (result.evidence) evidence.push(result.evidence);

    if (result.toolCalls.length === 0) {
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
