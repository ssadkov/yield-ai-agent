export const ADVISOR_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_usdc_yields",
      description:
        "Live USDC yields for destinations a Yield AI Solana Safe can deposit into now (Kamino variable APY, Exponent fixed PT). Call for any yield, APR, or where-to-put-USDC question.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_action_card",
      description:
        "Show an interactive deposit/withdraw card in the chat with a prefilled USDC amount the user can edit. Call whenever the user names a dollar/USDC amount and wants to put money in, take money out, allocate, invest, or withdraw. Infer action from intent: deposit for invest/put/allocate; withdraw for withdraw/cash out/exit.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["deposit", "withdraw"],
            description: "deposit = put USDC in; withdraw = take USDC out",
          },
          amountUsdc: {
            type: "number",
            description: "USDC amount mentioned by the user (or a sensible default from context)",
          },
          note: {
            type: "string",
            description: "Optional one-line hint under the controls",
          },
        },
        required: ["action", "amountUsdc"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_plan",
      description:
        "Propose a deposit allocation plan for the owner to review and sign. Never execute it yourself. Also triggers a deposit action card with the same amount.",
      parameters: {
        type: "object",
        properties: {
          strategyId: {
            type: "string",
            description: "Yield row id, e.g. solana:kamino_usdc or solana:exponent_onyc_10jan27",
          },
          amountUsdc: { type: "number", description: "USDC amount to allocate" },
          rationale: { type: "string", description: "Short reason for the owner" },
        },
        required: ["strategyId", "amountUsdc", "rationale"],
        additionalProperties: false,
      },
    },
  },
];

const ALLOWED_STRATEGY_IDS = new Set(["solana:kamino_usdc", "solana:exponent_onyc_10jan27"]);

export type ProposedPlan = {
  strategyId: string;
  amountUsdc: number;
  rationale: string;
};

export type ActionCard = {
  action: "deposit" | "withdraw";
  amountUsdc: number;
  note?: string;
  /** Set when the card comes from a validated propose_plan; Kamino plans get a "put into Kamino" step. */
  strategyId?: string;
};

export function validateProposePlan(args: unknown): { ok: true; plan: ProposedPlan } | { ok: false; error: string } {
  if (!args || typeof args !== "object") return { ok: false, error: "Plan must be an object." };
  const record = args as Record<string, unknown>;
  const strategyId = typeof record.strategyId === "string" ? record.strategyId : "";
  const amountUsdc = typeof record.amountUsdc === "number" ? record.amountUsdc : Number(record.amountUsdc);
  const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
  if (!ALLOWED_STRATEGY_IDS.has(strategyId)) {
    return { ok: false, error: `Unknown strategyId: ${strategyId || "(empty)"}` };
  }
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc > 1_000_000) {
    return { ok: false, error: "amountUsdc must be a positive number within limits." };
  }
  if (!rationale) return { ok: false, error: "rationale is required." };
  return { ok: true, plan: { strategyId, amountUsdc, rationale } };
}

export function validateActionCard(args: unknown): { ok: true; card: ActionCard } | { ok: false; error: string } {
  if (!args || typeof args !== "object") return { ok: false, error: "Action card must be an object." };
  const record = args as Record<string, unknown>;
  const action = record.action === "deposit" || record.action === "withdraw" ? record.action : null;
  const amountUsdc = typeof record.amountUsdc === "number" ? record.amountUsdc : Number(record.amountUsdc);
  const note = typeof record.note === "string" ? record.note.trim() : undefined;
  if (!action) return { ok: false, error: "action must be deposit or withdraw." };
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc > 1_000_000) {
    return { ok: false, error: "amountUsdc must be a positive number within limits." };
  }
  return {
    ok: true,
    card: {
      action,
      amountUsdc,
      ...(note ? { note } : {}),
    },
  };
}

export async function runAdvisorTool(name: string, argsJson: string): Promise<string> {
  if (name === "get_usdc_yields") {
    const response = await fetch("/agent/api/usdc-yields?format=text", { cache: "no-store" });
    if (!response.ok) return `get_usdc_yields failed: HTTP ${response.status}`;
    return await response.text();
  }
  if (name === "show_action_card") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson || "{}");
    } catch {
      return JSON.stringify({ ok: false, error: "Invalid JSON arguments." });
    }
    const checked = validateActionCard(parsed);
    if (!checked.ok) return JSON.stringify(checked);
    return JSON.stringify({
      ok: true,
      card: checked.card,
      note: "Card will be shown in the chat UI. Continue with a short textual answer; do not claim money moved.",
    });
  }
  if (name === "propose_plan") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson || "{}");
    } catch {
      return JSON.stringify({ ok: false, error: "Invalid JSON arguments." });
    }
    const checked = validateProposePlan(parsed);
    if (!checked.ok) return JSON.stringify(checked);
    return JSON.stringify({
      ok: true,
      plan: checked.plan,
      note: "Plan validated in the browser. Show it to the owner; do not claim it was executed.",
    });
  }
  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}
