import { test } from "node:test";
import assert from "node:assert/strict";
import { findComments } from "./check-comments.mjs";

test("explanatory comments are found in scripts and markup", () => {
  assert.equal(findComments("a.ts", "const a = 1; // explain\n").length, 1);
  assert.equal(findComments("a.ts", "/* block */\nconst a = 1;\n").length, 1);
  assert.equal(findComments("a.astro", "---\n// frontmatter note\nconst a = 1;\n---\n<div />\n").length, 1);
  assert.equal(findComments("a.html", "<div><!-- note --></div>\n").length, 1);
});

test("strings, templates and regular expressions are not comments", () => {
  assert.deepEqual(findComments("a.ts", "const url = `http://${host}/x`;\nconst re = /a\\/\\//;\n"), []);
});

test("tool directives are allowed", () => {
  const source = "// @vitest-environment node\n// eslint-disable-next-line\n// @ts-expect-error\nconst a: number = 'x';\n";
  assert.deepEqual(findComments("a.ts", source), []);
});
