import { test } from "node:test";
import assert from "node:assert/strict";
import { attributionLines } from "./check-commit-msg.mjs";

test("agent co-author and session trailers are found", () => {
  assert.equal(attributionLines("fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n").length, 1);
  assert.equal(attributionLines("fix: x\n\nclaude-session: abc\n").length, 1);
});

test("human co-authors and comments are allowed", () => {
  assert.deepEqual(attributionLines("fix: x\n\nCo-Authored-By: Joe Harris <joeharris76@gmail.com>\n# Co-Authored-By: Claude <noreply@anthropic.com>\n"), []);
});
