import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { statusDescription } from "../lib/receipt.ts";
import { receipt } from "./helpers.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./fixtures/resolve-stub.mjs", import.meta.url));

const deployedCore = "a".repeat(40);
const candidateCore = "b".repeat(40);
const deployedSite = "5".repeat(40);
const newSite = "6".repeat(40);
const deployedDigest = `sha256:${"d".repeat(64)}`;
const candidateDigest = `sha256:${"9".repeat(64)}`;

const deployedReceipt = receipt({ core_sha: deployedCore, site_sha: deployedSite, bundle_digest: deployedDigest, run_id: "100", target: "rehearsal" });
const candidate = { core_sha: candidateCore, corpus_sha: "c".repeat(40), digest: candidateDigest };
const deployedBundle = { core_sha: deployedCore, corpus_sha: "c".repeat(40), digest: deployedDigest };

type Run = {
  status: number | null;
  stderr: string;
  stdout: string;
  githubOutput: string;
  fetches: { core_sha: string; run_id: string; digest: string }[];
  resolution: { core_sha: string; bundle_digest: string; deployed: { core_sha: string } | null } | null;
  workFiles: { resolve: boolean; report: boolean };
};

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function resolveRun(options: {
  mode?: string;
  siteSha?: string;
  deployed?: boolean;
  compare?: string;
  deployedBundle?: typeof deployedBundle;
}): Run {
  const directory = mkdtempSync(path.join(tmpdir(), "resolve-cli-"));
  directories.push(directory);
  const work = path.join(directory, "work");
  const fetchLog = path.join(directory, "fetches.jsonl");
  const githubOutput = path.join(directory, "output");
  writeFileSync(fetchLog, "");
  writeFileSync(githubOutput, "");
  const scenarioFile = path.join(directory, "scenario.json");
  writeFileSync(
    scenarioFile,
    JSON.stringify({
      deployments: options.deployed === false ? [] : [{ id: 1, description: statusDescription(deployedReceipt) }],
      compare: options.compare,
      candidate,
      deployedBundle: options.deployedBundle ?? deployedBundle,
      receipts: { "100": deployedReceipt },
      fetchLog,
    }),
  );
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--import", stub, path.join(root, "deploy/cli.ts"), "resolve"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      RESOLVE_SCENARIO: scenarioFile,
      DEPLOY_WORK: work,
      SITE_INPUTS: path.join(directory, "site-inputs"),
      GITHUB_OUTPUT: githubOutput,
      GITHUB_SHA: options.siteSha ?? newSite,
      GITHUB_REPOSITORY: "BenchBox-dev/benchbox-site",
      GH_TOKEN: "token",
      SITE_DEPLOY_TARGET: "rehearsal",
      DEPLOY_MODE: options.mode ?? "deploy",
      SITE_INPUTS_RUN_ID: "999",
      SITE_INPUTS_DIGEST: candidateDigest,
    },
  });
  const resolvePath = path.join(work, "resolve.json");
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    githubOutput: readFileSync(githubOutput, "utf8"),
    fetches: readFileSync(fetchLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    resolution: existsSync(resolvePath) ? JSON.parse(readFileSync(resolvePath, "utf8")) : null,
    workFiles: { resolve: existsSync(resolvePath), report: existsSync(path.join(work, "gates.json")) },
  };
}

test("behind with the deployed site commit is superseded and writes no work", () => {
  const run = resolveRun({ compare: "behind", siteSha: deployedSite });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.githubOutput, /^superseded=true$/m);
  assert.doesNotMatch(run.githubOutput, /core_sha=/);
  assert.equal(run.workFiles.resolve, false);
  assert.equal(run.workFiles.report, false);
  assert.equal(run.fetches.length, 1);
});

test("behind with a new site commit re-fetches the deployed bundle by core_sha with run id cleared", () => {
  const run = resolveRun({ compare: "behind" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.fetches[1], { core_sha: deployedCore, run_id: "", digest: deployedDigest });
  assert.equal(run.resolution?.core_sha, deployedCore);
  assert.equal(run.resolution?.bundle_digest, deployedDigest);
  assert.match(run.githubOutput, new RegExp(`^core_sha=${deployedCore}$`, "m"));
  assert.doesNotMatch(run.githubOutput, /superseded/);
});

test("behind with a new site commit fails closed when the deployed bundle digest differs from the receipt", () => {
  const run = resolveRun({ compare: "behind", deployedBundle: { ...deployedBundle, digest: candidateDigest } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /does not match the receipt's bundle_digest/);
  assert.equal(run.workFiles.resolve, false);
});

test("redeploy fetches the deployed bundle by core_sha with run id cleared and never compares", () => {
  const run = resolveRun({ mode: "redeploy", compare: "diverged" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.fetches, [{ core_sha: deployedCore, run_id: "", digest: deployedDigest }]);
  assert.equal(run.resolution?.core_sha, deployedCore);
  assert.equal(run.resolution?.deployed?.core_sha, deployedCore);
});

test("redeploy without a deployed receipt fails with the named error", () => {
  const run = resolveRun({ mode: "redeploy", deployed: false });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /redeploy needs a deployed receipt for target rehearsal and found none/);
  assert.deepEqual(run.fetches, []);
  assert.equal(run.workFiles.resolve, false);
});

test("an ahead candidate and a first deploy resolve the fetched candidate bundle", () => {
  for (const run of [resolveRun({ compare: "ahead" }), resolveRun({ deployed: false })]) {
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.fetches, [{ core_sha: "", run_id: "999", digest: candidateDigest }]);
    assert.equal(run.resolution?.core_sha, candidateCore);
    assert.equal(run.resolution?.bundle_digest, candidateDigest);
  }
});
