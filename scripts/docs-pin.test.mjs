import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memberDigest } from "./bundle-lib.mjs";
import { checkPin, checkPinOffline, pendingStatus, pinArguments, pinRelease } from "./docs-pin.mjs";

const COMMIT = "d".repeat(40);
const OTHER = "e".repeat(40);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubApi({ release = { draft: false, prerelease: false, tag_name: "v1.2.3" }, commit = COMMIT, latest = { tag_name: "v1.2.3" }, fail = false } = {}) {
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    if (route.includes("/releases/tags/")) {
      return release ? { ok: true, json: async () => release } : { ok: false, status: 404, json: async () => ({}) };
    }
    if (route.includes("/commits/")) return { ok: true, json: async () => ({ sha: commit }) };
    if (route.endsWith("/releases/latest")) return { ok: true, json: async () => latest };
    throw new Error(`unexpected route ${route}`);
  };
}

function fixtureDir(prefix, { coreSha = COMMIT, version = "1.2.3", docsData = "{}\n" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, "docs-data"));
  writeFileSync(path.join(root, "docs-data", "docs-data.json"), docsData);
  writeFileSync(path.join(root, "doc-contracts.json"), '{"c":1}\n');
  writeFileSync(path.join(root, "repo-files.json"), '{"r":1}\n');
  const members = Object.fromEntries(
    ["docs-data", "doc-contracts.json", "repo-files.json"].map((member) => [member, memberDigest(path.join(root, member))]),
  );
  writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ core_sha: coreSha, package_version: version, members }));
  return root;
}

const newPinDir = () => path.join(mkdtempSync(path.join(tmpdir(), "docs-pin-test-")), "release-pin");

async function pinned() {
  stubApi();
  const pinDir = newPinDir();
  await pinRelease("v1.2.3", { from: fixtureDir("bundle-"), pinDir });
  return pinDir;
}

test("pinning writes the pin layout and the manifest byte for byte", async () => {
  const bundle = fixtureDir("bundle-");
  stubApi();
  const pinDir = newPinDir();
  const pin = await pinRelease("v1.2.3", { from: bundle, pinDir });
  assert.deepEqual(pin, { tag: "v1.2.3", core_sha: COMMIT });
  assert.deepEqual(JSON.parse(readFileSync(path.join(pinDir, "pin.json"), "utf8")), pin);
  assert.equal(readFileSync(path.join(pinDir, "manifest.json"), "utf8"), readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  assert.ok(existsSync(path.join(pinDir, "docs-data", "docs-data.json")));
  assert.deepEqual(checkPinOffline(pinDir).errors, []);
});

test("pinning without --from fetches the bundle for the tag commit", async () => {
  stubApi();
  const calls = [];
  const pinDir = newPinDir();
  await pinRelease("v1.2.3", {
    pinDir,
    fetchBundle: (destination, commit) => {
      calls.push(commit);
      cpSync(fixtureDir("bundle-"), destination, { recursive: true });
    },
  });
  assert.deepEqual(calls, [COMMIT]);
  assert.deepEqual(checkPinOffline(pinDir).errors, []);
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
  stubApi({ commit: OTHER });
  await pinRelease("v1.2.3", { from: fixtureDir("bundle-", { coreSha: OTHER }), pinDir });
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
  stubApi({ latest: { tag_name: "v1.3.0" } });
  const result = await pendingStatus(pinDir);
  assert.equal(result.code, 1);
  assert.match(result.message, /v1\.3\.0/);
  assert.match(result.message, /v1\.2\.3/);
});

test("--pending exits 2 on an API error", async () => {
  const pinDir = await pinned();
  stubApi({ fail: true });
  assert.equal((await pendingStatus(pinDir)).code, 2);
});

test("the tag is read with and without --from, in either order", () => {
  assert.deepEqual(pinArguments(["v1.2.3"]), { tag: "v1.2.3", from: undefined, valid: true });
  assert.deepEqual(pinArguments(["v1.2.3", "--from", "dir"]), { tag: "v1.2.3", from: "dir", valid: true });
  assert.deepEqual(pinArguments(["--from", "dir", "v1.2.3"]), { tag: "v1.2.3", from: "dir", valid: true });
  assert.equal(pinArguments(["--from", "dir"]).valid, false);
  assert.equal(pinArguments(["v1.2.3", "--from"]).valid, false);
  assert.equal(pinArguments([]).valid, false);
});
