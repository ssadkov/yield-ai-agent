import { NextResponse } from "next/server";
import {
  DEFAULT_POOL_ACCOUNT,
  DEFAULT_PRODUCT_ID,
  readFarmPosition,
  snapshotFromReadings,
  type AiPoolSnapshot,
  type FarmReading,
} from "@/lib/advisor/aiPool";

/**
 * GET /agent/api/ai-pool — how much private inference the Yield AI pool funds right now.
 * The accrual rate comes from two on-chain readings of the farm position; see src/lib/advisor/aiPool.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 5 * 60_000;
const MIN_SPAN_MS = 30_000;
const SECOND_READ_DELAY_MS = 4_000;

let lastReading: FarmReading | null = null;
let cached: { at: number; snapshot: AiPoolSnapshot } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.snapshot, { headers: { "cache-control": "no-store" } });
  }
  const account = process.env.AI_POOL_NEAR_ACCOUNT?.trim() || DEFAULT_POOL_ACCOUNT;
  const productId = process.env.AI_POOL_PRODUCT_ID?.trim() || DEFAULT_PRODUCT_ID;
  try {
    const now = await readFarmPosition(account, productId);
    let first = lastReading && lastReading.position.account_id === account ? lastReading : null;
    let second = now;
    if (!first || now.atMs - first.atMs < MIN_SPAN_MS) {
      first = now;
      await new Promise((resolve) => setTimeout(resolve, SECOND_READ_DELAY_MS));
      second = await readFarmPosition(account, productId);
    }
    lastReading = second;
    const snapshot = snapshotFromReadings(first, second);
    cached = { at: Date.now(), snapshot };
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI pool unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
