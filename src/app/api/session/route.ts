import { NextResponse } from "next/server";
import { isSolanaAddress, issueChallenge, verifyChallenge } from "@/lib/credits/session";

/**
 * POST /agent/api/session {wallet, host}                       → challenge to sign
 * POST /agent/api/session {wallet, host, nonce, expiresAt, tag, signature} → session token
 * See src/lib/credits/session.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const host = typeof body?.host === "string" ? body.host.slice(0, 100) : "";
  if (!isSolanaAddress(wallet) || !host) {
    return NextResponse.json({ error: "wallet (Solana) and host are required" }, { status: 400, headers: NO_STORE });
  }
  try {
    if (typeof body?.signature !== "string") {
      return NextResponse.json(issueChallenge(wallet, host), { headers: NO_STORE });
    }
    const result = verifyChallenge({
      wallet,
      host,
      nonce: String(body.nonce ?? ""),
      expiresAt: Number(body.expiresAt),
      tag: String(body.tag ?? ""),
      signature: body.signature,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401, headers: NO_STORE });
    return NextResponse.json({ wallet, token: result.token, expiresAt: result.expiresAt }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign-in unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
