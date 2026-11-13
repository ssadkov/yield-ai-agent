/**
 * Performance fees a Solana Safe has already paid to the treasury.
 *
 * The program takes its fee on every Kamino exit and sends it from the Safe to the treasury's USDC
 * account, so the fee is the treasury's USDC gain in each transaction that touches the Safe.
 * Once realized, a fee no longer shows in the Safe's live accrued fee; adding it back keeps the
 * owner's AI budget from yield whole after a withdrawal.
 *
 * The scan is incremental and cached in Neon (`safe_fee_scan`). Chat requests read the cache only;
 * the credits and Safe summary routes advance it with a small time budget.
 */
import { advanceFeeScan, creditsEnabled, getFeeScan } from "./db.ts";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type TokenBalance = { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } };
export type ParsedTx = { meta?: { err?: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null } | null;

/** The treasury's USDC gain in one transaction, in base units (0 for failed or unrelated ones). */
export function treasuryUsdcGain(tx: ParsedTx, treasury: string): bigint {
  const meta = tx?.meta;
  if (!meta || meta.err) return BigInt(0);
  const sum = (balances: TokenBalance[] | undefined) =>
    (balances ?? [])
      .filter((b) => b.owner === treasury && b.mint === USDC_MINT)
      .reduce((total, b) => total + BigInt(b.uiTokenAmount?.amount ?? "0"), BigInt(0));
  const gain = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
  return gain > BigInt(0) ? gain : BigInt(0);
}

const RPC = () => process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const SCAN_EVERY_MS = 60_000;
const MAX_TX_PER_SCAN = 25;
const SCAN_BUDGET_MS = 8_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
  return json.result as T;
}

type Signature = { signature: string; err: unknown };

/** Signatures newer than `until`, oldest first (all of them on the first scan). */
async function newSignatures(safe: string, until: string | null): Promise<Signature[]> {
  const out: Signature[] = [];
  let before: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const batch = await rpc<Signature[]>("getSignaturesForAddress", [
      safe,
      { limit: 1000, ...(until ? { until } : {}), ...(before ? { before } : {}) },
    ]);
    out.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  return out.reverse();
}

/**
 * Realized fees of `safe` in USDC. `scan` reads new transactions first (bounded by a time budget);
 * without it only the cached total is returned. 0 when credits (Neon) are off, and when the owner
 * is the treasury itself (its withdrawals would look like fees).
 */
export async function realizedFeesUsdc(
  input: { safe: string; owner: string; treasury: string },
  options: { scan: boolean }
): Promise<number> {
  if (!creditsEnabled() || input.owner === input.treasury) return 0;
  const cached = await getFeeScan(input.safe);
  const total = (raw: bigint) => Number(raw) / 1e6;
  if (!options.scan || (cached && Date.now() - cached.updatedAt < SCAN_EVERY_MS)) {
    return cached ? total(cached.realizedRaw) : 0;
  }
  const from = cached?.cursor ?? null;
  const started = Date.now();
  const signatures = await newSignatures(input.safe, from);
  let add = BigInt(0);
  let cursor = from;
  for (const item of signatures.slice(0, MAX_TX_PER_SCAN)) {
    if (Date.now() - started > SCAN_BUDGET_MS) break;
    if (!item.err) {
      const tx = await rpc<ParsedTx>("getTransaction", [
        item.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ]);
      add += treasuryUsdcGain(tx, input.treasury);
    }
    cursor = item.signature;
  }
  const applied = await advanceFeeScan(input.safe, from, cursor, add);
  const base = cached?.realizedRaw ?? BigInt(0);
  if (applied) return total(base + add);
  // Another scan advanced it first; its total is the one to trust.
  const latest = await getFeeScan(input.safe);
  return latest ? total(latest.realizedRaw) : total(base);
}
