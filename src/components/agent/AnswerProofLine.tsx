"use client";

import { useState, type ReactNode } from "react";
import type { AnswerProof, AttestationSummary } from "@/lib/advisor/nearProxy";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/knowledge";
import { ADVISOR_TOOLS } from "@/lib/advisor/tools";
import type { ChatMode } from "@/lib/advisor/modes";

const VERIFICATION_CENTER_URL = "https://docs.near.ai/cloud/verification/verification-center";

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/** One check: a mark, one plain sentence, and the technical detail in small print. */
function Check({ ok, children, detail }: { ok: boolean | null; children: ReactNode; detail?: ReactNode }) {
  const mark = ok === null ? "–" : ok ? "✓" : "✗";
  const tone = ok === null ? "text-muted-foreground" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-danger";
  return (
    <li className="flex gap-2">
      <span aria-hidden className={`w-3 shrink-0 text-center font-semibold ${tone}`}>
        {mark}
      </span>
      <span className="min-w-0">
        <span className="text-foreground/90">{children}</span>
        {detail ? <span className="block break-words text-[11px] text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

/**
 * Under each answer: did NEAR's signature over the exact request and response bytes check out
 * against the attested model, and what actually left the browser (ciphertext).
 * Opened, it lists every check in one plain sentence and shows what the model was told.
 */
export function AnswerProofLine({
  proof,
  attestation,
  model,
  mode,
}: {
  proof: AnswerProof | "checking";
  attestation: AttestationSummary | null;
  model: string | null;
  mode: ChatMode;
}) {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  if (proof === "checking") {
    return <p className="mt-1.5 text-[12px] text-muted-foreground">Checking the answer’s signature…</p>;
  }
  const requests = proof.completionIds.length;
  return (
    <div className="mt-1.5 text-[12px] leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={[
          "-my-1 py-1 text-left",
          proof.verified ? "text-emerald-600 hover:underline dark:text-emerald-400" : "text-danger hover:underline",
        ].join(" ")}
        aria-expanded={open}
      >
        {proof.verified
          ? `✓ Signed inside the attested TEE by ${short(proof.signer ?? "")} · checked in your browser`
          : `✗ Signature not verified: ${proof.error ?? "unknown error"}`}
      </button>
      {open ? (
        <div className="panel-popover mt-1.5 space-y-2 rounded-lg p-2.5 text-muted-foreground">
          <p className="font-medium text-foreground/90">What this browser checked, in plain words</p>
          <ul className="space-y-1.5">
            {attestation ? (
              <>
                <Check ok detail={`Model ${model ?? "?"} · Intel TDX status: ${attestation.tcbStatus}`}>
                  The model runs in a sealed computer (an enclave) that its operator cannot look inside. Intel’s chip vouched for it.
                </Check>
                <Check
                  ok={attestation.gpuEvidence === "verified" ? true : null}
                  detail={attestation.gpuEvidence === "verified" ? "NVIDIA GPU evidence verified" : "No GPU evidence in this attestation"}
                >
                  {attestation.gpuEvidence === "verified"
                    ? "The graphics card doing the work is genuine. NVIDIA confirmed it."
                    : "The enclave sent no proof about its graphics card this time."}
                </Check>
                <Check ok detail={`Signer ${short(attestation.signingAddress)} bound to a fresh nonce`}>
                  The proof was made for this session. It contains a random number this browser picked, so an old proof cannot be replayed.
                </Check>
              </>
            ) : (
              <Check ok={null}>The enclave was checked before this answer was requested. Its details are no longer on this page.</Check>
            )}
            <Check ok detail={`Model key ${proof.modelKeyFingerprint} · X25519 + XChaCha20-Poly1305`}>
              Your messages were locked in this browser with a key that exists only inside that enclave. Our server passed on scrambled text and added the API key.
            </Check>
            <Check
              ok={proof.verified}
              detail={
                proof.verified
                  ? `${proof.signatureKind} signature by ${short(proof.signer ?? "")} over ${requests} request${requests === 1 ? "" : "s"}`
                  : proof.error
              }
            >
              {proof.verified
                ? "This answer was signed inside the same enclave, over the exact bytes sent and received. Nothing was changed on the way."
                : "The signature on this answer did not check out. Treat the answer as unverified."}
            </Check>
          </ul>

          <p className="font-medium text-foreground/80">What left your browser ({proof.requestBytes.toLocaleString("en-US")} bytes):</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-1.5 font-mono text-[11px]">
            {proof.requestExcerpt}…
          </pre>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => setPromptOpen((value) => !value)}
              aria-expanded={promptOpen}
              className="py-1 underline underline-offset-2 hover:text-foreground"
            >
              What the model was told
            </button>
            <a href={VERIFICATION_CENTER_URL} target="_blank" rel="noreferrer" className="py-1 underline underline-offset-2 hover:text-foreground">
              Re-check in NEAR’s Verification Center
            </a>
          </div>
          {promptOpen ? (
            mode === "advisor" ? (
              <div className="space-y-1.5">
                <p>
                  Before your first message the model gets these instructions, word for word. They are sent encrypted like everything
                  else, and they are the same for every user.
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[11px] text-foreground/85">
                  {ADVISOR_SYSTEM_PROMPT}
                </pre>
                <p>
                  It can also ask this browser to run {ADVISOR_TOOLS.length} tools: {ADVISOR_TOOLS.map((tool) => tool.function.name).join(", ")}.
                  None of them can sign or send a transaction.
                </p>
              </div>
            ) : (
              <p>Nothing. Open chat has no instructions from us and no tools: the model sees only what you type.</p>
            )
          ) : null}
          {requests ? <p className="break-all font-mono text-[11px]">ids: {proof.completionIds.join(", ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
