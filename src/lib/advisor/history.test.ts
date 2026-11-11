// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { historyFromUiMessages } from "./history.ts";
import { ADVISOR_SYSTEM_PROMPT } from "./knowledge.ts";
import { seedHistoryForMode } from "./modes.ts";

test("seedHistoryForMode: system prompt only in advisor mode", () => {
  assert.deepEqual(seedHistoryForMode("advisor"), [
    { role: "system", content: ADVISOR_SYSTEM_PROMPT },
  ]);
  assert.deepEqual(seedHistoryForMode("free"), []);
});

test("historyFromUiMessages: advisor keeps system prompt first", () => {
  const history = historyFromUiMessages([{ id: "1", role: "user", content: "hi" }], "advisor");
  assert.deepEqual(history[0], { role: "system", content: ADVISOR_SYSTEM_PROMPT });
  assert.deepEqual(history[1], { role: "user", content: "hi" });
});

test("historyFromUiMessages: free has no system prompt", () => {
  const history = historyFromUiMessages(
    [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi there" },
    ],
    "free"
  );
  assert.deepEqual(history, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ]);
});
