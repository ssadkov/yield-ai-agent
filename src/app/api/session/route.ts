import { NextResponse } from "next/server";
import { isAllowedSignInHost, isSolanaAddress, issueChallenge, verifyAptosChallenge, verifyChallenge } from "@/lib/credits/session";
import { canonicalAptosAddress } from "@/lib/credits/aptosSignIn";

/**
 * POST /agent/api/session {wallet, host}                                              → challenge fields
 * POST /agent/api/session {wallet, host, nonce, issuedAt, expiresAt, tag, signature} → session token
 * The browser builds the Sign In With Solana message from the fields. See src/lib/credits/session.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const aptos = body?.chain === "aptos";
  const rawWallet = typeof body?.wallet === "string" ? body.wallet : "";
  const wallet = aptos ? canonicalAptosAddress(rawWallet) ?? "" : rawWallet;
  const host = typeof body?.host === "string" ? body.host.slice(0, 100).toLowerCase() : "";
  if (!(aptos ? wallet : isSolanaAddress(wallet)) || !host) {
    return NextResponse.json({ error: "wallet (Solana or Aptos) and host are required" }, { status: 400, headers: NO_STORE });
  }
  if (!isAllowedSignInHost(host)) {
    return NextResponse.json({ error: "Sign in on yieldai.app" }, { status: 403, headers: NO_STORE });
  }
  try {
    if (typeof body?.signature !== "string") {
      return NextResponse.json(issueChallenge(wallet, host), { headers: NO_STORE });
    }
    const fields = {
      wallet,
      domain: host,
      nonce: String(body.nonce ?? ""),
      issuedAt: Number(body.issuedAt),
      expiresAt: Number(body.expiresAt),
      tag: String(body.tag ?? ""),
      signature: body.signature,
    };
    const result = aptos
      ? await verifyAptosChallenge({ ...fields, fullMessage: String(body.fullMessage ?? ""), publicKey: String(body.publicKey ?? "") })
      : verifyChallenge(fields);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401, headers: NO_STORE });
    return NextResponse.json({ wallet, token: result.token, expiresAt: result.expiresAt }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign-in unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
