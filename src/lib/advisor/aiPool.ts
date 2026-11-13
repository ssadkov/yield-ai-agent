/**
 * The AI pool that pays for advisor inference: NEAR staked through NEAR AI "Staking for Inference"
 * (`stake.dao` farm on validator `nearai.pool.near`). Read straight from NEAR mainnet; no NEAR AI
 * dashboard session is needed.
 *
 * `stake.dao.get_farm_position` reports reward units with 18 decimals. Measured 2026-11-11:
 * 43 NEAR accrued 843,929 units per 30 days while the NEAR AI dashboard showed $0.86/month, so one
 * unit is about one micro-dollar of credits. `CREDIT_USD_PER_UNIT` holds that calibration; re-check
 * it against the dashboard if the farm configuration changes.
 */

export const NEAR_RPC = "https://rpc.mainnet.near.org";
export const FARM_CONTRACT = "stake.dao";
export const DEFAULT_POOL_ACCOUNT = "sadkov.near";
export const DEFAULT_PRODUCT_ID = "prod_33Kp14MGUJa2QA";
export const CREDIT_USD_PER_UNIT = 1e-6;
/** Typical advisor request on z-ai/glm-5.3-flash (~8k tokens in, ~500 out), measured 2026-11-07. */
export const TYPICAL_REQUEST_USD = 0.001;
/** Output tokens of the advisor model (GLM 5.3 Flash, $0.50 per 1M on 2026-11-12) per dollar. */
export const TOKENS_PER_USD = 2_000_000;

const UNIT_SCALE = BigInt(10) ** BigInt(18);
const YOCTO = BigInt(10) ** BigInt(24);
const SECONDS_PER_MONTH = 30 * 24 * 3600;

export type FarmPosition = {
  account_id: string;
  validator_id: string;
  staked_near_amount: string;
  pending_reward_units: string;
  total_earned_reward_units: string;
  status: string;
};

export type FarmReading = { position: FarmPosition; atMs: number };

export type AiPoolSnapshot = {
  account: string;
  validator: string;
  stakedNear: number;
  status: string;
  earnedUsd: number;
  usdPerMonth: number;
  requestsPerMonth: number;
  measuredOverSeconds: number;
  measuredAt: string;
};

/** Fixed-point units (18 decimals) to a plain number of reward units. */
export function unitsToNumber(raw: string): number {
  const value = BigInt(raw);
  return Number(value / UNIT_SCALE) + Number(value % UNIT_SCALE) / 1e18;
}

export function yoctoToNear(raw: string): number {
  const value = BigInt(raw);
  return Number(value / YOCTO) + Number(value % YOCTO) / 1e24;
}

/** Turn two readings of the same position into a snapshot. */
export function snapshotFromReadings(first: FarmReading, second: FarmReading): AiPoolSnapshot {
  const seconds = (second.atMs - first.atMs) / 1000;
  if (!(seconds > 0)) throw new Error("Readings must be in time order");
  const deltaUnits =
    unitsToNumber(second.position.total_earned_reward_units) - unitsToNumber(first.position.total_earned_reward_units);
  const usdPerMonth = Math.max(0, (deltaUnits / seconds) * SECONDS_PER_MONTH * CREDIT_USD_PER_UNIT);
  return {
    account: second.position.account_id,
    validator: second.position.validator_id,
    stakedNear: yoctoToNear(second.position.staked_near_amount),
    status: second.position.status,
    earnedUsd: unitsToNumber(second.position.total_earned_reward_units) * CREDIT_USD_PER_UNIT,
    usdPerMonth,
    requestsPerMonth: Math.floor(usdPerMonth / TYPICAL_REQUEST_USD),
    measuredOverSeconds: Math.round(seconds),
    measuredAt: new Date(second.atMs).toISOString(),
  };
}

export async function readFarmPosition(
  account: string,
  productId: string,
  fetcher: typeof fetch = fetch
): Promise<FarmReading> {
  const args = Buffer.from(JSON.stringify({ account_id: account, product_id: productId })).toString("base64");
  const response = await fetcher(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ai-pool",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: FARM_CONTRACT,
        method_name: "get_farm_position",
        args_base64: args,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json()) as { result?: { result?: number[] }; error?: unknown };
  if (!json.result?.result) throw new Error(`NEAR RPC: ${JSON.stringify(json.error ?? json).slice(0, 160)}`);
  const position = JSON.parse(Buffer.from(json.result.result).toString("utf8")) as FarmPosition | null;
  if (!position) throw new Error(`No farm position for ${account}`);
  return { position, atMs: Date.now() };
}
