// Run with `pnpm test` (Node's built-in runner; Node 22.18+ strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { latestImagesOnly } from "./images.ts";

const img = (url: string) => ({ type: "image_url" as const, image_url: { url } });

test("only the latest user message keeps its pictures", () => {
  const out = latestImagesOnly([
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "text" as const, text: "what is this?" }, img("data:a")] },
    { role: "assistant", content: "a chart" },
    { role: "user", content: [img("data:b"), img("data:c")] },
    { role: "assistant", content: "two charts" },
    { role: "user", content: "thanks" },
  ]);
  assert.equal(out[1].content, "what is this? [1 image shared earlier]");
  assert.deepEqual(out[3].content, [img("data:b"), img("data:c")]);
  assert.equal(out[5].content, "thanks");
  assert.equal(out[0].content, "rules");
});

test("a picture-only message becomes a note", () => {
  const out = latestImagesOnly([
    { role: "user", content: [img("data:a"), img("data:b")] },
    { role: "user", content: [img("data:c")] },
  ]);
  assert.equal(out[0].content, "[2 images shared earlier]");
});
