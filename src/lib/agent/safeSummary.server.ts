/**
 * Server-side reads behind `GET /agent/api/safe-summary` and the AI budget from yield:
 * Solana Safe API (state, Kamino position), Kamino's vault metrics (USDC per share) and the
 * Safe program's config account (performance fee). Cached per owner for a minute.
 */
import { PublicKey } from "@solana/web3.js";
import { KAMINO_USDC_VAULT, summarizeSafe, type SafeSummary } from "./safeSummary.ts";
import { realizedFeesUsdc } from "../credits/realizedFees.ts";

const SAFE_API = () =>
  `${process.env.SOLANA_SAFE_API_ORIGIN?.trim() || "https://yield-ai-solana-mainnet.vercel.app"}/api/mobile/v1`;
const SAFE_PROGRAM = new PublicKey("yie1Jjq6y3rjsiGkgMYnwTveSgpSrSh4n41JHRNyBih");
const RPC = () => process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const CACHE_MS = 60_000;

const cache = new Map<string, { at: number; value: SafeSummary }>();
let shareCache: { at: number; tokensPerShare: number } | null = null;
let feeCache: { at: number; bps: number; treasury: string } | null = null;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${new URL(url).host} HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function tokensPerShare(): Promise<number> {
  if (shareCache && Date.now() - shareCache.at < 5 * 60_000) return shareCache.tokensPerShare;
  const metrics = await json<{ tokensPerShare?: string }>(`https://api.kamino.finance/kvaults/${KAMINO_USDC_VAULT}/metrics`);
  const value = Number(metrics.tokensPerShare);
  if (!(value > 0)) throw new Error("Kamino share price unavailable");
  shareCache = { at: Date.now(), tokensPerShare: value };
  return value;
}

/** The Safe program's config: performance fee and treasury. */
async function safeConfig(): Promise<{ bps: number; treasury: string }> {
  if (feeCache && Date.now() - feeCache.at < 10 * 60_000) return feeCache;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], SAFE_PROGRAM);
  const result = await json<{ result?: { value?: { data?: [string, string]; owner?: string } } }>(RPC(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [config.toBase58(), { encoding: "base64" }] }),
  });
  const value = result.result?.value;
  if (!value?.data || value.owner !== SAFE_PROGRAM.toBase58()) throw new Error("Safe config unavailable");
  const data = Buffer.from(value.data[0], "base64");
  feeCache = { at: Date.now(), bps: data.readUInt16LE(72), treasury: new PublicKey(data.subarray(40, 72)).toBase58() };
  return feeCache;
}

/**
 * `scanFees` also reads the Safe's new transactions for realized fees (a few seconds at most);
 * without it the cached realized total is used, which is what chat requests need.
 */
export async function loadSafeSummary(owner: string, fresh = false, scanFees = false): Promise<SafeSummary> {
  const hit = cache.get(owner);
  if (!fresh && !scanFees && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const q = `ownerType=solana&address=${encodeURIComponent(owner)}&cluster=mainnet`;
  const state = await json<Parameters<typeof summarizeSafe>[0]["state"]>(`${SAFE_API()}/safes?${q}`);
  const [position, perShare, config] = await Promise.all([
    state.exists
      ? json<{ sharesRaw?: string; sharesDecimals?: number; principalUsdc?: string }>(`${SAFE_API()}/protocols/kamino/position?${q}`)
      : Promise.resolve(null),
    tokensPerShare(),
    safeConfig(),
  ]);
  const realized =
    state.exists && state.safe
      ? await realizedFeesUsdc({ safe: state.safe, owner, treasury: config.treasury }, { scan: scanFees }).catch(
          () => hit?.value.realizedFeeUsdc ?? 0
        )
      : 0;
  const value = summarizeSafe({
    owner,
    state,
    position,
    tokensPerShare: perShare,
    performanceFeeBps: config.bps,
    realizedFeeUsdc: realized,
  });
  cache.set(owner, { at: Date.now(), value });
  return value;
}
