import { NextResponse } from "next/server";
import { creditsEnabled, insertPurchase } from "@/lib/credits/db";
import { MAX_PURCHASE_USD, MIN_PURCHASE_USD, purchaseAmountUnits } from "@/lib/credits/ledger";
import { ONE_CLICK, PAYMENT_ASSETS, purchaseDestination } from "@/lib/credits/service";
import { SESSION_HEADER, walletFromSession } from "@/lib/credits/session";

/**
 * POST /agent/api/credits/quote {amountUsd, originAsset, refundTo?}
 *
 * Buys advisor credits with any listed token through NEAR Intents 1-Click. The server creates the
 * quote, so the one-time deposit address is bound to the signed-in wallet. EXACT_OUTPUT: we receive
 * exactly `amountUsd` USDC and credit exactly that; the buyer pays whatever the route costs.
 * Refunds go to the buyer: their Solana wallet for Solana assets, `refundTo` for other chains.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!creditsEnabled()) return refuse(404, "Credits are not enabled");
  const destination = purchaseDestination();
  if (!destination) return refuse(503, "Purchases are not configured (CREDITS_RECEIVER)");
  const wallet = walletFromSession(request.headers.get(SESSION_HEADER));
  if (!wallet) return refuse(401, "Sign in with your wallet first");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const amount = purchaseAmountUnits(body?.amountUsd, destination.decimals);
  if (!amount) return refuse(400, `amountUsd must be $${MIN_PURCHASE_USD}..$${MAX_PURCHASE_USD}, to the cent`);
  const amountUsd = amount.usd;
  const asset = PAYMENT_ASSETS.find((a) => a.id === body?.originAsset);
  if (!asset) return refuse(400, "Unsupported payment asset");
  const refundTo = asset.chain === "solana" ? wallet : typeof body?.refundTo === "string" ? body.refundTo.trim() : "";
  if (!refundTo) return refuse(400, `A ${asset.chain} refund address is required`);

  const amountOut = amount.units;
  let quote: Record<string, unknown>;
  try {
    const response = await fetch(`${ONE_CLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry: false,
        swapType: "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: asset.id,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: destination.asset,
        amount: amountOut,
        refundTo,
        refundType: "ORIGIN_CHAIN",
        recipient: destination.recipient,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !json) return refuse(502, `1-Click: ${String(json?.message ?? response.status)}`);
    quote = json;
  } catch {
    return refuse(502, "1-Click unreachable");
  }

  const q = (quote.quote ?? {}) as Record<string, unknown>;
  const echoed = (quote.quoteRequest ?? {}) as Record<string, unknown>;
  const depositAddress = typeof q.depositAddress === "string" ? q.depositAddress : "";
  if (
    !depositAddress ||
    echoed.recipient !== destination.recipient ||
    echoed.destinationAsset !== destination.asset ||
    echoed.originAsset !== asset.id ||
    echoed.refundTo !== refundTo ||
    String(echoed.amount) !== amountOut
  ) {
    return refuse(502, "1-Click quote does not match the request");
  }

  const deadline = typeof q.deadline === "string" ? q.deadline : null;
  await insertPurchase({
    depositAddress,
    wallet,
    amountUsd,
    originAsset: asset.id,
    amountIn: String(q.amountIn ?? ""),
    deadline,
  });
  return NextResponse.json(
    {
      depositAddress,
      depositMemo: q.depositMemo ?? null,
      amountIn: String(q.amountIn ?? ""),
      amountInFormatted: String(q.amountInFormatted ?? ""),
      amountUsd,
      asset,
      refundTo,
      deadline,
      timeEstimate: q.timeEstimate ?? null,
    },
    { headers: NO_STORE }
  );
}
