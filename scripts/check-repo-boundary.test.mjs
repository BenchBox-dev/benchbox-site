import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  assert.deepEqual(findingsFor("scripts/schemas/docs-data.schema.json", `{"$id": "https://benchbox.dev/schemas/docs-data.schema.json"}\n`), []);
  assert.equal(findingsFor("scripts/other.json", `{"$id": "https://benchbox.dev/x"}\n`).length, 1);
});

test("tracked file deletions do not bypass checks on surviving files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-boundary-"));
  const script = fileURLToPath(new URL("./check-repo-boundary.mjs", import.meta.url));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(path.join(root, "removed.md"), "# Old draft\n");
    writeFileSync(path.join(root, "kept.ts"), "export const value = 1;\n");
    execFileSync("git", ["add", "removed.md", "kept.ts"], { cwd: root });
    unlinkSync(path.join(root, "removed.md"));
    const clean = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);
    writeFileSync(path.join(root, "kept.ts"), 'export const origin = "https://benchbox.dev";\n');
    const invalid = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stdout, /kept\.ts:/);
    const sub = path.join(root, "sub");
    mkdirSync(sub, { recursive: true });
    const fromSubdir = spawnSync(process.execPath, [script], { cwd: sub, encoding: "utf8" });
    assert.equal(fromSubdir.status, 1, fromSubdir.stderr);
    assert.match(fromSubdir.stdout, /kept\.ts:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function stagedRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-boundary-staged-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(path.join(root, "kept.ts"), "export const value = 1;\n");
  execFileSync("git", ["add", "kept.ts"], { cwd: root });
  return root;
}

const violation = 'export const origin = "https://benchbox.dev";\n';

test("a staged violation is caught even when the worktree copy is clean", () => {
  const root = stagedRepository();
  const script = fileURLToPath(new URL("./check-repo-boundary.mjs", import.meta.url));
  try {
    writeFileSync(path.join(root, "kept.ts"), violation);
    execFileSync("git", ["add", "kept.ts"], { cwd: root });
    writeFileSync(path.join(root, "kept.ts"), "export const value = 1;\n");
    const staged = spawnSync(process.execPath, [script, "--staged"], { cwd: root, encoding: "utf8" });
    assert.equal(staged.status, 1, staged.stderr);
    assert.match(staged.stdout, /kept\.ts:/);
    const worktree = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(worktree.status, 0, worktree.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a worktree-only fix does not hide a staged violation, and unstaged edits do not fail the staged check", () => {
  const root = stagedRepository();
  const script = fileURLToPath(new URL("./check-repo-boundary.mjs", import.meta.url));
  try {
    writeFileSync(path.join(root, "kept.ts"), violation);
    const staged = spawnSync(process.execPath, [script, "--staged"], { cwd: root, encoding: "utf8" });
    assert.equal(staged.status, 0, staged.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untracked files are scanned in the default mode and ignored files are not", () => {
  const root = stagedRepository();
  const script = fileURLToPath(new URL("./check-repo-boundary.mjs", import.meta.url));
  try {
    writeFileSync(path.join(root, ".gitignore"), "ignored.ts\n");
    writeFileSync(path.join(root, "ignored.ts"), violation);
    const ignored = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(ignored.status, 0, ignored.stdout);
    writeFileSync(path.join(root, "loose.ts"), violation);
    const loose = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(loose.status, 1, loose.stdout);
    assert.match(loose.stdout, /loose\.ts:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
