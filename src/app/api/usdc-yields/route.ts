import { NextResponse } from "next/server";
import { loadUsdcYields, type UsdcYieldsResponse } from "@/lib/agent/usdcYields";

/**
 * GET /agent/api/usdc-yields (basePath /agent). On yieldai.app the main app proxies /agent/*
 * here, so the browser and the advisor reach it same-origin.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
let cache: { at: number; value: UsdcYieldsResponse } | null = null;
let inflight: Promise<UsdcYieldsResponse> | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    inflight ??= loadUsdcYields(
      {
        solanaSafeApiOrigin: process.env.SOLANA_SAFE_API_ORIGIN,
        yieldAiApiOrigin: process.env.YIELD_AI_API_ORIGIN,
      },
      cache?.value ?? null
    ).finally(() => {
      inflight = null;
    });
    cache = { at: Date.now(), value: await inflight };
  }
  return NextResponse.json(cache.value, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
