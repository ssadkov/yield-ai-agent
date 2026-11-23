// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair } from "@solana/web3.js";
import { signInMessage } from "./siws.ts";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-42";
const { isAllowedSignInHost, issueChallenge, verifyChallenge, walletFromSession } = await import("./session.ts");

const HOST = "yieldai.app";

function signedBy(keypair: Keypair, message: string): string {
  const sig = ed25519.sign(new TextEncoder().encode(message), keypair.secretKey.slice(0, 32));
  return Buffer.from(sig).toString("base64");
}

test("a wallet that signs its challenge gets a session for itself", () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const c = issueChallenge(wallet, HOST);
  const result = verifyChallenge({ ...c, signature: signedBy(kp, signInMessage(c)) });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(walletFromSession(result.token), wallet);
});

test("the message is Sign In With Solana for this domain, so SIWS-aware wallets check the site", () => {
  const kp = Keypair.generate();
  const c = issueChallenge(kp.publicKey.toBase58(), HOST);
  const lines = signInMessage(c).split("\n");
  assert.equal(lines[0], "yieldai.app wants you to sign in with your Solana account:");
  assert.equal(lines[1], kp.publicKey.toBase58());
  assert.ok(lines.includes("URI: https://yieldai.app/agent"));
  assert.ok(lines.includes(`Nonce: ${c.nonce}`));
  assert.ok(lines.some((l) => l.startsWith("Expiration Time: ")));
});

test("wrong signer, tampered challenge, other domain or expired challenge are refused", () => {
  const kp = Keypair.generate();
  const other = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const c = issueChallenge(wallet, HOST);
  const sig = signedBy(kp, signInMessage(c));
  assert.equal(verifyChallenge({ ...c, signature: signedBy(other, signInMessage(c)) }).ok, false);
  assert.equal(verifyChallenge({ ...c, nonce: "0".repeat(32), signature: sig }).ok, false);
  assert.equal(verifyChallenge({ ...c, domain: "evil.example", signature: sig }).ok, false);
  assert.equal(verifyChallenge({ ...c, issuedAt: c.issuedAt - 1, signature: sig }).ok, false);
  assert.equal(verifyChallenge({ ...c, signature: sig, now: c.expiresAt + 1 }).ok, false);
});

test("the server issues challenges only for its own domains", () => {
  const prod = { NODE_ENV: "production" };
  assert.equal(isAllowedSignInHost("yieldai.app", prod), true);
  assert.equal(isAllowedSignInHost("evil.example", prod), false);
  assert.equal(isAllowedSignInHost("yieldai.app.evil.example", prod), false);
  assert.equal(isAllowedSignInHost("localhost:3040", prod), false);
  assert.equal(isAllowedSignInHost("localhost:3040", { NODE_ENV: "development" }), true);
  assert.equal(
    isAllowedSignInHost("x-git-y.vercel.app", { NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "x-git-y.vercel.app" }),
    true
  );
  assert.equal(
    isAllowedSignInHost("x-git-y.vercel.app", { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "x-git-y.vercel.app" }),
    false
  );
});

test("forged or expired session tokens are refused", () => {
  const kp = Keypair.generate();
  const c = issueChallenge(kp.publicKey.toBase58(), HOST);
  const result = verifyChallenge({ ...c, signature: signedBy(kp, signInMessage(c)) });
  assert.ok(result.ok);
  if (!result.ok) return;
  const [, exp, tag] = result.token.split(".");
  const swapped = `${Keypair.generate().publicKey.toBase58()}.${exp}.${tag}`;
  assert.equal(walletFromSession(swapped), null);
  assert.equal(walletFromSession(result.token, result.expiresAt + 1), null);
  assert.equal(walletFromSession(null), null);
});

// The browser side must never sign text the server chose: that would hand a compromised server a
// signature over anything, such as a future memory-key message.
async function browserSignIn(serverReply: (wallet: string) => Record<string, unknown>) {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      location: { host: HOST },
      localStorage: {
        setItem: (k: string, v: string) => store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => store.delete(k),
      },
      dispatchEvent: () => true,
    },
    Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  });
  const { signIn } = await import("./client.ts");
  const wallet = Keypair.generate().publicKey.toBase58();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? serverReply(wallet) : { wallet, token: "t", expiresAt: Date.now() + 60_000 }));
  }) as typeof fetch;
  const signed: string[] = [];
  const outcome = await signIn(wallet, async (m) => {
    signed.push(new TextDecoder().decode(m));
    return new Uint8Array(64);
  }).then(
    () => "signed in",
    (e: Error) => e.message
  );
  return { outcome, signed };
}

test("the browser signs only the SIWS text it builds itself, never text from the server", async () => {
  const now = Date.now();
  const fields = (wallet: string) => ({ wallet, domain: HOST, nonce: "a".repeat(32), issuedAt: now, expiresAt: now + 60_000, tag: "t" });
  const ok = await browserSignIn((w) => ({ ...fields(w), message: "Yield AI advisor memory key v1" }));
  assert.equal(ok.outcome, "signed in");
  assert.equal(ok.signed.length, 1);
  assert.match(ok.signed[0], /^yieldai\.app wants you to sign in with your Solana account:/);
  assert.ok(!ok.signed[0].includes("memory key"));

  const refusals: [string, (w: string) => Record<string, unknown>][] = [
    ["other site", (w) => ({ ...fields(w), domain: "evil.example" })],
    ["other wallet", (w) => ({ ...fields(w), wallet: Keypair.generate().publicKey.toBase58() })],
    ["injected nonce", (w) => ({ ...fields(w), nonce: "x\nURI: https://evil.example" })],
    ["long life", (w) => ({ ...fields(w), expiresAt: now + 24 * 3600_000 })],
  ];
  for (const [label, reply] of refusals) {
    const refused = await browserSignIn(reply);
    assert.equal(refused.signed.length, 0, label);
  }
});
