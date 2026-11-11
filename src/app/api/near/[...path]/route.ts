import { NextResponse, after } from "next/server";
import { usageFromSse } from "@/lib/advisor/usage";
import {
  checkAttestationQuery,
  checkChatBody,
  checkChatHeaders,
  checkSignatureQuery,
  resolveProxyRoute,
} from "@/lib/advisor/proxyPolicy";
import { creditsEnabled, recordUsage, setUsageTokens } from "@/lib/credits/db";
import { estimateRequestUsd } from "@/lib/credits/ledger";
import { walletBalance } from "@/lib/credits/service";
import { SESSION_HEADER, walletFromSession } from "@/lib/credits/session";

/**
 * Blind proxy to NEAR AI Cloud. Adds our API key; does not log request/response bodies.
 * Browser talks to /agent/api/near/v1/... (basePath /agent).
 * Only E2EE chat to our advisor models, their attestation reports and response signatures
 * pass (src/lib/advisor/proxyPolicy.ts); everything else is refused so the key cannot be
 * spent on other models or plaintext prompts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://cloud-api.near.ai";

const PASS_HEADERS = [
  "content-type",
  "accept",
  "x-signing-algo",
  "x-client-pub-key",
  "x-model-pub-key",
  "x-encryption-version",
  "x-encrypt-all-fields",
  "x-no-aliasing",
] as const;

// Per serverless instance. The key's spend_limit in the NEAR AI dashboard is the hard cap.
const hits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;
const HITS_MAX_ENTRIES = 10_000;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now >= row.resetAt) {
    if (hits.size >= HITS_MAX_ENTRIES) hits.clear();
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  row.count += 1;
  return row.count > RATE_LIMIT;
}

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Read a copy of the completion stream and store its token counts. Only the final `usage` chunk
 * is parsed; message fields stay ciphertext and are never decoded or logged.
 */
async function meterTokens(stream: ReadableStream<Uint8Array>, inferenceId: string): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Keep only the end of the stream: the usage chunk is last.
      tail = (tail + decoder.decode(value, { stream: true })).slice(-4096);
    }
    const usage = usageFromSse(tail);
    if (usage) await setUsageTokens(inferenceId, usage);
  } catch {
    /* metering is best effort; the dollar cost still comes from NEAR AI billing */
  }
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const key = process.env.NEAR_AI_API_KEY?.trim();
  if (!key) return refuse(503, "NEAR_AI_API_KEY is not configured");

  if (rateLimited(clientIp(request))) return refuse(429, "Rate limit exceeded");

  const { path: parts } = await context.params;
  const route = resolveProxyRoute(parts ?? [], request.method);
  if (!route) return refuse(404, "Path not allowed");

  const incoming = new URL(request.url);
  let body: string | undefined;
  // With credits on (DATABASE_URL), chat needs a wallet session and a positive balance.
  let billedWallet: string | null = null;
  let estimatedUsd = 0;
  let billedModel: string | null = null;
  if (route.kind === "chat") {
    const headerCheck = checkChatHeaders(request.headers);
    if (!headerCheck.ok) return refuse(headerCheck.status, headerCheck.error);
    body = await request.text();
    const bodyCheck = checkChatBody(body, request.headers.get("x-encrypt-all-fields") === "true");
    if (!bodyCheck.ok) return refuse(bodyCheck.status, bodyCheck.error);
    if (creditsEnabled()) {
      billedWallet = walletFromSession(request.headers.get(SESSION_HEADER));
      if (!billedWallet) return refuse(401, "Sign in with your wallet to use the advisor");
      try {
        const balance = await walletBalance(billedWallet);
        if (balance.availableUsd <= 0) return refuse(402, "Out of AI credits. Top up to continue.");
      } catch {
        return refuse(503, "Credit ledger unavailable");
      }
      const parsed = JSON.parse(body) as { max_tokens?: number; model?: string };
      estimatedUsd = estimateRequestUsd(parsed.max_tokens ?? 1200);
      billedModel = typeof parsed.model === "string" ? parsed.model : null;
    }
  } else {
    const queryCheck =
      route.kind === "attestation"
        ? checkAttestationQuery(incoming.searchParams)
        : checkSignatureQuery(incoming.searchParams);
    if (!queryCheck.ok) return refuse(queryCheck.status, queryCheck.error);
  }

  const upstreamPath = route.kind === "signature" ? `v1/signature/${route.id}` : parts.join("/");
  const upstreamUrl = `${UPSTREAM}/${upstreamPath}${incoming.search}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  for (const name of PASS_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return refuse(502, "Upstream unreachable");
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("content-type", contentType);
  const inferenceId = upstream.headers.get("inference-id");
  if (inferenceId) out.set("inference-id", inferenceId);
  out.set("cache-control", "no-store");
  let responseBody = upstream.body;
  if (billedWallet && inferenceId && upstream.ok) {
    // Estimate now; NEAR AI's billed cost replaces it on the next balance read.
    await recordUsage(billedWallet, inferenceId, estimatedUsd, billedModel).catch(() => undefined);
    if (upstream.body) {
      // Read the token counts from the final stream chunk (plain text) while the browser gets the
      // same bytes untouched; `after` keeps the function alive until the copy is read.
      const [toBrowser, toMeter] = upstream.body.tee();
      responseBody = toBrowser;
      after(() => meterTokens(toMeter, inferenceId));
    }
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: out,
  });
}

export const GET = proxy;
export const POST = proxy;
