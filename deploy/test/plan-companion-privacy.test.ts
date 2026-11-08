import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { findPathLeaks, localPathMatcher } from "../gates/local-paths.ts";
import { privacyGate } from "../gates/privacy.ts";
import { runGates } from "../gates/index.ts";
import { site } from "./helpers.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "..", "explorer", "src", "lib", "__tests__", "fixtures", "plans");
const BUNDLE = "results/data/bundles/abcdef1234567890.plans.json";

const LEAKING = [
  "/Users/alice/data/lineitem.parquet",
  "/home/alice/data/lineitem.parquet",
  "/root/data/lineitem.parquet",
  "/tmp/bench/lineitem.parquet",
  "/var/folders/ab/cd/T/x.parquet",
  "/private/var/folders/ab/cd/T/x.parquet",
  "/private/tmp/bench/x.parquet",
  "/mnt/disk1/tpch/lineitem.parquet",
  "/opt/bench/lineitem.parquet",
  "/Volumes/ssd/lineitem.parquet",
  "~/bench/lineitem.parquet",
  "C:\\Users\\alice\\lineitem.parquet",
  "D:\\data\\lineitem.parquet",
  "z:\\scratch\\x",
  "E:/bench/lineitem.parquet",
  "\\\\fileserver\\share\\tpch\\lineitem.parquet",
  "//fileserver/share/tpch/lineitem.parquet",
  "Parquet SCAN [/tmp/bench/lineitem.parquet]",
  "Location: InMemoryFileIndex(1 paths)[file:/mnt/x/lineitem.parquet]",
  "Location: file:///opt/bench/x",
  "scan D:\\\\data\\\\orders",
];

const NEUTRAL = [
  "<redacted>",
  "<redacted>/lineitem.parquet",
  "file:<redacted>",
  "/data",
  "/data/",
  "/output",
  "s3://bucket/tpch/lineitem.parquet",
  "https://example.com/tmp/opt/home",
  "gs://bucket/mnt/x",
  "abfss://c@acct.dfs.core.windows.net/opt/x",
  "tpch/sf1/lineitem.parquet",
  "lineitem.1.parquet",
  "catalog.schema.lineitem",
  "main.tpch_sf1.orders",
  'FILTER col("tag") == "tmp", opt, mnt, home',
  "Parquet SCAN [<redacted>/lineitem.parquet]",
  "FileScan parquet [l_orderkey#1L] Location: InMemoryFileIndex(1 paths)[file:<redacted>/lineitem.parquet]",
  "a:b c:d x=1:2",
  "ratio 3:4 http://host:80/x",
];

function companion(plan: Record<string, unknown>): string {
  return JSON.stringify({ capture_failures: 0, errors: null, queries: { "Q1#0:": { plan } } });
}

test("local path detector flags local roots, drive letters and UNC paths", () => {
  const contains = localPathMatcher();
  for (const text of LEAKING) assert.equal(contains(text), true, text);
});

test("local path detector accepts placeholders, URLs and relative tails", () => {
  const contains = localPathMatcher();
  for (const text of NEUTRAL) assert.equal(contains(text), false, text);
});

test("configured roots are flagged, neutral placeholders stay allowed", () => {
  const text = "Parquet SCAN [/srv/runs/tpch_sf1/lineitem.parquet]";
  assert.equal(localPathMatcher()(text), false);
  assert.equal(localPathMatcher(["/srv/runs/tpch_sf1"])(text), true);
  assert.equal(localPathMatcher(["/srv/runs/tpch_sf1"])("Parquet SCAN [<redacted>/lineitem.parquet]"), false);
  assert.equal(localPathMatcher(["D:\\bench\\tpch_sf1"])("SCAN D:\\bench\\tpch_sf1\\lineitem.parquet"), true);
  assert.equal(localPathMatcher(["E:/bench/tpch_sf1"])("SCAN E:/bench/tpch_sf1/lineitem.parquet"), true);
  assert.equal(localPathMatcher(["\\srv\\data\\tpch"])("Scan [/srv/data/tpch/lineitem.parquet]"), true);
  const neutral = localPathMatcher(["/data", "/output"]);
  assert.equal(neutral("/data"), false);
  assert.equal(neutral("scan /output/"), false);
});

test("leak fields name the location and key leaks are masked", () => {
  assert.deepEqual(findPathLeaks({ a: ["ok", { b: "/tmp/x" }], c: "fine" }), ["a.1.b"]);
  assert.deepEqual(findPathLeaks({ "/home/alice/key": "ok" }), ["<key>"]);
  assert.deepEqual(findPathLeaks("/tmp/x"), ["<root>"]);
});

test("safe plan companion fixtures pass the privacy gate", () => {
  const names = readdirSync(FIXTURES).filter((name) => name.endsWith(".plans.json"));
  assert.equal(names.length, 5);
  for (const name of names) {
    const result = privacyGate(site({ [`results/data/bundles/${name}`]: readFileSync(path.join(FIXTURES, name), "utf8") }));
    assert.equal(result.status, "pass", `${name}: ${result.findings?.join("; ")}`);
  }
  assert.ok(names.includes("pandas-errors-only.plans.json"));
  assert.ok(names.includes("polars-text.plans.json"));
});

test("unsafe plan text, nested plan data and raw explain output block deployment", () => {
  const body = companion({
    plan_text: "Parquet SCAN [/home/alice/tpch/lineitem.parquet]",
    plan_data: { logical_plan: "SCAN /tmp/bench/orders.parquet", optimized_plan: "SCAN D:\\data\\orders.parquet" },
    raw_explain_output: "Location: file:///Users/alice/x",
  });
  const result = privacyGate(site({ [BUNDLE]: body }));
  assert.equal(result.status, "fail");
  assert.equal(result.findings?.length, 1);
  assert.match(result.findings![0], /abcdef1234567890\.plans\.json: Detected local filesystem path in plans companion field/);
  for (const field of [
    "queries.Q1#0:.plan.plan_text",
    "queries.Q1#0:.plan.plan_data.logical_plan",
    "queries.Q1#0:.plan.plan_data.optimized_plan",
    "queries.Q1#0:.plan.raw_explain_output",
  ]) {
    assert.ok(result.findings![0].includes(field), field);
  }
});

test("diagnostics never echo the leaked value", () => {
  const leaks = ["/home/alice/tpch", "/tmp/bench", "D:\\data", "//fileserver/share"];
  const body = companion({ plan_text: leaks.join(" "), plan_data: { raw: ["x", { inner: "//fileserver/share/t" }] } });
  const result = privacyGate(site({ [BUNDLE]: body }));
  assert.equal(result.status, "fail");
  const output = JSON.stringify(result);
  for (const leak of [...leaks, "alice", "fileserver", "bench"]) assert.equal(output.includes(leak), false, leak);
  assert.match(output, /plan_data\.raw\.1\.inner/);
});

test("UNC paths with forward slashes and nested raw strings are rejected", () => {
  const unc = privacyGate(site({ [BUNDLE]: companion({ plan_text: "SCAN //fileserver/share/tpch/lineitem.parquet" }) }));
  assert.equal(unc.status, "fail");
  const nested = privacyGate(site({ [BUNDLE]: companion({ plan_data: { raw: ["scan /mnt/x/a.parquet", [{ inner: "file:/opt/y/c" }]] } }) }));
  assert.equal(nested.status, "fail");
  assert.match(nested.findings![0], /plan_data\.raw\.0, .*plan_data\.raw\.1\.0\.inner|plan_data\.raw\.1\.0\.inner, .*plan_data\.raw\.0/);
});

test("a path in an object key blocks the companion and the key is masked", () => {
  const result = privacyGate(site({ [BUNDLE]: JSON.stringify({ queries: { "/Users/alice/q": {} } }) }));
  assert.equal(result.status, "fail");
  assert.match(result.findings![0], /queries\.<key>/);
  assert.equal(result.findings![0].includes("alice"), false);
});

test("placeholders in a companion pass", () => {
  const body = companion({ plan_text: "Parquet SCAN [<redacted>/lineitem.parquet] /data /output", raw_explain_output: "file:<redacted>" });
  assert.equal(privacyGate(site({ [BUNDLE]: body })).status, "pass");
});

test("configured roots block companions that carry the run's data directory", () => {
  const body = companion({ plan_text: "Parquet SCAN [/srv/runs/tpch_sf1/lineitem.parquet]" });
  assert.equal(privacyGate(site({ [BUNDLE]: body })).status, "pass");
  assert.equal(privacyGate(site({ [BUNDLE]: body }), ["/srv/runs/tpch_sf1"]).status, "fail");
});

test("a companion that is not valid JSON fails closed", () => {
  const result = privacyGate(site({ [BUNDLE]: "{not json" }));
  assert.equal(result.status, "fail");
  assert.match(result.findings![0], /not valid JSON/);
});

test("only plans companions are checked for local paths", () => {
  const body = JSON.stringify({ note: "/tmp/anything" });
  assert.equal(privacyGate(site({ "results/data/bundles/abc.json": body })).status, "pass");
});

test("the deploy gate report fails on an unsafe companion and carries configured roots", () => {
  const base = {
    mode: "rollback" as const,
    target: "rehearsal",
    corpusSha: "c".repeat(40),
    uiVersion: 1,
    snapshotVersion: 1,
    allowance: [],
    originAllowlist: [],
    extraHosts: [],
    candidateCanonical: null,
    deployed: null,
  };
  const unsafe = site({ [BUNDLE]: companion({ plan_text: "/tmp/x" }) });
  assert.equal(runGates({ ...base, siteDir: unsafe }).results.privacy.status, "fail");
  const rooted = site({ [BUNDLE]: companion({ plan_text: "/srv/runs/a/x" }) });
  assert.equal(runGates({ ...base, siteDir: rooted }).results.privacy.status, "pass");
  assert.equal(runGates({ ...base, siteDir: rooted, privatePathRoots: ["/srv/runs/a"] }).results.privacy.status, "fail");
});
