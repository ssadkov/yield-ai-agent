# Prompt caching (NEAR AI cache read)

> 2026-11-11. Как у нас устроено кеширование префикса промпта и как проверить `cached_tokens`.
> Документация NEAR: https://docs.near.ai/cloud/guides/prompt-caching

## Что есть у нас

Своего кеша запросов к ИИ **нет**. Есть расчёт на автоматический **prompt caching** у NEAR AI Cloud:

- на TEE-моделях (у нас основная — `z-ai/glm-5.3-flash`) движок сам держит KV-cache префиксов;
- повторный байт-в-байт одинаковый префикс идёт как **cache read** дешевле обычного input;
- цена — `pricing.input_cache_read` в `GET /v1/models` (ниже `pricing.input`);
- хиты видны в ответе: `usage.prompt_tokens_details.cached_tokens`.

В коде под это только порядок сообщений: стабильные правила (`src/lib/advisor/knowledge.ts`) — **первым** system-сообщением, меняющийся хвост (вопрос пользователя) — в конце. Отдельного `cache_control` / флага API нет и не нужно.

Что **не** сделано:

- `parseUsage` (`src/lib/advisor/usage.ts`) не читает `cached_tokens`;
- UI и прокси cache read не показывают;
- `scripts/near-ai-e2ee-probe.mjs` usage с cache не печатает;
- оценка цены в кредитах берёт только `input` / `output`, без `input_cache_read`.

Списание с кошелька идёт по факту через `inference-id` у NEAR AI: если был cache hit, экономия уже в их счёте, просто у нас не видна.

## Как проверить

Два запроса подряд с одним и тем же длинным system-префиксом. Смотри `usage`:

| Запрос | Ожидание |
|---|---|
| 1-й | `cached_tokens: 0` или `prompt_tokens_details: null` |
| 2-й (тот же system, другой user) | `cached_tokens > 0` — обычно почти весь префикс минус хвост |

Короткий промпт может не закешироваться (минимум — один внутренний cache block). Наш `knowledge.ts` сам по себе короткий (~1–2K символов) — для проверки префикс лучше раздуть.

```bash
# из корня репо, ключ в .env.local; без E2EE — так проще читать usage
node --input-type=module <<'EOF'
import fs from "node:fs";
const KEY = /^NEAR_AI_API_KEY=(.*)$/m.exec(fs.readFileSync(".env.local","utf8"))?.[1]?.trim();
if (!KEY) throw new Error("NEAR_AI_API_KEY empty");
const API = "https://cloud-api.near.ai/v1/chat/completions";
const system = "You are the Yield AI private advisor.\n".repeat(80);
const body = (user) => ({
  model: "z-ai/glm-5.3-flash",
  reasoning_effort: "low",
  stream: false,
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
});
async function once(user) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "x-no-aliasing": "true",
    },
    body: JSON.stringify(body(user)),
  });
  const j = await r.json();
  console.log(r.status, j.usage);
}
await once("Say one word: ping");
await once("Say one word: pong");
EOF
```

Параллельно: `GET https://cloud-api.near.ai/v1/models` → у `z-ai/glm-5.3-flash` поле `pricing.input_cache_read`.

## Правила, иначе хит не будет

- Префикс должен быть **байт-идентичным**. Любое изменение в начале messages сбрасывает cache с этой точки (даже переставленные ключи JSON или timestamp в system).
- Стабильное — в начале, меняющееся — в конце.
- Кеш живёт внутри TEE деплоя модели и со временем вытесняется; редкий трафик может остыть.
- Если во 2-м ответе снова `null`/`0` — смотри сырой `usage`: возможно, эта модель/деплой сейчас не отдаёт `cached_tokens`, а не баг нашего чата.
