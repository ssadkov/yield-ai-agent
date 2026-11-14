import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createRateLimiter, isSignature, summarizeTransaction, type RpcTransaction, type TxSummary } from "@/lib/agent/explainTx";
import { safeAddress } from "@/lib/agent/solanaSafe";
import { clientIp } from "@/lib/credits/trial";

/**
 * GET /agent/api/explain-tx?signature=<solana signature>
 *
 * Public chain data for the advisor's `explain_transaction` tool: one mainnet transaction, reduced
 * to a short summary (src/lib/agent/explainTx.ts). The only input is the signature. The caller's
 * wallet is not sent: the browser marks "your wallet" and "your Safe" itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const RPC = () => process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

// Per serverless instance, like the NEAR AI proxy.
const rateLimited = createRateLimiter(20, 60_000);

// A confirmed transaction does not change, so summaries are kept for a while.
const CACHE_MAX = 200;
const cache = new Map<string, TxSummary>();

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function safeOf(owner: string): string | null {
  try {
    return safeAddress(new PublicKey(owner)).toBase58();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (rateLimited(clientIp(request) ?? "unknown")) return refuse(429, "Rate limit exceeded");

  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "signature") return refuse(400, `Unexpected parameter: ${key}`);
  }
  const signature = params.get("signature");
  if (!isSignature(signature)) return refuse(400, "signature must be a Solana transaction signature");

  const hit = cache.get(signature);
  if (hit) return NextResponse.json(hit, { headers: { "cache-control": "no-store" } });

  let tx: RpcTransaction;
  try {
    const response = await fetch(RPC(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return refuse(502, `Solana RPC answered HTTP ${response.status}`);
    const json = (await response.json()) as { result?: RpcTransaction; error?: unknown };
    if (json.error) return refuse(502, "Solana RPC could not read this transaction");
    tx = json.result ?? null;
  } catch {
    return refuse(502, "Solana RPC is not answering");
  }
  if (!tx) return refuse(404, "Transaction not found on Solana mainnet. It may be too new, or the signature is wrong.");

  const summary = summarizeTransaction(signature, tx, safeOf);
  if (!summary) return refuse(502, "Solana RPC returned a transaction this app cannot read");

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(signature, summary);
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}
