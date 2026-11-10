import { NextResponse } from "next/server";

/**
 * Blind proxy to NEAR AI Cloud. Adds our API key; does not log request/response bodies.
 * Browser talks to /agent/api/near/v1/... (basePath /agent).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://cloud-api.near.ai";
const ALLOWED = new Set([
  "v1/chat/completions",
  "v1/attestation/report",
  "v1/models",
]);

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

const hits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;

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
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  row.count += 1;
  return row.count > RATE_LIMIT;
}

function resolvePath(parts: string[]): string | null {
  const path = parts.join("/");
  if (ALLOWED.has(path)) return path;
  if (path.startsWith("v1/signature/")) return path;
  return null;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const key = process.env.NEAR_AI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "NEAR_AI_API_KEY is not configured" }, { status: 503 });
  }

  const ip = clientIp(request);
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { path: parts } = await context.params;
  const allowed = resolvePath(parts ?? []);
  if (!allowed) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const upstreamUrl = `${UPSTREAM}/${allowed}${incoming.search}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  for (const name of PASS_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
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
    return NextResponse.json({ error: "Upstream unreachable" }, { status: 502 });
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("content-type", contentType);
  const inferenceId = upstream.headers.get("inference-id");
  if (inferenceId) out.set("inference-id", inferenceId);
  out.set("cache-control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;
