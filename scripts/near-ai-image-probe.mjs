// NEAR AI Cloud image probe: E2EE vision (image inside the encrypted content) and FLUX image generation.
// Reads NEAR_AI_API_KEY from .env.local in the repo root. Never prints the key.
// Usage: node scripts/near-ai-image-probe.mjs
// The model key is taken from the first attestation candidate WITHOUT full verification — probe only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = /^NEAR_AI_API_KEY=(.*)$/m.exec(env)?.[1]?.trim();
if (!KEY) throw new Error('NEAR_AI_API_KEY is empty in .env.local');

const API = 'https://cloud-api.near.ai';

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));

function hkdf(shared) {
  return new Uint8Array(crypto.hkdfSync('sha256', shared, new Uint8Array(0), Buffer.from('ed25519_encryption'), 32));
}
function encrypt(plain, recipientX) {
  const eph = x25519.utils.randomPrivateKey();
  const key = hkdf(x25519.getSharedSecret(eph, recipientX));
  const nonce = crypto.randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plain));
  return hex(Buffer.concat([x25519.getPublicKey(eph), nonce, ct]));
}
function decrypt(h, myXSecret) {
  const d = unhex(h);
  const key = hkdf(x25519.getSharedSecret(myXSecret, d.slice(0, 32)));
  return new TextDecoder().decode(xchacha20poly1305(key, d.slice(32, 56)).decrypt(d.slice(56)));
}

import zlib from "node:zlib";

/** A 64×64 PNG filled with one colour, built by hand (no image library). */
function solidPng(r, g, b) {
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function attested(model) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const q = new URLSearchParams({ model, provider: "near", signing_algo: "ed25519", include_tls_fingerprint: "false", nonce });
  const r = await fetch(`${API}/v1/attestation/report?${q}`, { headers: { Authorization: `Bearer ${KEY}`, "x-no-aliasing": "true" } });
  const a = await r.json();
  const c0 = (a.model_attestations ?? [])[0];
  if (!c0) throw new Error(`${model}: no attestation (HTTP ${r.status})`);
  return { edPub: c0.signing_public_key, x: ed25519.utils.toMontgomery(unhex(c0.signing_public_key)) };
}

const clientSk = ed25519.utils.randomPrivateKey();
const clientPub = ed25519.getPublicKey(clientSk);
const clientX = ed25519.utils.toMontgomerySecret(clientSk);
const e2eeHeaders = (modelEdPub) => ({
  Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "X-Signing-Algo": "ed25519",
  "X-Client-Pub-Key": hex(clientPub), "X-Model-Pub-Key": modelEdPub, "X-Encryption-Version": "2",
  "x-no-aliasing": "true", "X-Encrypt-All-Fields": "true",
});
const tryDec = (v) => { try { return decrypt(v, clientX); } catch { return `[not decryptable: ${String(v).slice(0, 40)}…]`; } };

// 1. Vision under E2EE: the image is inside the encrypted content (SDK: JSON of the content parts, encrypted as one string).
const red = `data:image/png;base64,${solidPng(220, 20, 20).toString("base64")}`;
for (const model of ["z-ai/glm-5.3-flash", "Qwen/Qwen3-VL-30B-A3B-Instruct"]) {
  try {
    const k = await attested(model);
    const parts = [{ type: "text", text: "What single colour fills this image? Answer with one word." }, { type: "image_url", image_url: { url: red } }];
    const body = { model, messages: [{ role: "user", content: encrypt(JSON.stringify(parts), k.x) }], max_tokens: 300, stream: false };
    const t = Date.now();
    const r = await fetch(`${API}/v1/chat/completions`, { method: "POST", headers: e2eeHeaders(k.edPub), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const msg = j.choices?.[0]?.message;
    console.log(`[vision E2EE] ${model}: HTTP ${r.status}, ${Date.now() - t} ms, image in clear in our request: ${JSON.stringify(body).includes("iVBOR")}`);
    console.log("   reply:", msg?.content ? tryDec(msg.content).slice(0, 120) : JSON.stringify(j).slice(0, 300));
    console.log("   usage:", JSON.stringify(j.usage ?? null));
  } catch (e) { console.log(`[vision E2EE] ${model}: ${e.message}`); }
}

// 2. FLUX generation with E2EE headers and an encrypted prompt.
const FLUX = "black-forest-labs/FLUX.2-klein-4B";
try {
  const k = await attested(FLUX);
  const t = Date.now();
  const r = await fetch(`${API}/v1/images/generations`, {
    method: "POST", headers: e2eeHeaders(k.edPub),
    body: JSON.stringify({ model: FLUX, prompt: encrypt("a single red circle on a white background", k.x), size: "256x256", n: 1, response_format: "b64_json" }),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  const item = j?.data?.[0];
  console.log(`[FLUX E2EE] HTTP ${r.status}, ${Date.now() - t} ms, keys: ${item ? Object.keys(item).join(",") : "-"}`);
  if (item?.b64_json) {
    const v = item.b64_json;
    const looksHex = /^[0-9a-f]+$/i.test(v.slice(0, 200));
    console.log(`   b64_json: ${v.length} chars, hex ciphertext? ${looksHex}, PNG in clear? ${v.startsWith("iVBOR")}`);
    if (looksHex) {
      const plain = tryDec(v);
      console.log(`   decrypted: ${plain.slice(0, 12)}… (/9j/ = JPEG, iVBOR = PNG)`);
      if (process.env.SAVE_IMAGE) fs.writeFileSync(process.env.SAVE_IMAGE, Buffer.from(plain, "base64"));
    }
    for (const field of ["url", "revised_prompt", "file_path", "resize"]) {
      const value = item[field];
      const shown = value == null ? String(value) : typeof value === "string" ? value.slice(0, 90) : JSON.stringify(value).slice(0, 90);
      const hexed = typeof value === "string" && /^[0-9a-f]{100,}$/i.test(value);
      console.log(`   ${field}: ${hexed ? "[hex ciphertext] " + (field === "revised_prompt" ? tryDec(value).slice(0, 60) : "") : shown}`);
    }
  } else console.log("   body:", text.slice(0, 300));
} catch (e) { console.log(`[FLUX E2EE] ${e.message}`); }
