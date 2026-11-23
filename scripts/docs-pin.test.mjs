import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memberDigest, membersFor } from "./bundle-lib.mjs";
import { checkPin, checkPinOffline, earliestProduction, pendingStatus, pinArguments, pinRelease } from "./docs-pin.mjs";

const COMMIT = "d".repeat(40);
const OTHER = "e".repeat(40);
const RUN_ID = "4242";
const PASSING = ["privacy", "explorer_compat", "snapshot_invariants", "corpus_bijection", "validator_parity"].map((name) => ({ name, result: "pass", inputs: { a: 1 } }));
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const SOURCE_RUN = 7001;
const production = (coreSha, id = SOURCE_RUN, createdAt = "2026-11-05T21:41:30Z") => ({
  name: `site-inputs-${coreSha}`,
  expired: false,
  created_at: createdAt,
  workflow_run: { id, head_branch: "develop" },
});
const sameManifest = (bundle) => () => readFileSync(path.join(bundle, "manifest.json"));
const SITE_INPUTS_RUN = { path: ".github/workflows/site-inputs.yml", event: "workflow_run", head_branch: "develop", conclusion: "success", repository: { full_name: "BenchBox-dev/benchbox" } };

function stubApi({ release = { draft: false, prerelease: false, tag_name: "v1.2.3" }, commit = COMMIT, releases = [{ tag_name: "v1.2.3" }], fail = false, run = { path: ".github/workflows/trunk.yml", event: "push", head_branch: "develop", conclusion: "success", head_sha: COMMIT }, runFails = false, productions = [], runs = {}, runArtifacts = [] } = {}) {
  const knownRuns = { [SOURCE_RUN]: SITE_INPUTS_RUN, 7002: SITE_INPUTS_RUN, ...runs };
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    if (route.includes("/actions/artifacts?name=")) return { ok: true, json: async () => ({ artifacts: productions }) };
    if (route.includes("/actions/runs/")) {
      if (runFails) return { ok: false, status: 500, json: async () => ({}) };
      const [, id, artifacts] = route.match(/\/actions\/runs\/(\d+)(\/artifacts)?/);
      return { ok: true, json: async () => (artifacts ? { artifacts: runArtifacts } : (knownRuns[id] ?? run)) };
    }
    if (route.includes("/releases/tags/")) {
      return release ? { ok: true, json: async () => release } : { ok: false, status: 404, json: async () => ({}) };
    }
    if (route.includes("/commits/")) return { ok: true, json: async () => ({ sha: commit }) };
    if (route.includes("/releases?")) return { ok: true, json: async () => releases };
    throw new Error(`unexpected route ${route}`);
  };
}

function fixtureDir(prefix, { coreSha = COMMIT, version = "1.2.3", docsData = "{}\n", certifiedBy = RUN_ID, attestations = PASSING } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  for (const member of membersFor(5)) {
    const target = path.join(root, member);
    mkdirSync(path.dirname(target), { recursive: true });
    if (member === "docs-data") {
      mkdirSync(target);
      writeFileSync(path.join(target, "docs-data.json"), docsData);
    } else if (member === "attestations.json") writeFileSync(target, JSON.stringify(attestations));
    else if (member === "doc-contracts.json") writeFileSync(target, '{"c":1}\n');
    else if (member === "repo-files.json") writeFileSync(target, '{"r":1}\n');
    else if (member.endsWith(".json") || member.endsWith(".duckdb")) writeFileSync(target, `${member}\n`);
    else {
      mkdirSync(target);
      writeFileSync(path.join(target, "f.txt"), `${member}\n`);
    }
  }
  const members = Object.fromEntries(membersFor(5).map((member) => [member, memberDigest(path.join(root, member))]));
  const manifest = { schema: 5, core_sha: coreSha, parent_core_sha: OTHER, corpus_sha: "c", package_version: version, certified_by: certifiedBy, members };
  writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
  return root;
}

const newPinDir = () => path.join(mkdtempSync(path.join(tmpdir(), "docs-pin-test-")), "release-pin");

async function pinned() {
  stubApi({ productions: [production(COMMIT)] });
  const pinDir = newPinDir();
  const bundle = fixtureDir("bundle-");
  await pinRelease("v1.2.3", { from: bundle, pinDir, readManifest: sameManifest(bundle) });
  return pinDir;
}

test("pinning writes the pin layout and the manifest byte for byte", async () => {
  const bundle = fixtureDir("bundle-");
  stubApi({ productions: [production(COMMIT)] });
  const pinDir = newPinDir();
  const pin = await pinRelease("v1.2.3", { from: bundle, pinDir, readManifest: sameManifest(bundle) });
  assert.deepEqual(pin, { tag: "v1.2.3", core_sha: COMMIT, site_inputs_run: String(SOURCE_RUN) });
  assert.deepEqual(JSON.parse(readFileSync(path.join(pinDir, "pin.json"), "utf8")), pin);
  assert.equal(readFileSync(path.join(pinDir, "manifest.json"), "utf8"), readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  assert.ok(existsSync(path.join(pinDir, "docs-data", "docs-data.json")));
  assert.deepEqual(checkPinOffline(pinDir).errors, []);
});

test("pinning without --from fetches the bundle for the tag commit and records its run", async () => {
  stubApi();
  const calls = [];
  const pinDir = newPinDir();
  const pin = await pinRelease("v1.2.3", {
    pinDir,
    fetchBundle: (destination, commit) => {
      calls.push(commit);
      cpSync(fixtureDir("bundle-"), destination, { recursive: true });
      writeFileSync(path.join(destination, ".fetched.json"), JSON.stringify({ runId: "5001" }));
    },
  });
  assert.deepEqual(calls, [COMMIT]);
  assert.deepEqual(pin, { tag: "v1.2.3", core_sha: COMMIT, site_inputs_run: "5001" });
  assert.deepEqual(JSON.parse(readFileSync(path.join(pinDir, "pin.json"), "utf8")), pin);
  assert.deepEqual(checkPinOffline(pinDir).errors, []);
  assert.ok(!existsSync(path.join(pinDir, ".fetched.json")));
});

test("the earliest production of a commit is pinned whatever the listing order", () => {
  const automatic = { created_at: "2026-11-05T21:41:00Z", workflow_run: { id: 42114319044 } };
  const dispatched = { created_at: "2026-11-13T20:12:00Z", workflow_run: { id: 43498628032 } };
  const sameTime = { created_at: "2026-11-05T21:41:00Z", workflow_run: { id: 42114319050 } };
  assert.equal(earliestProduction([automatic, dispatched]), automatic);
  assert.equal(earliestProduction([dispatched, automatic]), automatic);
  assert.equal(earliestProduction([sameTime, dispatched, automatic]), automatic);
  assert.equal(earliestProduction([]), undefined);
});

test("a pin whose site_inputs_run is not a run id fails the check", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "pin.json"), JSON.stringify({ tag: "v1.2.3", core_sha: COMMIT, site_inputs_run: "latest" }));
  assert.deepEqual(checkPinOffline(pinDir).errors, ["pin site_inputs_run latest is not a run id"]);
});

test("a draft release is refused", async () => {
  stubApi({ release: { draft: true, prerelease: false } });
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir: newPinDir() }), /draft/);
});

test("a prerelease is refused", async () => {
  stubApi({ release: { draft: false, prerelease: true } });
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir: newPinDir() }), /prerelease/);
});

test("a missing release is refused", async () => {
  stubApi({ release: null });
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir: newPinDir() }), /not found/);
});

test("a tag commit that differs from the manifest core_sha is refused", async () => {
  stubApi({ commit: OTHER });
  const pinDir = newPinDir();
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir }), /core_sha/);
  assert.equal(existsSync(pinDir), false);
});

test("a package_version that differs from the tag is refused", async () => {
  stubApi();
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-", { version: "1.2.4" }), pinDir: newPinDir() }), /package_version/);
});

test("a member digest mismatch is refused and leaves the existing pin intact", async () => {
  const pinDir = await pinned();
  const before = readFileSync(path.join(pinDir, "pin.json"), "utf8");
  const bundle = fixtureDir("bundle-");
  writeFileSync(path.join(bundle, "docs-data", "docs-data.json"), '{"tampered":true}\n');
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir }), /docs-data does not match/);
  assert.equal(readFileSync(path.join(pinDir, "pin.json"), "utf8"), before);
  assert.deepEqual(checkPinOffline(pinDir).errors, []);
});

test("repinning replaces the pin", async () => {
  const pinDir = await pinned();
  stubApi({ commit: OTHER, productions: [production(OTHER)], run: { path: ".github/workflows/trunk.yml", event: "push", head_branch: "develop", conclusion: "success", head_sha: OTHER } });
  const bundle = fixtureDir("bundle-", { coreSha: OTHER });
  await pinRelease("v1.2.3", { from: bundle, pinDir, readManifest: sameManifest(bundle) });
  assert.equal(JSON.parse(readFileSync(path.join(pinDir, "pin.json"), "utf8")).core_sha, OTHER);
});

test("--check --offline names a tampered member", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "docs-data", "docs-data.json"), '{"tampered":true}\n');
  const errors = await checkPin(pinDir, { offline: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs-data/);
});

test("--check --offline fails on a tampered contract member", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "doc-contracts.json"), "{}\n");
  assert.match((await checkPin(pinDir, { offline: true }))[0], /doc-contracts\.json/);
});

test("--check --offline fails on a stray file", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "extra.txt"), "x");
  assert.deepEqual(await checkPin(pinDir, { offline: true }), ["unexpected file extra.txt"]);
});

test("--check --offline fails on a missing or empty pin", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "pin.json"), "{}");
  assert.ok((await checkPin(newPinDir(), { offline: true })).length > 0);
  assert.ok((await checkPin(pinDir, { offline: true })).length > 0);
});

test("--check --offline fails when pin and manifest disagree", async () => {
  const pinDir = await pinned();
  writeFileSync(path.join(pinDir, "pin.json"), JSON.stringify({ tag: "v1.2.4", core_sha: OTHER }));
  const errors = await checkPin(pinDir, { offline: true });
  assert.ok(errors.some((error) => error.includes("core_sha")));
  assert.ok(errors.some((error) => error.includes("package_version")));
});

test("online --check passes for a published release at the pinned commit", async () => {
  const pinDir = await pinned();
  stubApi();
  assert.deepEqual(await checkPin(pinDir), []);
});

test("online --check refuses a draft, a prerelease and a moved tag", async () => {
  const pinDir = await pinned();
  stubApi({ release: { draft: true } });
  assert.match((await checkPin(pinDir))[0], /draft/);
  stubApi({ release: { prerelease: true } });
  assert.match((await checkPin(pinDir))[0], /prerelease/);
  stubApi({ commit: OTHER });
  assert.match((await checkPin(pinDir))[0], /pin has/);
});

test("online --check fails closed on an API error", async () => {
  const pinDir = await pinned();
  stubApi({ fail: true });
  const errors = await checkPin(pinDir);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /500/);
});

test("--pending exits 0 when the pin is the latest release", async () => {
  const pinDir = await pinned();
  stubApi();
  assert.equal((await pendingStatus(pinDir)).code, 0);
});

test("--pending exits 1 naming both tags when a newer release exists", async () => {
  const pinDir = await pinned();
  stubApi({ releases: [{ tag_name: "v1.2.3" }, { tag_name: "v1.10.0" }, { tag_name: "v1.9.0" }] });
  const result = await pendingStatus(pinDir);
  assert.equal(result.code, 1);
  assert.match(result.message, /v1\.10\.0/);
  assert.match(result.message, /v1\.2\.3/);
});

test("--pending exits 2 on an API error", async () => {
  const pinDir = await pinned();
  stubApi({ fail: true });
  assert.equal((await pendingStatus(pinDir)).code, 2);
});

test("the tag is read with and without --from and --expired-run, in any order", () => {
  assert.deepEqual(pinArguments(["v1.2.3"]), { tag: "v1.2.3", from: undefined, expiredRun: undefined, valid: true });
  assert.deepEqual(pinArguments(["v1.2.3", "--from", "dir"]), { tag: "v1.2.3", from: "dir", expiredRun: undefined, valid: true });
  assert.deepEqual(pinArguments(["--from", "dir", "v1.2.3"]), { tag: "v1.2.3", from: "dir", expiredRun: undefined, valid: true });
  assert.deepEqual(pinArguments(["--expired-run", "6001", "--from", "dir", "v1.2.3"]), { tag: "v1.2.3", from: "dir", expiredRun: "6001", valid: true });
  assert.equal(pinArguments(["--from", "dir"]).valid, false);
  assert.equal(pinArguments(["v1.2.3", "--from"]).valid, false);
  assert.equal(pinArguments(["v1.2.3", "--expired-run", "6001"]).valid, false);
  assert.equal(pinArguments(["v1.2.3", "--from", "dir", "--expired-run"]).valid, false);
  assert.equal(pinArguments(["v1.2.3", "--from", "--expired-run", "6001"]).valid, false);
  assert.equal(pinArguments([]).valid, false);
});

test("--pending ignores drafts, prereleases, data releases and releases older than the pin", async () => {
  const pinDir = await pinned();
  stubApi({
    releases: [
      { tag_name: "data/joinorder-imdb-2013-v1" },
      { tag_name: "v2.0.0", draft: true },
      { tag_name: "v1.3.0", prerelease: true },
      { tag_name: "v1.3.0rc1" },
    ],
  });
  assert.equal((await pendingStatus(pinDir)).code, 2);
  stubApi({ releases: [{ tag_name: "data/joinorder-imdb-2013-v1" }, { tag_name: "v1.2.2" }, { tag_name: "v1.2.3" }] });
  assert.equal((await pendingStatus(pinDir)).code, 0);
  stubApi({ releases: [{ tag_name: "v1.2.2" }] });
  assert.equal((await pendingStatus(pinDir)).code, 0);
});

test("--from refuses a candidate bundle", async () => {
  stubApi();
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-", { certifiedBy: "candidate" }), pinDir: newPinDir() }), /not a run id/);
});

test("--from refuses a run that is not a successful trunk push on develop for the commit", async () => {
  const good = { path: ".github/workflows/trunk.yml", event: "push", head_branch: "develop", conclusion: "success", head_sha: COMMIT };
  for (const [run, pattern] of [
    [{ ...good, path: ".github/workflows/other.yml" }, /not trunk\.yml/],
    [{ ...good, event: "pull_request" }, /not push/],
    [{ ...good, head_branch: "main" }, /not develop/],
    [{ ...good, conclusion: "failure" }, /concluded failure/],
    [{ ...good, head_sha: OTHER }, /different commit/],
    [null, /not found/],
  ]) {
    stubApi({ run });
    await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir: newPinDir() }), pattern);
  }
});

test("--from refuses a failed, skipped or missing required attestation", async () => {
  stubApi();
  const failed = PASSING.map((entry) => (entry.name === "privacy" ? { ...entry, result: "fail" } : entry));
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-", { attestations: failed }), pinDir: newPinDir() }), /privacy failed/);
  const skipped = PASSING.map((entry) => (entry.name === "corpus_bijection" ? { name: entry.name, result: "skip", reason: "x" } : entry));
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-", { attestations: skipped }), pinDir: newPinDir() }), /corpus_bijection was skipped/);
  const missing = PASSING.filter((entry) => entry.name !== "explorer_compat");
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-", { attestations: missing }), pinDir: newPinDir() }), /explorer_compat is missing/);
  const bundle = fixtureDir("bundle-");
  rmSync(path.join(bundle, "attestations.json"));
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir() }), /attestations\.json/);
});

test("--from refuses a wrong digest on a member that is not pinned", async () => {
  stubApi();
  const bundle = fixtureDir("bundle-");
  writeFileSync(path.join(bundle, "explorer", "contract.json"), "tampered\n");
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir() }), /explorer\/contract\.json does not match/);
});

test("--from refuses a directory without the full member set", async () => {
  stubApi();
  const bundle = fixtureDir("bundle-");
  const manifest = JSON.parse(readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  delete manifest.members["explorer/fixtures"];
  writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir() }), /member set mismatch/);
});

test("--from refuses each missing or malformed manifest field", async () => {
  const cases = [
    ...["core_sha", "parent_core_sha", "corpus_sha", "package_version", "certified_by"].map((field) => [
      `missing ${field}`,
      (manifest) => delete manifest[field],
      `manifest field ${field} is missing`,
    ]),
    ...["core_sha", "parent_core_sha"].map((field) => [
      `short ${field}`,
      (manifest) => (manifest[field] = manifest[field].slice(0, 7)),
      `${field} is not a full commit SHA`,
    ]),
    ["unsupported schema", (manifest) => (manifest.schema = 99), "schema 99 is not supported"],
  ];
  for (const [name, corrupt, refusal] of cases) {
    stubApi();
    const bundle = fixtureDir("bundle-");
    const manifest = JSON.parse(readFileSync(path.join(bundle, "manifest.json"), "utf8"));
    corrupt(manifest);
    writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir() }), (error) => error.message.includes(refusal), name);
  }
});

test("--from fails closed when the certification lookup errors", async () => {
  stubApi({ runFails: true });
  await assert.rejects(pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir: newPinDir() }), /failed closed/);
});

test("--from accepts a certified complete directory whose doc-contracts would fail schema validation", async () => {
  stubApi({ productions: [production(COMMIT)] });
  const bundle = fixtureDir("bundle-");
  const pin = await pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest: sameManifest(bundle) });
  assert.deepEqual(pin, { tag: "v1.2.3", core_sha: COMMIT, site_inputs_run: String(SOURCE_RUN) });
});

test("--from refuses a directory whose manifest is not that of core's bundle, and records the bundle it matches", async () => {
  const bundle = fixtureDir("bundle-");
  const other = Buffer.from("{}");
  const productions = [production(COMMIT, 7002, "2026-11-13T20:12:45Z"), production(COMMIT, 7001)];
  stubApi({ productions });
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest: () => other }), /not byte for byte the manifest of core's bundle of d+ from run 7001, 7002/);
  const read = [];
  const second = (item) => (read.push(item.workflow_run.id), item.workflow_run.id === 7002 ? readFileSync(path.join(bundle, "manifest.json")) : other);
  const pin = await pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest: second });
  assert.equal(pin.site_inputs_run, "7002");
  assert.deepEqual(read, [7001, 7002]);
});

test("--from needs --expired-run once core's bundles have expired, and checks the named run", async () => {
  const bundle = fixtureDir("bundle-");
  const sourceRun = SITE_INPUTS_RUN;
  const produced = [{ name: `site-inputs-${COMMIT}`, expired: true }];
  const attempt = (stub, expiredRun) => {
    stubApi({ productions: [], ...stub });
    return pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), expiredRun, readManifest: () => assert.fail("an expired bundle cannot be downloaded") });
  };
  await assert.rejects(attempt({}), /have expired.*--expired-run <id>/);
  await assert.rejects(attempt({ runs: { 6001: sourceRun }, runArtifacts: produced }, "latest"), /--expired-run latest is not a run id/);
  await assert.rejects(attempt({ runs: { 6001: { ...sourceRun, conclusion: "failure" } }, runArtifacts: produced }, "6001"), /run 6001: producing run concluded failure/);
  await assert.rejects(attempt({ runs: { 6001: sourceRun }, runArtifacts: [{ name: `site-inputs-${OTHER}`, expired: true }] }, "6001"), /run 6001 produced no bundle named site-inputs-d+/);
  const pin = await attempt({ runs: { 6001: sourceRun }, runArtifacts: produced }, "6001");
  assert.equal(pin.site_inputs_run, "6001");
  stubApi({ productions: [production(COMMIT)] });
  await assert.rejects(
    pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), expiredRun: "6001", readManifest: sameManifest(bundle) }),
    /has not expired; --expired-run is only for/,
  );
});

test("--from skips a bundle whose run is not a successful site-inputs run", async () => {
  const bundle = fixtureDir("bundle-");
  const read = [];
  const readManifest = (item) => (read.push(item.workflow_run.id), readFileSync(path.join(bundle, "manifest.json")));
  const productions = [production(COMMIT, 7001), production(COMMIT, 7002, "2026-11-13T20:12:45Z")];
  stubApi({ productions, runs: { 7001: { ...SITE_INPUTS_RUN, conclusion: "failure" } } });
  const pin = await pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest });
  assert.equal(pin.site_inputs_run, "7002");
  assert.deepEqual(read, [7002]);
  stubApi({ productions: [production(COMMIT, 7001)], runs: { 7001: { ...SITE_INPUTS_RUN, conclusion: "failure" } } });
  await assert.rejects(pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest }), /run 7001: producing run concluded failure/);
});

test("--from refuses a symlink inside a pinned member", async () => {
  const bundle = fixtureDir("bundle-");
  symlinkSync(path.join(bundle, "repo-files.json"), path.join(bundle, "docs-data", "extra.json"));
  stubApi({ productions: [production(COMMIT)] });
  await assert.rejects(
    pinRelease("v1.2.3", { from: bundle, pinDir: newPinDir(), readManifest: sameManifest(bundle) }),
    /docs-data\/extra\.json is not a regular file or directory/,
  );
});
