import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { certificationErrors, verifyWithCertification } from "./bundle-verify.mjs";
import { fixtureBundle, FIXTURE_CORE as CORE } from "./fixture-bundle.mjs";

function trunkRun(overrides = {}) {
  return {
    path: ".github/workflows/trunk.yml",
    event: "push",
    head_branch: "develop",
    conclusion: "success",
    head_sha: CORE,
    ...overrides,
  };
}

function withCertifiedBy(dir, value) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.certified_by = value;
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

test("dispatch-certified bundles are refused without contacting the API", async () => {
  const dir = fixtureBundle();
  withCertifiedBy(dir, "dispatch");
  const result = await verifyWithCertification(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['schema 4 requires certified_by candidate or a run id, got "dispatch"', "certified_by dispatch is not a run id"]);
});

test("a numeric run id for the bundle commit passes the predicate", () => {
  assert.deepEqual(certificationErrors(trunkRun(), { core_sha: CORE }), []);
});

test("runs off the trunk path, branch, or verdict fail the predicate", () => {
  const manifest = { core_sha: CORE };
  assert.equal(certificationErrors(trunkRun({ path: ".github/workflows/ci.yml" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ head_branch: "main" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ conclusion: "failure" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ head_sha: "0".repeat(40) }), manifest).length, 1);
});

async function withRun(run, body) {
  const original = globalThis.fetch;
  const routes = [];
  globalThis.fetch = async (url) => {
    routes.push(String(url));
    return { ok: true, status: 200, json: async () => run };
  };
  try {
    return await body(routes);
  } finally {
    globalThis.fetch = original;
  }
}

test("a candidate schema 4 or 5 bundle never passes online certification and never contacts the API", async () => {
  for (const schema of [4, 5]) {
    const dir = fixtureBundle({ schema });
    await withRun(trunkRun(), async (routes) => {
      const result = await verifyWithCertification(dir);
      assert.equal(result.ok, false);
      assert.deepEqual(result.errors, ["certified_by candidate is not a run id"]);
      assert.deepEqual(routes, []);
      assert.equal((await verifyWithCertification(dir, { offline: true })).ok, true);
    });
  }
});

test("a schema 4 bundle certified by a trunk run id passes online certification", async () => {
  for (const schema of [4]) {
    const dir = fixtureBundle({ schema, certifiedBy: "40239821240" });
    await withRun(trunkRun(), async (routes) => {
      const result = await verifyWithCertification(dir);
      assert.deepEqual(result.errors, []);
      assert.equal(routes.length, 1);
      assert.ok(routes[0].endsWith("/actions/runs/40239821240"));
    });
  }
});

test("a certified schema 4 bundle is refused when its run is not a green trunk push on the bundle commit", async () => {
  for (const overrides of [{ conclusion: "failure" }, { head_sha: "0".repeat(40) }, { head_branch: "main" }, { path: ".github/workflows/ci.yml" }]) {
    const dir = fixtureBundle({ schema: 4, certifiedBy: "40239821240" });
    await withRun(trunkRun(overrides), async () => {
      const result = await verifyWithCertification(dir);
      assert.equal(result.ok, false);
      assert.equal(result.errors.length, 1);
    });
  }
});

test("a schema 5 bundle with a run id is refused online and offline", async () => {
  const dir = fixtureBundle({ schema: 5, certifiedBy: "40239821240" });
  await withRun(trunkRun(), async () => {
    assert.equal((await verifyWithCertification(dir)).ok, false);
    assert.equal((await verifyWithCertification(dir, { offline: true })).ok, false);
  });
});

test("an API failure fails a certified schema 4 bundle closed", async () => {
  const dir = fixtureBundle({ schema: 4, certifiedBy: "40239821240" });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    const result = await verifyWithCertification(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /certification check failed closed/);
  } finally {
    globalThis.fetch = original;
  }
});
