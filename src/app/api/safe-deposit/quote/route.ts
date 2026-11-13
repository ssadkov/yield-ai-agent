import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { INTENTS_ASSETS, SOLANA_USDC_ASSET, toBaseUnits } from "@/lib/agent/intentsAssets";
import { safeAddress } from "@/lib/agent/solanaSafe";
import { DEMO_MAX_DEPOSIT_USDC } from "@/lib/agent/safePlans";

/**
 * POST /agent/api/safe-deposit/quote {owner, originAsset, amount, refundTo?}
 *
 * Deposit into the owner's Solana Safe from any listed chain or token through NEAR Intents 1-Click.
 * EXACT_INPUT: the payer sends `amount` of the origin asset to a one-time deposit address; 1-Click
 * swaps and bridges it and pays USDC on Solana to the Safe (recipient = the Safe PDA: 1-Click pays
 * into ATA(recipient, USDC), which is the Safe's USDC account). Refunds go to the payer: their
 * Solana wallet for Solana assets, `refundTo` on the origin chain otherwise.
 * The quote is made here so the recipient comes from the owner's key, not from the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_CLICK = "https://1click.chaindefuser.com/v0";
const NO_STORE = { "cache-control": "no-store" };

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let owner: PublicKey;
  try {
    owner = new PublicKey(String(body?.owner ?? ""));
  } catch {
    return refuse(400, "owner must be a Solana address");
  }
  const asset = INTENTS_ASSETS.find((a) => a.id === body?.originAsset);
  if (!asset) return refuse(400, "Unsupported asset");
  const amountIn = toBaseUnits(String(body?.amount ?? ""), asset.decimals);
  if (amountIn === null) return refuse(400, `Enter an amount of ${asset.symbol}, up to ${asset.decimals} decimals`);
  const refundTo =
    asset.chain === "solana" ? owner.toBase58() : typeof body?.refundTo === "string" ? body.refundTo.trim() : "";
  if (!refundTo || refundTo.length > 128) return refuse(400, `Your ${asset.chain} address for refunds is required`);

  const safe = safeAddress(owner).toBase58();
  let json: Record<string, unknown> | null;
  try {
    const response = await fetch(`${ONE_CLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: asset.id,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: SOLANA_USDC_ASSET,
        amount: amountIn.toString(),
        refundTo,
        refundType: "ORIGIN_CHAIN",
        recipient: safe,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !json) return refuse(502, `NEAR Intents: ${String(json?.message ?? response.status)}`);
  } catch {
    return refuse(502, "NEAR Intents is unreachable");
  }

  const q = (json.quote ?? {}) as Record<string, unknown>;
  const echoed = (json.quoteRequest ?? {}) as Record<string, unknown>;
  const depositAddress = typeof q.depositAddress === "string" ? q.depositAddress : "";
  if (
    !depositAddress ||
    echoed.recipient !== safe ||
    echoed.destinationAsset !== SOLANA_USDC_ASSET ||
    echoed.originAsset !== asset.id ||
    echoed.refundTo !== refundTo ||
    String(echoed.amount) !== amountIn.toString()
  ) {
    return refuse(502, "NEAR Intents quote does not match the request");
  }
  // Demo ceiling on what arrives (the address is unused if we refuse here).
  const usdcOut = Number(q.amountOutFormatted);
  if (!Number.isFinite(usdcOut) || usdcOut < 1 || usdcOut > DEMO_MAX_DEPOSIT_USDC) {
    return refuse(400, `Demo limit: 1 to ${DEMO_MAX_DEPOSIT_USDC} USDC arriving (this would be ${q.amountOutFormatted ?? "?"} USDC).`);
  }

  return NextResponse.json(
    {
      depositAddress,
      depositMemo: q.depositMemo ?? null,
      amountIn: amountIn.toString(),
      amountInFormatted: String(q.amountInFormatted ?? ""),
      amountOutFormatted: String(q.amountOutFormatted ?? ""),
      minAmountOutFormatted:
        typeof q.minAmountOut === "string" ? (Number(q.minAmountOut) / 1e6).toFixed(6) : null,
      timeEstimate: typeof q.timeEstimate === "number" ? q.timeEstimate : null,
      deadline: typeof q.deadline === "string" ? q.deadline : null,
      asset,
      refundTo,
      safe,
    },
    { headers: NO_STORE }
  );
}
