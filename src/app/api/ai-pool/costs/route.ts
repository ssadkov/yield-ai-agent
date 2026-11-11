import { NextResponse } from "next/server";

/**
 * POST /agent/api/ai-pool/costs {requestIds: string[]} — what these advisor requests cost.
 * Forwards to NEAR AI `POST /v1/billing/costs` with our key. Ids are the `inference-id` headers
 * the chat already received; the response holds costs only, no content.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 50;

export async function POST(request: Request) {
  const key = process.env.NEAR_AI_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "NEAR_AI_API_KEY is not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { requestIds?: unknown } | null;
  const ids = Array.isArray(body?.requestIds) ? body!.requestIds : null;
  if (!ids || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return NextResponse.json({ error: `requestIds must be 1..${MAX_IDS} UUIDs` }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://cloud-api.near.ai/v1/billing/costs", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ requestIds: ids }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: "NEAR AI unreachable" }, { status: 502 });
  }
  if (!upstream.ok) return NextResponse.json({ error: `NEAR AI HTTP ${upstream.status}` }, { status: 502 });
  const json = (await upstream.json()) as { requests?: { requestId: string; costNanoUsd: number }[] };
  const requests = json.requests ?? [];
  const totalNanoUsd = requests.reduce((sum, row) => sum + (Number.isFinite(row.costNanoUsd) ? row.costNanoUsd : 0), 0);
  return NextResponse.json(
    { requests, totalUsd: totalNanoUsd / 1e9, priced: requests.length },
    { headers: { "cache-control": "no-store" } }
  );
}
