# Yield AI Agent

Connect a Solana wallet, get a derived Aptos account, and see the Safes that account already owns. Deposit through NEAR Intents and the private advisor come later.

Built for the NEAR Hackathon (2026-11-01 – 2026-11-14) on top of the existing [Yield AI](https://yieldai.app) product.

The page lives at `/agent`. In production the main Yield AI app rewrites `https://yieldai.app/agent` to this deployment, so the browser stays on `yieldai.app`. That host is part of the derived Aptos key: the same Phantom wallet produces a different Aptos address on any other host. This page does not create Safes.

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000/agent.

`pnpm build` and `pnpm typecheck` are the checks.

Requests to `/api/...` are rewritten to `https://yieldai.app` when this app is the server (local dev, or opening this deployment on its own domain). On `yieldai.app` the main app serves `/api` itself. There is no API key in this repo. Owner Safes load from `GET /api/protocols/yield-ai/safes?owner=`. Token balances use `GET /api/public/v1/wallet/{address}/balance` and stay hidden when that route asks for a key.

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

**Written for this hackathon** (from 2026-11-01): the `/agent` page, the Solana-first connect dialog, the native Aptos link, the host warning, and the Safe and balance reads. No Safe is created. No mainnet transaction is signed by this page.

## Production check

After this app is deployed and the main app rewrites `/agent` to it, open `https://yieldai.app/agent` with Phantom. The Aptos address must be the same as on `https://yieldai.app`. If the two addresses differ, stop. A Safe created for the wrong address cannot be withdrawn from the main site.

On localhost the Aptos address is different. That is expected.
