import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_FILE, embedPageResultIds } from "./stage-read-model-inputs.mjs";
import { exampleRowIds, readContract } from "./read-model-snapshot.mjs";

const script = fileURLToPath(new URL("./stage-read-model-inputs.mjs", import.meta.url));

test("the contract fixture is the next read model and carries three example results", () => {
  const contract = readContract(CONTRACT_FILE);
  assert.equal(contract.read_model_version, 21);
  assert.equal(exampleRowIds(contract).length, 3);
});

test("the embed page names the results the staged snapshot labels, without the withdrawn one", () => {
  const ids = embedPageResultIds();
  assert.deepEqual(ids, ["tpch-duckdb-sf1.0-20261007-83a01707", "tpch-spark-sf1.0-20261007-9c57f2ae"]);
});

test("staging refuses an output directory inside or equal to the source", () => {
  const source = mkdtempSync(path.join(tmpdir(), "read-model-source-"));
  writeFileSync(path.join(source, "manifest.json"), "{}");
  mkdirSync(path.join(source, "nested"));
  for (const out of [source, path.join(source, "nested")]) {
    const run = spawnSync(process.execPath, [script, "--source", source, "--out", out], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /apart from --source/);
  }
});

test("staging refuses a source that is not a core bundle", () => {
  const source = mkdtempSync(path.join(tmpdir(), "read-model-source-"));
  const run = spawnSync(process.execPath, [script, "--source", source, "--out", path.join(tmpdir(), "read-model-out-never")], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /not a core bundle directory/);
});
