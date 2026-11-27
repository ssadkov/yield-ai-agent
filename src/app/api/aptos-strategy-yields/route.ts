import { NextResponse } from "next/server";
import { fetchStrategyYields, type StrategyYieldsSnapshot } from "@/lib/agent/aptosStrategyYields";
import { formatStrategyYieldsForTool } from "@/lib/agent/aptosAgent";

/**
 * GET /agent/api/aptos-strategy-yields (basePath /agent): live APR of the Yield AI agent strategies
 * on Aptos, computed from yieldai.app's public pool, vault, funding and Boost APIs.
 * `?format=text` returns compact text for the advisor's tool result.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
let cache: { at: number; value: StrategyYieldsSnapshot } | null = null;
let inflight: Promise<StrategyYieldsSnapshot> | null = null;

export async function GET(request: Request) {
  // An incomplete answer (a feed was down) is retried after ten seconds, a complete one after a minute.
  if (!cache || Date.now() - cache.at > (cache.value.missing.length ? 10_000 : TTL_MS)) {
    inflight ??= fetchStrategyYields(process.env.YIELD_AI_API_ORIGIN?.trim() || "https://yieldai.app").finally(() => {
      inflight = null;
    });
    cache = { at: Date.now(), value: await inflight };
  }
  const body = { success: true, data: cache.value };
  if (new URL(request.url).searchParams.get("format") === "text") {
    return new NextResponse(formatStrategyYieldsForTool(body), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": CACHE_CONTROL },
    });
  }
  return NextResponse.json(body, { headers: { "cache-control": CACHE_CONTROL } });
}
