import { NextResponse } from "next/server";

/**
 * Same-origin proxy to the Solana Safe API (yield-ai-os-sol `web`, `/api/mobile/v1/*`).
 * That API refuses browser origins other than its own, so /agent calls it through here.
 * It only builds unsigned owner transactions and reads public state; the wallet signs and
 * the browser checks every transaction before signing (src/lib/agent/safePlans.ts).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_ORIGIN = "https://yield-ai-solana-mainnet.vercel.app";
const MAX_BODY_BYTES = 2048;

const ROUTES: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "GET", path: /^safes$/ },
  { method: "POST", path: /^safes\/creation-plan$/ },
  { method: "POST", path: /^deposits\/plan$/ },
  { method: "POST", path: /^protocols\/kamino\/deposits\/plan$/ },
  { method: "GET", path: /^transactions\/[1-9A-HJ-NP-Za-km-z]{64,88}$/ },
];

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;
  const path = (parts ?? []).join("/");
  if (!ROUTES.some((route) => route.method === request.method && route.path.test(path))) {
    return refuse(404, "Path not allowed");
  }

  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) return refuse(413, "Request too large");
  }

  const origin = process.env.SOLANA_SAFE_API_ORIGIN?.trim() || DEFAULT_ORIGIN;
  const search = new URL(request.url).search;
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/api/mobile/v1/${path}${search}`, {
      method: request.method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return refuse(502, "Solana Safe API unreachable");
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
