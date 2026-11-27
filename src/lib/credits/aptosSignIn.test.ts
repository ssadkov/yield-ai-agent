// Native Aptos sign-in (Petra-style signMessage). Run with `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { Ed25519PublicKey } from "@aptos-labs/ts-sdk";
import { aptosSignInMessage, parseAptosFullMessage } from "./aptosSignIn.ts";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-42";
const { issueChallenge, verifyAptosChallenge, walletFromSession } = await import("./session.ts");

const HOST = "yieldai.app";

function account() {
  const secret = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secret);
  const address = new Ed25519PublicKey(publicKey).authKey().derivedAddress().toStringLong();
  return { secret, publicKey, address, publicHex: Buffer.from(publicKey).toString("hex") };
}

/** What Petra signs for `signMessage({ message, nonce, address: true, application: true, chainId: true })`. */
function walletFullMessage(o: { address: string; application: string; message: string; nonce: string; chainId?: number }): string {
  return `APTOS\naddress: ${o.address}\napplication: ${o.application}\nchainId: ${o.chainId ?? 1}\nmessage: ${o.message}\nnonce: ${o.nonce}`;
}

function signed(acct: ReturnType<typeof account>, full: string): string {
  return Buffer.from(ed25519.sign(new TextEncoder().encode(full), acct.secret)).toString("hex");
}

const neverUsed = async () => null;

test("a native Aptos wallet that signs its challenge on yieldai.app gets a session", async () => {
  const acct = account();
  const c = issueChallenge(acct.address, HOST);
  const full = walletFullMessage({ address: acct.address, application: "https://yieldai.app", message: aptosSignInMessage(c), nonce: c.nonce });
  const result = await verifyAptosChallenge({ ...c, fullMessage: full, signature: signed(acct, full), publicKey: acct.publicHex }, neverUsed);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(walletFromSession(result.token), acct.address);
});

test("the wallet's text is parsed field by field, including a multi-line message", () => {
  const parsed = parseAptosFullMessage(walletFullMessage({ address: "0x1", application: "https://yieldai.app", message: "line one\nline two", nonce: "ab" }));
  assert.ok(typeof parsed !== "string");
  if (typeof parsed !== "string") {
    assert.equal(parsed.message, "line one\nline two");
    assert.equal(parsed.nonce, "ab");
    assert.equal(parsed.application, "https://yieldai.app");
  }
  assert.equal(typeof parseAptosFullMessage("APTOS\nevil: x\nmessage: m\nnonce: n"), "string");
});

test("signed on another site, for another address, network or nonce, or another message: refused", async () => {
  const acct = account();
  const c = issueChallenge(acct.address, HOST);
  const base = { address: acct.address, application: "https://yieldai.app", message: aptosSignInMessage(c), nonce: c.nonce };
  const variants: [string, string][] = [
    ["other site", walletFullMessage({ ...base, application: "https://evil.example" })],
    ["other address", walletFullMessage({ ...base, address: account().address })],
    ["other network", walletFullMessage({ ...base, chainId: 2 })],
    ["other nonce", walletFullMessage({ ...base, nonce: "b".repeat(32) })],
    ["other message", walletFullMessage({ ...base, message: "Approve everything" })],
  ];
  for (const [label, full] of variants) {
    const result = await verifyAptosChallenge({ ...c, fullMessage: full, signature: signed(acct, full), publicKey: acct.publicHex }, neverUsed);
    assert.equal(result.ok, false, label);
  }
});

test("a key that does not control the account is refused, rotated keys are checked on chain", async () => {
  const owner = account();
  const intruder = account();
  const c = issueChallenge(owner.address, HOST);
  const full = walletFullMessage({ address: owner.address, application: "https://yieldai.app", message: aptosSignInMessage(c), nonce: c.nonce });
  // Intruder signs with its own key, claiming the owner's address.
  const forged = await verifyAptosChallenge({ ...c, fullMessage: full, signature: signed(intruder, full), publicKey: intruder.publicHex }, neverUsed);
  assert.equal(forged.ok, false);
  // The owner rotated to the intruder's key on chain: now the intruder's key is the right one.
  const rotatedTo = new Ed25519PublicKey(intruder.publicKey).authKey().toString();
  const rotated = await verifyAptosChallenge(
    { ...c, fullMessage: full, signature: signed(intruder, full), publicKey: intruder.publicHex },
    async () => rotatedTo
  );
  assert.equal(rotated.ok, true);
  // …and the original key no longer works.
  const stale = await verifyAptosChallenge({ ...c, fullMessage: full, signature: signed(owner, full), publicKey: owner.publicHex }, async () => rotatedTo);
  assert.equal(stale.ok, false);
});

test("a challenge issued for one address cannot be used for another", async () => {
  const acct = account();
  const other = account();
  const c = issueChallenge(acct.address, HOST);
  const full = walletFullMessage({ address: other.address, application: "https://yieldai.app", message: aptosSignInMessage(c), nonce: c.nonce });
  const result = await verifyAptosChallenge(
    { ...c, wallet: other.address, fullMessage: full, signature: signed(other, full), publicKey: other.publicHex },
    neverUsed
  );
  assert.equal(result.ok, false);
});
