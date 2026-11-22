import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BUNDLE_COMMAND, basedOnNext, describeInputs, readManifest, runGit } from "../lib/inputs.ts";
import { buildContracts, buildPages, writeBundle } from "./fixture.ts";

const CLI = path.resolve(import.meta.dirname, "..", "cli.ts");
const ROOT = "/site";
const MANIFEST = { schema: 6, package_version: "9.8.7", core_sha: "abc123" };

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf-8" }).trim();
}

function commit(cwd: string, name: string): string {
  writeFileSync(path.join(cwd, name), name);
  git(cwd, "add", name);
  git(cwd, "commit", "-m", name);
  return git(cwd, "rev-parse", "HEAD");
}

function repoWithRemotes(): { dir: string; main: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "docs-inputs-git-"));
  scratch.push(dir);
  git(dir, "init", "-q", "-b", "work");
  const main = commit(dir, "base");
  git(dir, "update-ref", "refs/remotes/origin/main", main);
  git(dir, "update-ref", "refs/remotes/origin/next", main);
  return { dir, main };
}

describe("describeInputs", () => {
  it("names the release pin with its version and core commit", () => {
    const lines = describeInputs({ inputs: `${ROOT}/release-pin`, repoRoot: ROOT, explicit: false, nextBased: false, manifest: MANIFEST });
    assert.deepEqual(lines, [`inputs: release pin at ${ROOT}/release-pin (version 9.8.7, core commit abc123)`]);
  });

  it("names the fetched bundle with its version and core commit", () => {
    const lines = describeInputs({ inputs: `${ROOT}/.site-inputs`, repoRoot: ROOT, explicit: true, nextBased: false, manifest: MANIFEST });
    assert.deepEqual(lines, [`inputs: fetched bundle at ${ROOT}/.site-inputs (version 9.8.7, core commit abc123)`]);
  });

  it("gives the CI command on a next-based branch with DOCS_INPUTS unset", () => {
    const lines = describeInputs({ inputs: `${ROOT}/release-pin`, repoRoot: ROOT, explicit: false, nextBased: true, manifest: MANIFEST });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^inputs: release pin /);
    assert.match(lines[1], /CI checks next against the newest certified core bundle/);
    assert.equal(lines[2], `to reproduce CI's result run: ${BUNDLE_COMMAND}`);
    assert.equal(BUNDLE_COMMAND, "npm run bundle:fetch && DOCS_INPUTS=.site-inputs npm run docs:check");
  });

  it("stays quiet about CI when the inputs were chosen explicitly or the branch is not next-based", () => {
    const base = { inputs: `${ROOT}/release-pin`, repoRoot: ROOT, manifest: MANIFEST };
    assert.equal(describeInputs({ ...base, explicit: true, nextBased: true }).length, 1);
    assert.equal(describeInputs({ ...base, explicit: false, nextBased: false }).length, 1);
  });

  it("labels other inputs and a missing manifest", () => {
    const [line] = describeInputs({ inputs: "/elsewhere", repoRoot: ROOT, explicit: true, nextBased: false, manifest: null });
    assert.equal(line, "inputs: custom inputs at /elsewhere (no readable manifest)");
  });
});

describe("basedOnNext", () => {
  it("is false when origin/next has no commit beyond origin/main", () => {
    const { dir } = repoWithRemotes();
    assert.equal(basedOnNext(runGit(dir)), false);
  });

  it("is true for a branch cut from a next that is ahead of main", () => {
    const { dir } = repoWithRemotes();
    const next = commit(dir, "next-only");
    git(dir, "update-ref", "refs/remotes/origin/next", next);
    commit(dir, "feature");
    assert.equal(basedOnNext(runGit(dir)), true);
  });

  it("is false for a branch cut from main while next is ahead", () => {
    const { dir } = repoWithRemotes();
    git(dir, "checkout", "-q", "-b", "from-main");
    commit(dir, "feature");
    git(dir, "checkout", "-q", "-b", "next-tip", "work");
    const next = commit(dir, "next-only");
    git(dir, "update-ref", "refs/remotes/origin/next", next);
    git(dir, "checkout", "-q", "from-main");
    assert.equal(basedOnNext(runGit(dir)), false);
  });

  it("is false without git history or an origin/next ref", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "docs-inputs-without-git-"));
    scratch.push(dir);
    assert.equal(basedOnNext(runGit(dir)), false);
    const { dir: repo } = repoWithRemotes();
    git(repo, "update-ref", "-d", "refs/remotes/origin/next");
    assert.equal(basedOnNext(runGit(repo)), false);
  });
});

describe("readManifest", () => {
  it("returns null when the manifest is absent", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "docs-inputs-manifest-"));
    scratch.push(dir);
    assert.equal(readManifest(dir), null);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(MANIFEST));
    assert.deepEqual(readManifest(dir), MANIFEST);
  });
});

describe("docs:check output", () => {
  it("prints the inputs it used, also when the check fails", () => {
    const inputs = writeBundle({ schema: 4, contracts: buildContracts(), pages: buildPages() });
    scratch.push(inputs);
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", CLI, "--inputs", inputs, "--docs", path.join(inputs, "docs")], {
      encoding: "utf-8",
      env: { ...process.env, DOCS_INPUTS: "" },
    });
    assert.match(result.stdout, new RegExp(`docs-contracts: inputs: custom inputs at ${inputs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(version `));
  });
});
