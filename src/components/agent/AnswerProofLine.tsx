"use client";

import { useState } from "react";
import type { AnswerProof, AttestationSummary } from "@/lib/advisor/nearProxy";

const VERIFICATION_CENTER_URL = "https://docs.near.ai/cloud/verification/verification-center";

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/**
 * Under each answer: did NEAR's signature over the exact request and response bytes check out
 * against the attested model, and what actually left the browser (ciphertext).
 */
export function AnswerProofLine({
  proof,
  attestation,
  model,
}: {
  proof: AnswerProof | "checking";
  attestation: AttestationSummary | null;
  model: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (proof === "checking") {
    return <p className="mt-1.5 text-[10.5px] text-muted-foreground">Checking the answer’s signature…</p>;
  }
  return (
    <div className="mt-1.5 text-[10.5px] leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={proof.verified ? "text-emerald-600 hover:underline dark:text-emerald-400" : "text-danger hover:underline"}
        aria-expanded={open}
      >
        {proof.verified
          ? `✓ Signed inside the attested TEE by ${short(proof.signer ?? "")} · checked in your browser`
          : `✗ Signature not verified: ${proof.error ?? "unknown error"}`}
      </button>
      {open ? (
        <div className="panel-popover mt-1.5 space-y-1 rounded-lg p-2 text-muted-foreground">
          {attestation ? (
            <p>
              Model {model ?? "?"} · Intel TDX {attestation.tcbStatus} ·{" "}
              {attestation.gpuEvidence === "verified" ? "NVIDIA GPU evidence verified" : "no GPU evidence"} · signer{" "}
              {short(attestation.signingAddress)} bound to a fresh nonce.
            </p>
          ) : null}
          <p>
            Your messages were encrypted in this browser to model key {proof.modelKeyFingerprint} (X25519 + XChaCha20-Poly1305).
            Our server forwarded only ciphertext and added the API key.
          </p>
          <p>
            {proof.verified
              ? `NEAR’s ${proof.signatureKind} signature covers the exact request and response bytes of ${proof.completionIds.length} completion(s).`
              : "Without a valid signature, treat this answer as unverified."}
          </p>
          <p className="font-medium text-foreground/80">What left your browser ({proof.requestBytes.toLocaleString("en-US")} bytes):</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-1.5 font-mono text-[9.5px]">
            {proof.requestExcerpt}…
          </pre>
          <a href={VERIFICATION_CENTER_URL} target="_blank" rel="noreferrer" className="underline">
            Re-check in NEAR’s Verification Center
          </a>
          {proof.completionIds.length ? <p className="font-mono text-[9.5px]">ids: {proof.completionIds.join(", ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
