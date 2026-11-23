import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, pickRankedSingles } from "./read-model-snapshot.mjs";
import { CONTRACT_FILE } from "./stage-read-model-inputs.mjs";

const source = fileURLToPath(new URL("../.site-inputs/explorer/fixtures/results.duckdb", import.meta.url));

test("staging an already read-model 21 snapshot only applies the example assignments", { skip: !existsSync(source) }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-model-twice-"));
  const first = path.join(dir, "first.duckdb");
  const second = path.join(dir, "second.duckdb");
  const pick = (conn) => {
    const [a, b] = pickRankedSingles(conn, { benchmark: "tpch", scaleFactor: 0.01, testType: "power", count: 2 });
    return { [a]: "example-ranked-release", [b]: "example-pre-release" };
  };
  const widened = await buildSnapshot({ sourceFile: source, outputFile: first, contractFile: CONTRACT_FILE, assignments: pick });
  const again = await buildSnapshot({ sourceFile: first, outputFile: second, contractFile: CONTRACT_FILE, assignments: pick });
  assert.deepEqual(again.assigned, widened.assigned);
  assert.equal(again.readModelVersion, 21);
});
