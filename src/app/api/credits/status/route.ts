import { NextResponse } from "next/server";
import { creditsEnabled, getPurchase, updatePurchaseStatus } from "@/lib/credits/db";
import { ONE_CLICK } from "@/lib/credits/service";
import { SESSION_HEADER, walletFromSession } from "@/lib/credits/session";

/**
 * GET /agent/api/credits/status?depositAddress=… — 1-Click status of one of the wallet's purchases.
 * A purchase is credited once, when 1-Click reports SUCCESS.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!creditsEnabled()) return NextResponse.json({ error: "Credits are not enabled" }, { status: 404, headers: NO_STORE });
  const wallet = walletFromSession(request.headers.get(SESSION_HEADER));
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first" }, { status: 401, headers: NO_STORE });
  const depositAddress = new URL(request.url).searchParams.get("depositAddress") ?? "";
  const purchase = depositAddress ? await getPurchase(depositAddress) : null;
  if (!purchase || purchase.wallet !== wallet) {
    return NextResponse.json({ error: "Unknown purchase" }, { status: 404, headers: NO_STORE });
  }
  if (purchase.credited) return NextResponse.json({ purchase }, { headers: NO_STORE });

  try {
    const response = await fetch(`${ONE_CLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => null)) as { status?: string } | null;
    if (!response.ok || !json?.status) return NextResponse.json({ purchase }, { headers: NO_STORE });
    const updated = await updatePurchaseStatus(depositAddress, json.status);
    return NextResponse.json({ purchase: updated ?? purchase }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ purchase }, { headers: NO_STORE });
  }
}
