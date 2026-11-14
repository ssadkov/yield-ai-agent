import { NextResponse, after } from "next/server";
import { usageFromSse } from "@/lib/advisor/usage";
import {
  checkAttestationQuery,
  checkChatBody,
  checkChatHeaders,
  checkImageBody,
  checkSignatureQuery,
  outputTokenCap,
  resolveProxyRoute,
} from "@/lib/advisor/proxyPolicy";
import { creditsEnabled, recordUsage, setUsageCost, setUsageTokens } from "@/lib/credits/db";
import { estimateRequestUsd } from "@/lib/credits/ledger";
import { openChatUnlocked, visitorTrial, walletBalance } from "@/lib/credits/service";
import { TRIAL_CAP_REACHED, TRIAL_USED_UP, clientIp } from "@/lib/credits/trial";
import { UNCENSORED_MODEL } from "@/lib/advisor/models";
import { billImage, gateImageRequest } from "@/lib/advisor/imageBilling";
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

  if (rateLimited((clientIp(request) ?? "unknown"))) return refuse(429, "Rate limit exceeded");

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
      const parsed = JSON.parse(body) as { max_tokens?: number; max_completion_tokens?: number; model?: string };
      billedModel = typeof parsed.model === "string" ? parsed.model : null;
      const uncensored = billedModel === UNCENSORED_MODEL;
      billedWallet = walletFromSession(request.headers.get(SESSION_HEADER));
      if (billedWallet) {
        try {
          const balance = await walletBalance(billedWallet);
          if (balance.availableUsd <= 0) return refuse(402, "Out of AI credits. Top up to continue.");
        } catch {
          return refuse(503, "Credit ledger unavailable");
        }
        if (uncensored && !(await openChatUnlocked(billedWallet).catch(() => false))) {
          return refuse(403, "The uncensored model unlocks after a Safe deposit or a credits top-up.");
        }
      } else {
        // No wallet: a few free advisor requests a day (src/lib/credits/trial.ts), never uncensored.
        if (uncensored) return refuse(401, "Connect a Solana wallet to use Open chat.");
        let trial: Awaited<ReturnType<typeof visitorTrial>>;
        try {
          trial = await visitorTrial(request);
        } catch {
          return refuse(503, "Credit ledger unavailable");
        }
        if (!trial) return refuse(401, "Connect a Solana wallet to chat.");
        if (!trial.state.allowed) {
          return refuse(429, trial.state.reason === "daily_cap" ? TRIAL_CAP_REACHED : TRIAL_USED_UP);
        }
        billedWallet = trial.guest;
      }
      // Reserve at the model's output price ($/1M, NEAR AI 2026-11-12); the billed cost replaces it.
      estimatedUsd = estimateRequestUsd(outputTokenCap(parsed), uncensored ? 1.2 : 0.5);
    }
  } else if (route.kind === "image") {
    // One encrypted picture for a signed-in wallet that unlocked Open chat; never on the free trial.
    const headerCheck = checkChatHeaders(request.headers);
    if (!headerCheck.ok) return refuse(headerCheck.status, headerCheck.error);
    body = await request.text();
    const bodyCheck = checkImageBody(body);
    if (!bodyCheck.ok) return refuse(bodyCheck.status, bodyCheck.error);
    if (creditsEnabled()) {
      // The rules live in src/lib/advisor/imageBilling.ts (unit-tested).
      const gate = await gateImageRequest(request.headers.get(SESSION_HEADER), {
        walletFromSession,
        walletBalance,
        openChatUnlocked,
      });
      if (!gate.ok) return refuse(gate.status, gate.error);
      billedWallet = gate.wallet;
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
  if (route.kind === "image") {
    // Charged at list price, once, and only when the model answered (imageBilling.ts).
    await billImage(
      { wallet: billedWallet, requestId: upstream.headers.get("x-request-id"), upstreamOk: upstream.ok },
      { recordUsage, setUsageCost }
    );
    return new NextResponse(responseBody, { status: upstream.status, headers: out });
  }
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
