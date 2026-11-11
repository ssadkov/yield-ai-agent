# Environment variables (private advisor desk)

Скопируй `.env.example` → `.env.local`. Секреты в репозиторий не коммитить (`.env*` в `.gitignore`, кроме `.env.example`).

На Vercel того же проекта задай те же ключи в Project Settings → Environment Variables.

## Required for the advisor chat

| Variable | Where used | What it is |
|---|---|---|
| `NEAR_AI_API_KEY` | `src/app/api/near/[...path]/route.ts` | API-ключ NEAR AI Cloud. Браузер ходит на `/agent/api/near/…`; сервер подставляет `Authorization: Bearer …` и проксирует шифротекст в `https://cloud-api.near.ai`. Без ключа чат отвечает **503**. Ключ в браузер и в git не класть. |

Как получить: [cloud.near.ai](https://cloud.near.ai) → workspace → API keys. **Обязательно ставь `spend_limit`** на ключ: это единственный жёсткий потолок расходов.

Прокси пропускает с этим ключом только E2EE-чат к моделям из `src/lib/advisor/models.ts` (содержимое сообщений и инструментов — шифротекст, `max_tokens` ≤ 1200, без встроенных платных инструментов), их отчёты аттестации и подписи ответов. Всё остальное — 4xx. Правила и тесты: `src/lib/advisor/proxyPolicy.ts`, `pnpm test`.

Проверка без UI: ключ в `.env.local`, затем `node scripts/near-ai-e2ee-probe.mjs`.

## AI credits (optional — без них чат открыт всем, потолок только `spend_limit`)

Кредиты включаются, когда задан `DATABASE_URL`. Тогда чат требует входа подписью Solana-кошелька и положительного баланса.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres (Vercel → Storage → Neon). Таблицы `advisor_usage` и `advisor_purchases` создаются сами при первом запросе. Промптов и ответов там нет — кошельки, id запросов NEAR AI с ценой, покупки. |
| `SESSION_SECRET` | Случайная строка 32+ символов: подписывает challenge и токен сессии. Сменить = разлогинить всех. |
| `ADVISOR_FREE_USD_PER_MONTH` | Бесплатный лимит на кошелёк в месяц из AI-пула, по умолчанию `0.05`. |
| `CREDITS_RECEIVER` | Адрес, куда 1-Click платит за купленные кредиты (по умолчанию USDC на Solana). Отдельный кошелёк, не ключ admin/upgrade программы. Без него покупка выключена, бесплатный лимит работает. |
| `CREDITS_DESTINATION_ASSET` | Актив получения в формате 1-Click, по умолчанию USDC на Solana. |
| `AI_POOL_NEAR_ACCOUNT`, `AI_POOL_PRODUCT_ID` | Чей стейк NEAR AI показывает счётчик пула; по умолчанию `sadkov.near`. |

## Optional (already in the repo, not new in this branch)

Эти переменные относятся к USDC yields / хосту Safe, не к E2EE-чату:

| Variable | Default / notes |
|---|---|
| `USDC_YIELDS_INCLUDE_APTOS` | `1` — подтянуть Aptos-строки из основного приложения (на проде роут часто 404). На хакатон обычно не ставить. |
| `SOLANA_SAFE_API_ORIGIN` | Origin API Solana Safe (если не дефолтный). |
| `YIELD_AI_API_ORIGIN` | Origin основного Yield AI API. |
| `NEXT_PUBLIC_DERIVED_SAFE_HOSTS` | Доп. хосты, где разрешён derived Safe (через запятую). |

## Minimal local setup

```bash
cp .env.example .env.local
# edit .env.local:
# NEAR_AI_API_KEY=nearai_...

pnpm dev
# open http://localhost:3000/agent
```
