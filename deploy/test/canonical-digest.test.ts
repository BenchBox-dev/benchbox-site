import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { canonicalDigest, canonicalValue, formatSignificant } from "../lib/canonical-digest.ts";

const CORE_DIGEST = "02dd2678431996b4627aaf9847e2e6ead4a44d788935c5995fcbd9d628d43e8b";

function fixture(name: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "snapshot-")), name.replace(/\.gz$/, ""));
  writeFileSync(file, gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
  return file;
}

test("floats format like Python's .9g", () => {
  const cases: [number, string][] = [
    [0.1, "0.1"],
    [1e-5, "1e-05"],
    [0.0001, "0.0001"],
    [123456789, "123456789"],
    [1234567890, "1.23456789e+09"],
    [1, "1"],
    [-2.5e-7, "-2.5e-07"],
    [12345.678901234, "12345.6789"],
    [1 / 3, "0.333333333"],
    [2 ** 70, "1.18059162e+21"],
    [-0, "-0"],
    [Number.NaN, "nan"],
    [Number.POSITIVE_INFINITY, "inf"],
    [99999999.95, "100000000"],
    [0.00012345678949, "0.000123456789"],
  ];
  for (const [value, expected] of cases) assert.equal(formatSignificant(value), expected, String(value));
});

test("values are tagged by type like core's digest", () => {
  assert.equal(canonicalValue(null, "INTEGER"), "null:");
  assert.equal(canonicalValue(true, "BOOLEAN"), "bool:True");
  assert.equal(canonicalValue(7, "INTEGER"), "int:7");
  assert.equal(canonicalValue(7n, "BIGINT"), "int:7");
  assert.equal(canonicalValue(7, "DOUBLE"), "float:7");
  assert.equal(canonicalValue("a|b", "VARCHAR"), "str:a|b");
});

test("snapshots with the same rows digest alike, matching core's digest tool", async () => {
  const first = fixture("snapshot-a.duckdb.gz");
  const second = fixture("snapshot-b.duckdb.gz");
  assert.notDeepEqual(readFileSync(first), readFileSync(second));
  assert.equal(await canonicalDigest(first), CORE_DIGEST);
  assert.equal(await canonicalDigest(second), CORE_DIGEST);
});
