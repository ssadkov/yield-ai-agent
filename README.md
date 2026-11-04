# Yield AI Agent

Connect a Solana wallet, get a derived Aptos account, see the Safes that account already owns, and run a small test deposit through NEAR Intents 1-Click. The private advisor comes later.

Built for the NEAR Hackathon (2026-11-01 – 2026-11-14) on top of the existing [Yield AI](https://yieldai.app) product.

The page lives at `/agent`. In production the main Yield AI app rewrites `https://yieldai.app/agent` to this deployment, so the browser stays on `yieldai.app`. That host is part of the derived Aptos key: the same Phantom wallet produces a different Aptos address on any other host. This page does not create Safes.

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000/agent. `http://localhost:3000/` redirects there.

## Deploy

Host the build on Vercel as its own project, imported from this repository. Do not attach `yieldai.app` or any subdomain to that project. The derived Aptos address uses the browser's host, so the page has to be opened as `https://yieldai.app/agent`.

The main Yield AI app proxies `/agent` and `/agent/:path*` to this deployment's production URL (`https://<project>.vercel.app/agent/...`) and strips the `cookie` header on the way. `/api` stays on the main app. Until that proxy exists, `yieldai.app/agent` will not open.

Opening the `*.vercel.app` URL directly is only a smoke test. The host warning on that URL is expected, and the Aptos address there is not the production one.

`pnpm build` and `pnpm typecheck` are the checks.

Requests to `/api/...` are rewritten to `https://yieldai.app` when this app is the server (local dev, or opening this deployment on its own domain). On `yieldai.app` the main app serves `/api` itself. There is no API key in this repo. Owner Safes load from `GET /api/protocols/yield-ai/safes?owner=`. Token balances use `GET /api/public/v1/wallet/{address}/balance` and stay hidden when that route asks for a key.

## Deposit test (NEAR Intents 1-Click)

After a Solana wallet connects, the page shows a **Deposit test** panel. It sends 1 to 5 USDC from that wallet to a one-time 1-Click deposit address and tracks the payout. There are two destinations:

- **Solana Safe** (program `yie1…`, [yield-ai-os-sol](https://github.com/ssadkov/yield-ai-os-sol)). The recipient is the Safe PDA `["vault", owner]`, never its USDC token account: 1-Click pays into ATA(recipient). The panel requires an existing Safe and Safe USDC account, and compares the Safe's USDC balance before and after.
- **Aptos account (derived).** The recipient is the derived Aptos account for `yieldai.app`, computed in the browser. The route is enabled only when the same computation reproduces the address the wallet actually connected with on the current host. From there the user moves the funds into the Aptos Safe on yieldai.app. A direct transfer to an Aptos Safe address is not used, because this repo cannot confirm that the Safe credits it.

How it works:

- The panel calls the 1-Click API straight from the browser; the API allows CORS. It requests a real quote with refunds to the connected wallet, and refuses to send if the quote echoes a different recipient, refund address, asset or amount.
- The user signs one Solana transfer: create the deposit address's USDC account idempotently, then `TransferChecked`. The panel submits the transaction hash to 1-Click and polls `/v0/status` every 5 s. Tracking survives a reload through `localStorage`.
- Solana reads go through the main app's `/api/solana/rpc` on yieldai.app, and through PublicNode elsewhere (the public mainnet RPC answers browsers with 403). Aptos balances come from the public Aptos API.

Checked on 2026-11-04 without signing anything:

- The hand-built instructions are byte-for-byte the same as `@solana/spl-token`'s.
- The Safe PDA and USDC account match the known pilot Safe.
- Dry quotes echo the request, priced $1 → $0.99 to the Solana Safe in ~17 s and $1 → $0.98 to Aptos in ~35 s.
- The computed production address for the pilot wallet is the derived account the main app already knows.

The funded transfer itself still has to be made by a person with the wallet.

## Private advisor (in progress)

A chat advisor that runs on NEAR AI Cloud inside a TEE. The browser encrypts every message to the model's
attested key (end-to-end encryption), so the app's server only forwards ciphertext and adds the API key. Tool
calls and their results are encrypted too. Actions are proposals only: the owner signs any transaction.

Checked on 2026-11-07 with [`scripts/near-ai-e2ee-probe.mjs`](scripts/near-ai-e2ee-probe.mjs): encrypted message,
encrypted streamed tool call and encrypted tool result all decrypt on `z-ai/glm-5.3-flash`. The chat itself is not
built yet; the plan is in [docs/private-advisor.md](docs/private-advisor.md).

## USDC yields API

`GET /agent/api/usdc-yields` (`https://yieldai.app/agent/api/usdc-yields` in production) lists the USDC rates a Yield AI Safe can deposit into now. This is what the private advisor reads.

**Sources** (each with a 15 s timeout):

| Source | Rate | Status on 2026-11-04 |
|---|---|---|
| Kamino USDC kVault, Solana Safe (Solana Safe API) | Variable APY, with 7/30/90/365-day history | Works |
| Exponent PT-ONyc, Solana Safe (Solana Safe API) | Fixed APY to maturity, indicative | Works |
| Aptos agent strategies (`/api/protocols/yield-ai/strategy-yields` in the main app) | APR including the Boost campaign | `unavailable`: the route is not in the main app's production yet |

Orca, Jupiter and leverage are not listed. Origins can be overridden with `SOLANA_SAFE_API_ORIGIN` and `YIELD_AI_API_ORIGIN`.

**Response.** `rows` sorted by rate, `sources` with a status per source, and `notes`. Each row carries:
- chain, Safe and venue;
- deposit asset, rate type and kind (APY or APR), headline rate, base rate, Boost, leverage, maturity, history;
- whether the agent can execute it;
- risk, caveats, source and time.

**Failures and caching.** A failed source stays in `sources` as `unavailable`, or as `stale` with its last good rows if those are at most 10 minutes old. The server caches responses for 60 s.

## What is new vs. baseline

Hackathon rules Q-001, Q-002 and Q-005: code written before 2026-10-19, and the existing Yield AI product, are baseline. Only the NEAR integration built inside the window is the submission. This repository splits them in git history.

**Baseline**, imported from the private Yield AI app (`origin/main`, commit `6ec121361b9fe85bdb152babc9eed53b25a7c5f8`, read on 2026-11-02). That app is not public. These files are the wallet connection it already shipped:

| File | Notes |
|---|---|
| `src/lib/WalletProvider.tsx` | Aptos adapter, `crossChainWallets`, auto-connect, derived Solana registration. Gas Station and EVM derivation are not included. |
| `src/lib/SolanaProvider.tsx` | Solana `ConnectionProvider` / `WalletProvider`. Coinbase, Torus and Ledger adapters from the original are omitted: they pull WalletConnect into the page. Installed wallets still appear through Wallet Standard. |
| `src/lib/solanaRpcEndpoint.ts` | Public Solana RPC. The main app proxies RPC through a server-side key; this repo does not have that key. |
| `src/components/SolanaWalletRestore.tsx` | Keeps the Solana adapter in sync with a `"Name (Solana)"` derived account. |
| `src/components/AptosWalletRestore.tsx` | Restores the Aptos session. Respects `skip_auto_connect_derived_aptos`. |
| `src/lib/aptosWalletUtils.ts` | Derived vs native, from the wallet name. |
| `src/lib/wallet/getSolanaWalletAddress.ts` | Solana address carried on the derived Aptos wallet. |
| `src/lib/protocols/yield-ai/derivedSafeHost.ts` | Rule for where a derived wallet may create a Safe. Not used to create one here. |
| `src/lib/utils/addressNormalization.ts` | Canonical Aptos addresses for the Safes query. |

**Written for this hackathon** (from 2026-11-01): the `/agent` page, the Solana-first connect dialog, the native Aptos link, the host warning, the Safe and balance reads, the NEAR Intents 1-Click deposit test (`src/lib/agent/oneClick.ts`, `solanaSafe.ts`, `aptosDerived.ts`, `src/components/agent/IntentsDepositPanel.tsx`), and the USDC yields API (`src/lib/agent/usdcYields.ts`, `src/app/api/usdc-yields/route.ts`). No Safe is created. The only transaction this page asks the wallet to sign is the deposit-test USDC transfer to a 1-Click deposit address.

## Production check

After this app is deployed and the main app rewrites `/agent` to it, open `https://yieldai.app/agent` with Phantom. The Aptos address must be the same as on `https://yieldai.app`. If the two addresses differ, stop. A Safe created for the wrong address cannot be withdrawn from the main site.

On localhost the Aptos address is different. That is expected.
