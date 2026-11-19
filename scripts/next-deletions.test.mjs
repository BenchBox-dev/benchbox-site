import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatDeletions, nextDeletions } from "./next-deletions.mjs";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "next-deletions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: ENV, encoding: "utf8" });
  const write = (file, lines) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), lines.map((line) => `${line}\n`).join(""));
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  git("init", "-q", "-b", "main");
  return { dir, git, write, commit };
}

function deletionsOn(repo) {
  return nextDeletions({ cwd: repo.dir, next: "next", main: "main" });
}

test("a passage still on next and removed on main later is named", (t) => {
  const repo = scratch(t);
  repo.write("docs/guide.md", ["# Guide", "Released behaviour.", "Unreleased behaviour."]);
  repo.commit("base");
  repo.git("branch", "next");
  repo.write("docs/guide.md", ["# Guide", "Released behaviour."]);
  repo.commit("main removes the passage");
  repo.git("checkout", "-q", "next");
  repo.write("docs/other.md", ["Unrelated next work."]);
  repo.commit("next moves on");
  assert.deepEqual(deletionsOn(repo), [{ file: "docs/guide.md", deleted: 1 }]);
  assert.equal(formatDeletions(deletionsOn(repo)), "- `docs/guide.md`: 1 line(s) removed");
});

test("a merge where main only adds text names no file", (t) => {
  const repo = scratch(t);
  repo.write("docs/guide.md", ["# Guide", "Released behaviour."]);
  repo.commit("base");
  repo.git("branch", "next");
  repo.write("docs/guide.md", ["# Guide", "Released behaviour.", "A new released note."]);
  repo.write("blog/post.md", ["A new post."]);
  repo.commit("main adds");
  assert.deepEqual(deletionsOn(repo), []);
  assert.equal(formatDeletions([]), "");
});

test("text that only next added survives the merge and is not named", (t) => {
  const repo = scratch(t);
  repo.write("docs/guide.md", ["# Guide", "Released behaviour."]);
  repo.commit("base");
  repo.git("branch", "next");
  repo.write("docs/index.md", ["Index."]);
  repo.commit("main touches another file");
  repo.git("checkout", "-q", "next");
  repo.write("docs/guide.md", ["# Guide", "Released behaviour.", "Unreleased behaviour."]);
  repo.commit("next adds");
  assert.deepEqual(deletionsOn(repo), []);
});

test("conflicting files are left to the conflict list and files outside docs and blog are ignored", (t) => {
  const repo = scratch(t);
  repo.write("docs/guide.md", ["# Guide", "Shared line."]);
  repo.write("docs/kept.md", ["One.", "Two."]);
  repo.write("website/page.ts", ["export const a = 1;", "export const b = 2;"]);
  repo.commit("base");
  repo.git("branch", "next");
  repo.write("docs/guide.md", ["# Guide", "Main's wording."]);
  repo.write("docs/kept.md", ["One."]);
  repo.write("website/page.ts", ["export const a = 1;"]);
  repo.commit("main edits");
  repo.git("checkout", "-q", "next");
  repo.write("docs/guide.md", ["# Guide", "Next's wording."]);
  repo.commit("next edits");
  assert.deepEqual(deletionsOn(repo), [{ file: "docs/kept.md", deleted: 1 }]);
});

test("the merge writes no ref", (t) => {
  const repo = scratch(t);
  repo.write("docs/guide.md", ["# Guide", "Line."]);
  repo.commit("base");
  repo.git("branch", "next");
  repo.write("docs/guide.md", ["# Guide"]);
  repo.commit("main removes");
  const before = repo.git("for-each-ref", "--format=%(refname) %(objectname)");
  deletionsOn(repo);
  assert.equal(repo.git("for-each-ref", "--format=%(refname) %(objectname)"), before);
});
