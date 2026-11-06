// NEAR AI Cloud E2EE probe: attestation key → encrypted request → decrypted reply, then a streamed tool call.
// Reads NEAR_AI_API_KEY from .env.local in the repo root. Never prints the key.
// Usage: node scripts/near-ai-e2ee-probe.mjs [model]   (default z-ai/glm-5.3-flash)
// The model key is taken from the first attestation candidate WITHOUT full verification — probe only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = /^NEAR_AI_API_KEY=(.*)$/m.exec(env)?.[1]?.trim();
if (!KEY) throw new Error('NEAR_AI_API_KEY is empty in .env.local');

const API = 'https://cloud-api.near.ai';
const MODEL = process.argv[2] || 'z-ai/glm-5.3-flash';
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

// 1. Attestation → model key
const nonce = crypto.randomBytes(32).toString('hex');
const q = new URLSearchParams({ model: MODEL, provider: 'near', signing_algo: 'ed25519', include_tls_fingerprint: 'false', nonce });
let t = Date.now();
const ar = await fetch(`${API}/v1/attestation/report?${q}`, { headers: { Authorization: `Bearer ${KEY}`, 'x-no-aliasing': 'true' } });
const att = await ar.json();
const cands = att.model_attestations ?? [];
console.log(`attestation: HTTP ${ar.status}, ${cands.length} candidate(s), ${Date.now() - t} ms`);
if (!cands.length) { console.log(JSON.stringify(att).slice(0, 400)); process.exit(1); }
const c0 = cands[0];
const modelEdPub = c0.signing_public_key;
console.log('candidate keys:', Object.keys(c0).join(', '));
console.log('nonce echoed:', JSON.stringify(c0).includes(nonce));
const modelX = ed25519.utils.toMontgomery(unhex(modelEdPub));

// client key pair
const clientSk = ed25519.utils.randomPrivateKey();
const clientPub = ed25519.getPublicKey(clientSk);
const clientX = ed25519.utils.toMontgomerySecret(clientSk);

const headers = (all) => ({
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  'X-Signing-Algo': 'ed25519',
  'X-Client-Pub-Key': hex(clientPub),
  'X-Model-Pub-Key': modelEdPub,
  'X-Encryption-Version': '2',
  'x-no-aliasing': 'true',
  ...(all ? { 'X-Encrypt-All-Fields': 'true' } : {}),
});

// 2. Plain encrypted round trip
t = Date.now();
const r1 = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: headers(false),
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: encrypt('Reply with exactly one word: PONG', modelX) }],
    max_tokens: 200,
    stream: false,
  }),
});
const j1 = await r1.json();
console.log(`\n[A] non-stream: HTTP ${r1.status}, ${Date.now() - t} ms, inference-id ${r1.headers.get('inference-id')}`);
const m1 = j1.choices?.[0]?.message;
if (!m1) console.log(JSON.stringify(j1).slice(0, 500));
else {
  console.log('    raw content looks encrypted:', /^[0-9a-f]+$/i.test(m1.content ?? ''));
  console.log('    decrypted:', JSON.stringify(m1.content ? decrypt(m1.content, clientX) : null));
}

// 3. Streamed tool call with all fields encrypted
const tool = {
  type: 'function',
  function: {
    name: encrypt('get_strategy_yields', modelX),
    description: encrypt('Current APRs of Yield AI strategies. Call for any yield question.', modelX),
    parameters: encrypt(JSON.stringify({ type: 'object', properties: {}, required: [] }), modelX),
  },
};
t = Date.now();
const r2 = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: headers(true),
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: encrypt('What yields can I get right now? Use the tool.', modelX) }],
    tools: [tool],
    max_tokens: 400,
    stream: true,
  }),
});
console.log(`\n[B] stream+tool: HTTP ${r2.status}, first byte ${Date.now() - t} ms`);
if (!r2.ok) { console.log((await r2.text()).slice(0, 600)); process.exit(1); }
let buf = '', chunks = 0, text = '', toolNames = [], toolArgs = '', errors = 0, toolId = null;
const tryDec = (v) => { try { return decrypt(v, clientX); } catch { errors++; return `<undecryptable:${String(v).slice(0, 16)}>`; } };
for await (const part of r2.body) {
  buf += Buffer.from(part).toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    chunks++;
    const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
    if (delta.content) text += tryDec(delta.content);
    for (const tc of delta.tool_calls ?? []) {
      if (tc.id) toolId = tc.id;
      if (tc.function?.name) toolNames.push(tryDec(tc.function.name));
      if (tc.function?.arguments) toolArgs += tryDec(tc.function.arguments);
    }
  }
}
console.log(`    ${chunks} chunks in ${Date.now() - t} ms, decrypt errors: ${errors}`);
console.log('    tool calls:', JSON.stringify(toolNames), 'args:', JSON.stringify(toolArgs));
console.log('    text:', JSON.stringify(text.slice(0, 300)), 'tool id:', toolId);

// 4. Send the tool result back (encrypted) and read the final streamed answer
if (toolId && toolNames.length) {
  const toolResult = JSON.stringify({
    note: 'probe data, not live',
    strategies: [
      { label: 'Stablecoin compound', totalAprPct: 9.1 },
      { label: 'Echelon stable loop', totalAprPct: 17.4 },
    ],
  });
  t = Date.now();
  const r3 = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'user', content: encrypt('What yields can I get right now? Use the tool.', modelX) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: toolId, type: 'function', function: { name: encrypt(toolNames[0], modelX), arguments: encrypt(toolArgs || '{}', modelX) } }],
        },
        { role: 'tool', tool_call_id: toolId, content: encrypt(toolResult, modelX) },
      ],
      tools: [tool],
      max_tokens: 400,
      stream: true,
    }),
  });
  console.log(`\n[C] tool result → answer: HTTP ${r3.status}`);
  if (!r3.ok) { console.log((await r3.text()).slice(0, 600)); process.exit(1); }
  let b = '', out = '', n = 0;
  for await (const part of r3.body) {
    b += Buffer.from(part).toString('utf8');
    let i;
    while ((i = b.indexOf('\n')) >= 0) {
      const line = b.slice(0, i).trim(); b = b.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      n++;
      const delta = JSON.parse(line.slice(5)).choices?.[0]?.delta ?? {};
      if (delta.content) out += tryDec(delta.content);
    }
  }
  console.log(`    ${n} chunks in ${Date.now() - t} ms, decrypt errors: ${errors}`);
  console.log('    answer:', JSON.stringify(out.slice(0, 400)));
}
