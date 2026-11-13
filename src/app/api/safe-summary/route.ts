import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { loadSafeSummary } from "@/lib/agent/safeSummary.server";

/** GET /agent/api/safe-summary?owner=<solana address>[&fresh=1] — public on-chain state only. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? "";
  try {
    if (new PublicKey(owner).toBase58() !== owner) throw new Error();
  } catch {
    return NextResponse.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  try {
    const summary = await loadSafeSummary(owner, url.searchParams.get("fresh") === "1", true);
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Safe summary unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
