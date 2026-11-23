# Environment variables

Copy `.env.example` to `.env.local`. Never commit secrets: `.env*` is in `.gitignore`, except `.env.example`.

On Vercel, set the same keys in Project Settings → Environment Variables.

## Required for the advisor chat

| Variable | Where used | What it is |
|---|---|---|
| `NEAR_AI_API_KEY` | `src/app/api/near/[...path]/route.ts` | The NEAR AI Cloud API key. The browser calls `/agent/api/near/…`; the server adds `Authorization: Bearer …` and forwards the ciphertext to `https://cloud-api.near.ai`. Without the key the chat answers **503**. The key never goes to the browser or to git. |

How to get one: [cloud.near.ai](https://cloud.near.ai) → workspace → API keys. **Always set a `spend_limit` on the key**: it is the only hard spending cap.

With this key the proxy passes only E2EE chat to the models in `src/lib/advisor/models.ts` (message and tool content is ciphertext, `max_tokens` ≤ 1200, no built-in paid tools), E2EE picture requests, their attestation reports and the response signatures. Everything else gets a 4xx. Rules and tests: `src/lib/advisor/proxyPolicy.ts`, `pnpm test`.

Check without the UI: put the key in `.env.local`, then run `node scripts/near-ai-e2ee-probe.mjs`.

## AI credits (optional; without them the chat is open to anyone and the only cap is `spend_limit`)

Credits turn on when `DATABASE_URL` is set. Visitors without a wallet then get the daily trial; a wallet signs in with a Solana signature and spends its balance.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres (Vercel → Storage → Neon). The tables are created on the first request. They hold no prompts and no answers: wallets, NEAR AI request ids with their cost, and purchases. |
| `SESSION_SECRET` | A random string of 32+ characters. It signs the sign-in challenge, the session token and the trial's IP hash. Changing it signs everyone out. |
| `ADVISOR_FREE_USD_PER_MONTH` | Free allowance per wallet per month from the AI pool, default `0.05`. |
| `ADVISOR_TRIAL_REQUESTS_PER_DAY`, `ADVISOR_TRIAL_USD_PER_DAY` | The no-wallet trial: requests per visitor per day, and one daily cap for all visitors together. Defaults `10` and `0.1`. |
| `CREDITS_RECEIVER` | The address 1-Click pays for bought credits (USDC on Solana by default). A separate wallet, not the program's admin or upgrade key. Without it buying is off; the free allowance still works. |
| `CREDITS_DESTINATION_ASSET` | The asset received, as a 1-Click asset id; default USDC on Solana. |
| `AI_POOL_NEAR_ACCOUNT`, `AI_POOL_PRODUCT_ID` | Whose NEAR AI stake the pool meter shows. |
| `SESSION_ALLOWED_HOSTS` | Extra domains a sign-in may name, comma-separated. yieldai.app is always allowed, Vercel preview URLs on previews, localhost outside production. Any other domain gets 403, so a page elsewhere cannot obtain a challenge this server accepts. |

## Deployment check

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_NEAR_DEPLOYMENT_CHECK` | `enforce` (default): an enclave whose launcher or deployment files are not NEAR AI's known ones gets nothing. `warn`: it is used and the proof panel says the setup was not recognised. Use `warn` only between a NEAR launcher update and adding its template hash to `src/lib/advisor/nearDeployment.ts` (the error message names the hash). Build-time: redeploy after changing it. |

## Optional (from the main app, not about the private chat)

| Variable | Default / notes |
|---|---|
| `USDC_YIELDS_INCLUDE_APTOS` | `1` adds Aptos rows from the main app to the yields tool. Off for the hackathon demo. |
| `SOLANA_SAFE_API_ORIGIN` | Origin of the Solana Safe API, if not the default. |
| `YIELD_AI_API_ORIGIN` | Origin of the main Yield AI API. |
| `NEXT_PUBLIC_DERIVED_SAFE_HOSTS` | Extra hosts, comma-separated, where a derived Safe is allowed. |

## Minimal local setup

```bash
cp .env.example .env.local
# edit .env.local:
# NEAR_AI_API_KEY=nearai_...

pnpm dev
# open http://localhost:3000/agent
```
