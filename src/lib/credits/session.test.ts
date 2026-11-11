// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair } from "@solana/web3.js";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-42";
const { issueChallenge, verifyChallenge, walletFromSession } = await import("./session.ts");

const HOST = "yieldai.app";

function signedBy(keypair: Keypair, message: string): string {
  const sig = ed25519.sign(new TextEncoder().encode(message), keypair.secretKey.slice(0, 32));
  return Buffer.from(sig).toString("base64");
}

test("a wallet that signs its challenge gets a session for itself", () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const c = issueChallenge(wallet, HOST);
  const result = verifyChallenge({ ...c, host: HOST, signature: signedBy(kp, c.message) });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(walletFromSession(result.token), wallet);
});

test("wrong signer, tampered challenge, other host or expired challenge are refused", () => {
  const kp = Keypair.generate();
  const other = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const c = issueChallenge(wallet, HOST);
  assert.equal(verifyChallenge({ ...c, host: HOST, signature: signedBy(other, c.message) }).ok, false);
  assert.equal(verifyChallenge({ ...c, nonce: "00", host: HOST, signature: signedBy(kp, c.message) }).ok, false);
  assert.equal(verifyChallenge({ ...c, host: "evil.example", signature: signedBy(kp, c.message) }).ok, false);
  assert.equal(
    verifyChallenge({ ...c, host: HOST, signature: signedBy(kp, c.message), now: c.expiresAt + 1 }).ok,
    false
  );
});

test("forged or expired session tokens are refused", () => {
  const kp = Keypair.generate();
  const c = issueChallenge(kp.publicKey.toBase58(), HOST);
  const result = verifyChallenge({ ...c, host: HOST, signature: signedBy(kp, c.message) });
  assert.ok(result.ok);
  if (!result.ok) return;
  const [, exp, tag] = result.token.split(".");
  const swapped = `${Keypair.generate().publicKey.toBase58()}.${exp}.${tag}`;
  assert.equal(walletFromSession(swapped), null);
  assert.equal(walletFromSession(result.token, result.expiresAt + 1), null);
  assert.equal(walletFromSession(null), null);
});
