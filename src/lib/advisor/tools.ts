import { PublicKey } from "@solana/web3.js";
import { formatTxSummary, parseSignatureInput, type TxSummary } from "../agent/explainTx.ts";
import { safeAddress } from "../agent/solanaSafe.ts";
import { fetchAptosAgent, formatAptosAgentForTool } from "../agent/aptosAgent.ts";
import { fetchSafeHistory, fetchSafePaused, formatSafeHistoryForTool, validateAptosAction } from "../agent/aptosSafeOps.ts";

export const ADVISOR_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_my_account",
      description:
        "The user's connected Solana wallet and Yield AI Safe: wallet USDC and SOL, Safe USDC idle and in Kamino, what it earned, and the AI budget its yield pays for. Call for any question about the user's balance, wallet, account or what to do with their money.",
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
      name: "get_my_aptos_agents",
      description:
        "The user's Yield AI agents on Aptos (yieldai.app): each AI agent Safe with its strategy and USD balance, and their Yield AI Boost season state (eligible or not, shortfall to the minimum, Grain accrued, USDC paid). Call for any question about their Aptos agents, Aptos balance, Boost, Grain or payouts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_aptos_agent_history",
      description:
        "History and earnings of the user's Aptos agents, per Safe: running or paused, deposited, withdrawn, Boost paid into the Safe, earned in $ and APR on average capital, and the last deposits/withdrawals. Call when the user asks how much they earned, their history, PnL, or whether an agent is running or paused.",
      parameters: {
        type: "object",
        properties: {
          safe: { type: "string", description: "Optional: one Safe, as get_my_aptos_agents printed it. Omit for all." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_aptos_action",
      description:
        "Show a card in the chat that the owner signs in their Aptos wallet (gas is sponsored): pause or resume one of their Aptos agents, or withdraw idle USDC, USD1 or USDt from its Safe to their wallet. Funds inside positions (loops, LP, delta-neutral) cannot be withdrawn here; that is on yieldai.app. Never say the action happened; the user signs it.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["pause", "resume", "withdraw"] },
          safe: { type: "string", description: "The Safe, as get_my_aptos_agents printed it" },
          token: { type: "string", enum: ["USDC", "USD1", "USDt"], description: "withdraw only; default USDC" },
          amount: { type: "number", description: "withdraw only; omit for everything idle" },
        },
        required: ["action", "safe"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_aptos_strategy_yields",
      description:
        "Live APR of the Yield AI agent strategies on Aptos (Stablecoin compound, Echelon stable loop, Hyperion CLMM LP, Decibel delta-neutral): protocol APR, Boost APR and total per variant, with each strategy's risk. Call for any question about Aptos agent yields or which Aptos strategy to pick.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
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
      name: "explain_transaction",
      description:
        "Read one Solana mainnet transaction the user pasted (a signature, or a solscan.io/tx link): who signed and paid the fee, which programs ran, whose token and SOL balances changed, and whether it touched the user's Yield AI Safe. Call whenever the user's message contains a Solana transaction signature or an explorer link to one.",
      parameters: {
        type: "object",
        properties: {
          signature: {
            type: "string",
            description: "The signature or explorer link, copied exactly as the user pasted it",
          },
        },
        required: ["signature"],
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
            description: "Yield row id with agentExecutable true; today only solana:kamino_usdc",
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

// Exponent is listed for comparison only: this app has no Exponent deposit step yet.
const ALLOWED_STRATEGY_IDS = new Set(["solana:kamino_usdc"]);

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

/** The connected wallet, set by the chat; the account tool reads it. */
let advisorWallet: string | null = null;

export function setAdvisorWallet(address: string | null) {
  advisorWallet = address;
}

/** The Aptos account Boost counts for this user (native Aptos wallet, or the one derived from Solana). */
let advisorAptosOwner: string | null = null;

export function setAdvisorAptosOwner(owner: string | null) {
  advisorAptosOwner = owner;
}

async function myAptosAgents(): Promise<string> {
  if (!advisorAptosOwner) {
    return "No Aptos account known. Ask the user to connect a wallet (Connect, top right); an Aptos wallet such as Petra, or the Solana wallet they use on yieldai.app.";
  }
  try {
    return formatAptosAgentForTool(await fetchAptosAgent(advisorAptosOwner));
  } catch (error) {
    return `get_my_aptos_agents failed: ${error instanceof Error ? error.message : "unavailable"}`;
  }
}

async function aptosHistory(argsJson: string): Promise<string> {
  if (!advisorAptosOwner) return "No Aptos account known. Ask the user to connect a wallet.";
  let ref = "";
  try {
    ref = String((JSON.parse(argsJson || "{}") as { safe?: unknown }).safe ?? "");
  } catch {
    ref = "";
  }
  let state: Awaited<ReturnType<typeof fetchAptosAgent>>;
  try {
    state = await fetchAptosAgent(advisorAptosOwner);
  } catch (error) {
    return `get_aptos_agent_history failed: ${error instanceof Error ? error.message : "unavailable"}`;
  }
  if (!state || state.safes.length === 0) return formatAptosAgentForTool(state);
  let safes = state.safes;
  if (ref) {
    const picked = validateAptosAction({ action: "pause", safe: ref }, safes);
    if (!picked.ok) return picked.error;
    safes = safes.filter((s) => s.safe === picked.card.safe);
  }
  const parts = await Promise.all(
    safes.map(async (s) => {
      const [history, paused] = await Promise.all([fetchSafeHistory(s.safe, s.balanceUsd).catch(() => null), fetchSafePaused(s.safe)]);
      return formatSafeHistoryForTool(s.label, s.safe, s.balanceUsd, history, paused);
    })
  );
  const b = state.boost;
  parts.push(
    `Boost for this owner: $${b.paidToDateUsd.toFixed(2)} paid in USDC to date, ${b.grainTotal.toFixed(2)} Grain accrued, last payout ${b.lastPayoutAt?.slice(0, 10) ?? "none yet"}. Value now is the Boost API's balance; earnings are value now minus net deposits.`
  );
  return parts.join("\n\n");
}

async function proposeAptosAction(argsJson: string): Promise<string> {
  if (!advisorAptosOwner) return JSON.stringify({ ok: false, error: "No Aptos account connected." });
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson || "{}");
  } catch {
    return JSON.stringify({ ok: false, error: "Invalid JSON arguments." });
  }
  const state = await fetchAptosAgent(advisorAptosOwner).catch(() => null);
  const checked = validateAptosAction(parsed, state?.safes ?? []);
  if (!checked.ok) return JSON.stringify(checked);
  return JSON.stringify({
    ok: true,
    card: checked.card,
    note: "The card is shown in the chat; the owner signs it in their wallet. Do not claim it happened.",
  });
}

async function aptosStrategyYields(): Promise<string> {
  const response = await fetch("/agent/api/aptos-strategy-yields?format=text", { cache: "no-store" });
  if (!response.ok) return `get_aptos_strategy_yields failed: HTTP ${response.status}. Do not quote APRs; they are shown on yieldai.app (AI agent → Create).`;
  return await response.text();
}

type AccountSummary = {
  exists: boolean;
  safe: string | null;
  walletUsdc: number;
  walletSol: number;
  idleUsdc: number;
  kamino: { valueUsdc: number; principalUsdc: number; gainUsdc: number };
  performanceFeeBps: number;
  aiBudgetUsdc?: number;
};

const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const usdcText = (n: number) => String(Number(n.toFixed(6)));

async function myAccount(): Promise<string> {
  if (!advisorWallet) {
    return advisorAptosOwner
      ? "No Solana wallet connected, so there is no Solana Safe to show. For the user's Aptos agents and Boost call get_my_aptos_agents."
      : "No wallet connected. Ask the user to connect a wallet (Connect, top right) to see their balance.";
  }
  const response = await fetch(`/agent/api/safe-summary?owner=${encodeURIComponent(advisorWallet)}`, { cache: "no-store" });
  if (!response.ok) return `get_my_account failed: HTTP ${response.status}`;
  const s = (await response.json()) as AccountSummary;
  return [
    `Wallet ${shortAddress(advisorWallet)}: ${usdcText(s.walletUsdc)} USDC, ${s.walletSol.toFixed(4)} SOL (Solana).`,
    s.exists && s.safe
      ? `Yield AI Safe ${shortAddress(s.safe)}: ${usdcText(s.kamino.valueUsdc)} USDC in Kamino (deposited ${usdcText(s.kamino.principalUsdc)}, earned ${usdcText(s.kamino.gainUsdc)}), ${usdcText(s.idleUsdc)} USDC idle (not earning).`
      : "No Yield AI Safe yet: the first deposit from the wallet creates it (two signatures: create, then Kamino).",
    `Performance fee: ${s.performanceFeeBps / 100}% of the gain; it is the user's AI budget from yield, so far $${usdcText(s.aiBudgetUsdc ?? 0)}.`,
    "Actions are on the Earn card: Deposit (from this wallet, or any chain or token via NEAR Intents), Put it to work (idle → Kamino), Withdraw.",
  ].join("\n");
}

/**
 * One transaction, fetched by this app's server from a Solana RPC node and summarized there
 * (src/lib/agent/explainTx.ts). Only the signature is sent. "Your wallet" and "your Safe" are marked
 * here in the browser, so the server is not told whose question it is.
 */
async function explainTransaction(argsJson: string, userText: string): Promise<string> {
  let fromModel: unknown;
  try {
    fromModel = (JSON.parse(argsJson || "{}") as { signature?: unknown }).signature;
  } catch {
    fromModel = null;
  }
  // What the user pasted wins over the model's copy of it: a model can drop a character of 88.
  const pasted = parseSignatureInput(userText);
  const parsed = pasted.ok ? pasted : parseSignatureInput(fromModel);
  if (!parsed.ok) return `explain_transaction: ${parsed.error}`;
  const response = await fetch(`/agent/api/explain-tx?signature=${parsed.signature}`, { cache: "no-store" });
  if (!response.ok) {
    const refusal = await response
      .json()
      .then((body: { error?: unknown }) => (typeof body.error === "string" ? body.error : null))
      .catch(() => null);
    return `explain_transaction failed: ${refusal ?? `HTTP ${response.status}`}`;
  }
  const summary = (await response.json()) as TxSummary;
  let safe: string | null = null;
  if (advisorWallet) {
    try {
      safe = safeAddress(new PublicKey(advisorWallet)).toBase58();
    } catch {
      safe = null;
    }
  }
  return formatTxSummary(summary, { wallet: advisorWallet, safe });
}

/** `userText` is the user's latest message; only `explain_transaction` reads it. */
export async function runAdvisorTool(name: string, argsJson: string, userText = ""): Promise<string> {
  if (name === "get_my_account") return myAccount();
  if (name === "get_my_aptos_agents") return myAptosAgents();
  if (name === "get_aptos_strategy_yields") return aptosStrategyYields();
  if (name === "get_aptos_agent_history") return aptosHistory(argsJson);
  if (name === "propose_aptos_action") return proposeAptosAction(argsJson);
  if (name === "explain_transaction") return explainTransaction(argsJson, userText);
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
