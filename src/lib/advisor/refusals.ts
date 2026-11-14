/**
 * Turns a failed proxy response into one sentence a person can act on.
 * The proxy's own refusals (sign in, out of credits, locked, trial used up) are already written
 * for people and are shown as they are; everything else gets a plain explanation.
 * The proxy records usage only when the model answered, so a failure is never charged.
 */

function refusalText(detail: string): string | null {
  try {
    const refusal = (JSON.parse(detail) as { error?: unknown }).error;
    return typeof refusal === "string" && refusal ? refusal : null;
  } catch {
    return null;
  }
}

/** `what` names the thing that failed: "Chat" or "Picture". */
export function refusalMessage(status: number, detail: string, what: string): string {
  const refusal = refusalText(detail);
  if (refusal === "Rate limit exceeded") {
    return "Too many requests from this network in the last minute. Wait a moment and try again.";
  }
  if (refusal === "Credit ledger unavailable") {
    return "The credit ledger is not answering right now. Nothing was charged. Try again in a minute.";
  }
  if (refusal && status < 500) return refusal;
  if (status >= 500) {
    return `${what}: the model on NEAR AI Cloud is not answering right now (HTTP ${status}). Nothing was charged. Try again in a few minutes.`;
  }
  return `${what} HTTP ${status}${detail ? `: ${detail.slice(0, 180)}` : ""}`;
}
