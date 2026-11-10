/**
 * NEAR AI Cloud E2EE v2 helpers for the browser.
 * Wire: [eph_pub 32][nonce 24][ct+tag], hex. See scripts/near-ai-e2ee-probe.mjs.
 */
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

const INFO = new TextEncoder().encode("ed25519_encryption");

export type ClientKeys = {
  edSecret: Uint8Array;
  edPublic: Uint8Array;
  xSecret: Uint8Array;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hkdf(shared: Uint8Array): Promise<Uint8Array> {
  const material = shared.buffer.slice(shared.byteOffset, shared.byteOffset + shared.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO },
    key,
    256
  );
  return new Uint8Array(bits);
}

export function createClientKeys(): ClientKeys {
  const edSecret = ed25519.utils.randomPrivateKey();
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  return { edSecret, edPublic, xSecret };
}

export async function encryptToModel(plain: string, modelEdPubHex: string): Promise<string> {
  const modelX = ed25519.utils.toMontgomery(fromHex(modelEdPubHex));
  const eph = x25519.utils.randomPrivateKey();
  const key = await hkdf(x25519.getSharedSecret(eph, modelX));
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ct = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plain));
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(x25519.getPublicKey(eph), 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return toHex(out);
}

export async function decryptFromModel(hex: string, clientXSecret: Uint8Array): Promise<string> {
  const data = fromHex(hex);
  if (data.length < 56) throw new Error("Ciphertext too short");
  const key = await hkdf(x25519.getSharedSecret(clientXSecret, data.slice(0, 32)));
  const plain = xchacha20poly1305(key, data.slice(32, 56)).decrypt(data.slice(56));
  return new TextDecoder().decode(plain);
}

export function clientPubHex(keys: ClientKeys): string {
  return toHex(keys.edPublic);
}

export function randomNonceHex(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
