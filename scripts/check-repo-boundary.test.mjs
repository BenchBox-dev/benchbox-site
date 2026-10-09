import { test } from "node:test";
import assert from "node:assert/strict";
import { findingsFor } from "./check-repo-boundary.mjs";

test("Python files and Python or uv calls are refused", () => {
  assert.equal(findingsFor("tools/x.py", "print(1)\n").length, 1);
  assert.equal(findingsFor("uv.lock", "").length, 1);
  assert.equal(findingsFor("website/src/a.ts", 'spawnSync("uv", ["run"]);\n').length, 1);
  assert.equal(findingsFor("website/package.json", JSON.stringify({ scripts: { gen: "python3 -m gen" } })).length, 1);
  assert.deepEqual(findingsFor("website/package.json", JSON.stringify({ scripts: { build: "astro build" } })), []);
});

test("paths that leave the repository or name the old core layout are refused", () => {
  assert.equal(findingsFor("website/src/lib/a.ts", 'import x from "../../../../outside/file.ts";\n').length, 1);
  assert.deepEqual(findingsFor("website/src/lib/a.ts", 'import x from "../../../landing/shared/site.css";\n'), []);
  assert.equal(findingsFor("website/src/a.ts", 'const p = "results-explorer/dist";\n').length, 1);
  assert.equal(findingsFor("website/src/a.ts", 'const p = path.join(root, "_project/x");\n').length, 1);
});

test("the production origin is allowed only on the allowlist", () => {
  assert.equal(findingsFor("website/src/lib/a.ts", 'const o = "https://benchbox.dev";\n').length, 1);
  assert.deepEqual(findingsFor("blog/post.md", "see https://benchbox.dev\n"), []);
  assert.deepEqual(findingsFor("website/src/lib/site-origin.ts", 'const o = "https://benchbox.dev";\n'), []);
});
