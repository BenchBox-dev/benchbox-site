import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { explorerCompatGate, requiredPairs, uiVersionFromSource } from "../gates/explorer-compat.ts";
import { runGates } from "../gates/index.ts";
import { findBrokenLinks, linksGate, routedAllowance, type BrokenLink } from "../gates/links.ts";
import { originGate } from "../gates/origin.ts";
import { privacyFindings, privacyGate } from "../gates/privacy.ts";
import { snapshotDigestGate } from "../gates/snapshot-digest.ts";
import { site } from "./helpers.ts";

const EXPLORER = {
  "results/index.html": "<!doctype html><html><head></head><body></body></html>",
  "results/assets/index.js": "console.log(1)",
  "results/assets/index.css": "body{}",
  "results/data/results.duckdb": "duckdb-bytes",
};

test("privacy: secrets are found and documented placeholders pass", () => {
  assert.deepEqual(privacyFindings("a.json", '{"public_key": "valid_public_data"}'), []);
  assert.match(privacyFindings("a.json", "ghp_123456789012345678901234567890123456")[0], /GitHub Personal Access Token/);
  assert.deepEqual(privacyFindings("a.txt", "AKIAIOSFODNN7EXAMPLE"), []);
  assert.equal(privacyFindings("a.txt", "AKIAZZZZZZZZZZZZZZ12").length, 1);
  for (const placeholder of [
    "postgres://username:password@hostname:port/database?sslmode=require",
    "postgresql://user:pass@host/db",
    "postgres://tsdbadmin:password@abc123.tsdb.cloud.timescale.com:5432/tsdb",
  ]) {
    assert.deepEqual(privacyFindings("a.txt", placeholder), []);
  }
  assert.equal(privacyFindings("a.txt", "postgres://admin:s3cr3t-real@prod.internal:5432/db").length, 1);
  assert.deepEqual(privacyFindings("a.txt", "if url.startswith('postgresql://'): send to ops@example.com"), []);
  const mixed = "postgres://u:password@h/db postgres://a:real1@h/db postgres://b:real2@h/db";
  assert.match(privacyFindings("a.txt", mixed)[0], /2 occurrence\(s\)/);
});

test("privacy gate scans the artifact's text files", () => {
  assert.equal(privacyGate(site({ "a.html": "<p>clean</p>" })).status, "pass");
  const dirty = privacyGate(site({ "docs/a.js": "const k = 'ghp_123456789012345678901234567890123456';", "img.png": "ghp_123456789012345678901234567890123456" }));
  assert.equal(dirty.status, "fail");
  assert.equal(dirty.findings?.length, 1);
});

test("explorer compat: every required pair needs snapshot >= ui", () => {
  const cases: [number, number, [number, number] | null, boolean][] = [
    [11, 11, [11, 11], true],
    [11, 12, [11, 11], true],
    [12, 12, [11, 11], true],
    [12, 11, [11, 11], false],
    [11, 10, [11, 11], false],
    [11, 11, [12, 12], false],
    [11, 11, null, true],
    [12, 11, null, false],
  ];
  for (const [ui, snapshot, current, ok] of cases) {
    const pairs = requiredPairs({ mode: "deploy", candidate: { ui, snapshot }, deployed: current && { ui: current[0], snapshot: current[1] } });
    assert.equal(pairs.every((pair) => pair.ok), ok, `${ui}/${snapshot} against ${current}`);
  }
});

test("explorer compat: the artifact must be complete", () => {
  const good = site(EXPLORER);
  assert.equal(explorerCompatGate({ siteDir: good, mode: "deploy", uiVersion: 14, snapshotVersion: 14, deployed: null }).status, "pass");
  const emptyCss = explorerCompatGate({ siteDir: site({ ...EXPLORER, "results/assets/index.css": "" }), mode: "deploy", uiVersion: 14, snapshotVersion: 14, deployed: null });
  assert.equal(emptyCss.status, "fail");
  assert.deepEqual(emptyCss.findings, ["results/assets/index.css is empty"]);
  const { ["results/assets/index.css"]: _css, ...withoutCss } = EXPLORER;
  const noCss = explorerCompatGate({ siteDir: site(withoutCss), mode: "deploy", uiVersion: 14, snapshotVersion: 14, deployed: null });
  assert.deepEqual(noCss.findings, ["the Explorer artifact has no stylesheet"]);
});

test("explorer compat reads exactly one UI version constant", () => {
  assert.equal(uiVersionFromSource("const EXPECTED_READ_MODEL_VERSION = 14;\n"), 14);
  assert.throws(() => uiVersionFromSource("const OTHER = 1;\n"), /found 0/);
});

test("snapshot digest: unchanged corpus needs the same snapshot contents", () => {
  const dir = site(EXPLORER);
  const sha = createHash("sha256").update("duckdb-bytes").digest("hex");
  const corpus = "c".repeat(40);
  const contents = "a".repeat(64);
  const gate = (deployed: Parameters<typeof snapshotDigestGate>[0]["deployed"], candidateCanonical: string | null = contents) =>
    snapshotDigestGate({ siteDir: dir, corpusSha: corpus, candidateCanonical, deployed });
  assert.equal(gate(null).status, "skipped");
  assert.equal(gate({ corpus_sha: "9".repeat(40), snapshot_sha256: "0".repeat(64) }).status, "skipped");
  assert.equal(gate({ corpus_sha: corpus, snapshot_sha256: sha }).status, "pass");
  assert.equal(gate({ corpus_sha: corpus, snapshot_sha256: "0".repeat(64), snapshot_canonical_sha256: contents }).status, "pass");
  assert.equal(gate({ corpus_sha: corpus, snapshot_sha256: "0".repeat(64), snapshot_canonical_sha256: "b".repeat(64) }).status, "fail");
  assert.equal(gate({ corpus_sha: corpus, snapshot_sha256: "0".repeat(64), snapshot_canonical_sha256: contents }, null).status, "fail");
  assert.equal(gate({ corpus_sha: corpus, snapshot_sha256: "0".repeat(64) }).status, "skipped");
  assert.equal(snapshotDigestGate({ siteDir: site({}), corpusSha: corpus, candidateCanonical: null, deployed: null }).status, "fail");
});

test("origin: rehearsal artifacts carry no production origin outside the allowlist", () => {
  const dir = site({ "docs/a.html": '<a href="https://benchbox.dev/x">x</a>', "blog/post.html": "https://benchbox.dev" });
  const allowlist = [/^blog\/[^/]+\.html$/];
  assert.equal(originGate({ siteDir: dir, target: "", allowlist }).status, "skipped");
  const result = originGate({ siteDir: dir, target: "rehearsal", allowlist });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.findings, ["docs/a.html"]);
  assert.equal(originGate({ siteDir: site({ "blog/post.html": "https://benchbox.dev" }), target: "rehearsal", allowlist }).status, "pass");
});

const LINKED = {
  "index.html": '<html><body><nav><a href="/docs/gone.html">x</a></nav><a href="/docs/guide.html#install">ok</a><a href="/docs/guide.html#nope">bad</a><a href="/missing/">gone</a><a href="https://example.com/">ext</a><a href="/results/p/duckdb/">spa</a><img src="/img/missing.png"></body></html>',
  "docs/guide.html": '<html><body><h2 id="install">Install</h2><a name="anchor"></a></body></html>',
  "404.html": "<html><script>sessionStorage.setItem('benchbox.results.redirect', '/')</script></html>",
  "blog/atom.xml": '<feed><entry><link href="https://benchbox.dev/blog/old.html"/></entry></feed>',
};

test("links: missing paths, missing fragments, chrome links, feeds and images are found", () => {
  const { broken, missingImages } = findBrokenLinks(site(LINKED));
  assert.deepEqual(broken, [
    ["(site chrome)", "/docs/gone.html", "missing path"],
    ["/", "/docs/guide.html#nope", "missing fragment"],
    ["/", "/missing/", "missing path"],
    ["/blog/atom.xml", "/blog/old.html", "missing path"],
  ]);
  assert.deepEqual(missingImages, ["/ -> /img/missing.png"]);
});

test("links gate: only breakage outside the allowance fails", () => {
  const files = { ...LINKED, "index.html": LINKED["index.html"].replace('<img src="/img/missing.png">', "") };
  const allowance: BrokenLink[] = [
    ["(site chrome)", "/docs/gone.html", "missing path"],
    ["/", "/docs/guide.html#nope", "missing fragment"],
    ["/", "/missing/", "missing path"],
    ["/blog/atom.xml", "/blog/old.html", "missing path"],
    ["/stale", "/also-stale", "missing path"],
  ];
  const passed = linksGate({ siteDir: site(files), allowance });
  assert.equal(passed.status, "pass");
  assert.match(passed.detail, /within the allowance of 7 \(5 entries and their \/docs\/dev\/ copies\)$/);
  const result = linksGate({ siteDir: site(files), allowance: allowance.slice(1) });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.findings, ["broken internal link: (site chrome) -> /docs/gone.html -> missing path"]);
  assert.equal(linksGate({ siteDir: site(LINKED), allowance }).status, "fail");
});

test("links: an allowance for /docs/ also covers /docs/dev/", () => {
  const routed = routedAllowance([["/docs/a.html", "/docs/b.html#x", "missing fragment"]]);
  assert.deepEqual(routed[1], ["/docs/dev/a.html", "/docs/dev/b.html#x", "missing fragment"]);
});

test("the gate runner skips artifact gates on rollback and reports a raising gate as a failure", () => {
  const inputs = {
    siteDir: site({ ...EXPLORER, "index.html": "<html></html>", "404.html": "<html></html>" }),
    mode: "rollback" as const,
    target: "",
    corpusSha: "c".repeat(40),
    uiVersion: 14,
    snapshotVersion: 14,
    allowance: [],
    originAllowlist: [],
    extraHosts: [],
    candidateCanonical: null,
    deployed: null,
  };
  const report = runGates(inputs);
  assert.equal(report.results.links.status, "skipped");
  assert.equal(report.results.snapshot_digest.status, "skipped");
  assert.equal(report.ok, true);
  const raising = runGates({ ...inputs, mode: "deploy", siteDir: "/nonexistent/site" });
  assert.equal(raising.ok, false);
  assert.match(raising.results.privacy.detail, /gate raised/);
});
