import { NextResponse } from "next/server";
import { creditsEnabled } from "@/lib/credits/db";
import { PAYMENT_ASSETS, freeMonthlyUsd, purchaseDestination, visitorTrial, walletSummary } from "@/lib/credits/service";
import { SESSION_HEADER, walletFromSession } from "@/lib/credits/session";

/** GET /agent/api/credits — whether credits are on, and the signed-in wallet's balance and purchases. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!creditsEnabled()) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const base = {
    enabled: true,
    freeMonthlyUsd: freeMonthlyUsd(),
    purchasesEnabled: purchaseDestination() !== null,
    paymentAssets: PAYMENT_ASSETS,
  };
  const wallet = walletFromSession(request.headers.get(SESSION_HEADER));
  if (!wallet) {
    // Free tries left for this visitor without a wallet (null: no trial for them).
    const trial = await visitorTrial(request).catch(() => null);
    return NextResponse.json(
      {
        ...base,
        signedIn: false,
        trial: trial ? { requestsLeft: trial.state.requestsLeft, requestsPerDay: trial.state.requestsPerDay } : null,
      },
      { headers: NO_STORE }
    );
  }
  try {
    const summary = await walletSummary(wallet);
    return NextResponse.json({ ...base, signedIn: true, wallet, ...summary }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { ...base, error: error instanceof Error ? error.message : "Credits unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
