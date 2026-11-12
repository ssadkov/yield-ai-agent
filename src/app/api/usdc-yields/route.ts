import { NextResponse } from "next/server";
import { formatUsdcYieldsForPrompt, limitToAppRoutes, loadUsdcYields, type UsdcYieldsResponse } from "@/lib/agent/usdcYields";

/**
 * GET /agent/api/usdc-yields (basePath /agent). On yieldai.app the main app proxies /agent/*
 * here, so the browser and the advisor reach it same-origin.
 *
 * `?format=text` returns the same data as compact plain text for a model's tool result.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
let cache: { at: number; value: UsdcYieldsResponse } | null = null;
let inflight: Promise<UsdcYieldsResponse> | null = null;

export async function GET(request: Request) {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    inflight ??= loadUsdcYields(
      {
        solanaSafeApiOrigin: process.env.SOLANA_SAFE_API_ORIGIN,
        yieldAiApiOrigin: process.env.YIELD_AI_API_ORIGIN,
        includeAptos: process.env.USDC_YIELDS_INCLUDE_APTOS === "1",
      },
      cache?.value ?? null
    ).finally(() => {
      inflight = null;
    });
    cache = { at: Date.now(), value: limitToAppRoutes(await inflight) };
  }
  if (new URL(request.url).searchParams.get("format") === "text") {
    return new NextResponse(formatUsdcYieldsForPrompt(cache.value), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": CACHE_CONTROL },
    });
  }
  return NextResponse.json(cache.value, { headers: { "cache-control": CACHE_CONTROL } });
}
