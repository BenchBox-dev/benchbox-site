import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  KNOWN_ROOTS,
  NEUTRAL_PLACEHOLDERS,
  PRIVATE_LOCAL_PATH,
  REDACTED_PLACEHOLDER,
  assertNoPathPrivacyDrift,
  findPathLeaks,
  loadPathPrivacyContract,
  localPathMatcher,
  pathPrivacyDrift,
} from "../gates/local-paths.ts";
import { privacyGate } from "../gates/privacy.ts";
import { runGates } from "../gates/index.ts";
import { site } from "./helpers.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "..", "explorer", "src", "lib", "__tests__", "fixtures", "plans");
const BUNDLE = "results/data/bundles/abcdef1234567890.plans.json";
function companion(plan: Record<string, unknown>): string {
  return JSON.stringify({ capture_failures: 0, errors: null, queries: { "Q1#0:": { plan } } });
}

test("live gate matches exported path_privacy contract facts", () => {
  const contract = loadPathPrivacyContract();
  assert.equal(contract.schema_version, 1);
  assert.deepEqual([...KNOWN_ROOTS].sort(), [...contract.known_roots].sort());
  assert.deepEqual([...NEUTRAL_PLACEHOLDERS].sort(), [...contract.placeholder_allowlist].sort());
  assert.equal(REDACTED_PLACEHOLDER, contract.redacted_placeholder);
});

test("local path detector matches all contract cases", () => {
  const contract = loadPathPrivacyContract();
  assert.ok(contract.cases.length > 0, "contract has cases");
  for (const c of contract.cases) {
    const roots = [...(c.roots ?? [])];
    if (c.home && contract.home_root?.synthetic_home) roots.push(contract.home_root.synthetic_home);
    const contains = localPathMatcher(roots);
    assert.equal(contains(c.text), c.leak, `case ${c.id}: expected leak=${c.leak} for text: ${c.text}`);
  }
});

test("local path detector flags leaking contract cases", () => {
  const contract = loadPathPrivacyContract();
  const contains = localPathMatcher();
  const leaking = contract.cases.filter((c) => c.leak && !c.home && (!c.roots || c.roots.length === 0));
  assert.ok(leaking.length > 0);
  for (const c of leaking) assert.equal(contains(c.text), true, `case ${c.id}: ${c.text}`);
});

test("local path detector accepts neutral contract cases", () => {
  const contract = loadPathPrivacyContract();
  const contains = localPathMatcher();
  const neutral = contract.cases.filter((c) => !c.leak && !c.home && (!c.roots || c.roots.length === 0));
  assert.ok(neutral.length > 0);
  for (const c of neutral) assert.equal(contains(c.text), false, `case ${c.id}: ${c.text}`);
});

test("path privacy drift detection fails on known_roots drift", () => {
  const contract = loadPathPrivacyContract();
  const tampered = { ...contract, known_roots: [...contract.known_roots, "/rogue_root"] };
  const drift = pathPrivacyDrift(tampered);
  assert.ok(drift.some((d) => d.includes("known_roots drift")));
});

test("path privacy drift detection fails on placeholder_allowlist drift", () => {
  const contract = loadPathPrivacyContract();
  const tampered = { ...contract, placeholder_allowlist: ["/data"] };
  const drift = pathPrivacyDrift(tampered);
  assert.ok(drift.some((d) => d.includes("placeholder_allowlist drift")));
});

test("path privacy drift detection fails on case verdict drift", () => {
  const contract = loadPathPrivacyContract();
  const tampered = {
    ...contract,
    cases: contract.cases.map((c) => (c.id === "known-root-users" ? { ...c, leak: false } : c)),
  };
  const drift = pathPrivacyDrift(tampered);
  assert.ok(drift.some((d) => d.includes("case drift on 'known-root-users'")));
});

test("assertNoPathPrivacyDrift passes for the exported contract and throws on drift", () => {
  const contract = loadPathPrivacyContract();
  assert.doesNotThrow(() => assertNoPathPrivacyDrift(contract));
  assert.throws(
    () => assertNoPathPrivacyDrift({ ...contract, known_roots: [] }),
    /Path privacy gate drifted from doc-contracts\.json/,
  );
});

test("privacyGate fails when contract drift is detected", () => {
  const contract = loadPathPrivacyContract();
  const tampered = { ...contract, known_roots: ["/different"] };
  const result = privacyGate(site({}), [], tampered);
  assert.equal(result.status, "fail");
  assert.ok(result.findings?.some((f) => f.includes("Path privacy gate drifted")));
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
