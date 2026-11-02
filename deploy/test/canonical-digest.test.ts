import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { canonicalDigest, canonicalValue, formatSignificant } from "../lib/canonical-digest.ts";

const require = createRequire(import.meta.url);
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
const bundles = {
  mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") },
  eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") },
};

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

async function snapshot(statements: string[]): Promise<string> {
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({});
  db.registerFileBuffer("build.duckdb", new Uint8Array(readFileSync(fixture("snapshot-a.duckdb.gz"))));
  const connection = db.connect();
  connection.query("ATTACH 'build.duckdb' AS build");
  connection.query("USE build");
  for (const statement of statements) connection.query(statement);
  connection.query("CHECKPOINT build");
  connection.query("USE memory");
  connection.query("DETACH build");
  connection.close();
  const file = path.join(mkdtempSync(path.join(tmpdir(), "snapshot-")), "built.duckdb");
  writeFileSync(file, db.copyFileToBuffer("build.duckdb"));
  return file;
}

const BASE = ["CREATE TABLE measurements(id INTEGER, value DOUBLE)", "INSERT INTO measurements VALUES (1, 0.5), (2, 1.25), (3, 100.0)"];

async function digestOf(statements: string[]): Promise<string> {
  return canonicalDigest(await snapshot(statements));
}

test("a generated_at column is part of the digest like any other column", async () => {
  const first = fixture("snapshot-a.duckdb.gz");
  const second = fixture("snapshot-b.duckdb.gz");
  assert.notDeepEqual(readFileSync(first), readFileSync(second));
  assert.notEqual(await canonicalDigest(first), await canonicalDigest(second));
});

test("row order and float noise beyond nine significant digits do not change the digest", async () => {
  const reference = await digestOf(BASE);
  const reordered = await digestOf([BASE[0], "INSERT INTO measurements VALUES (3, 100.0), (1, 0.5), (2, 1.25)"]);
  const noisy = await digestOf([BASE[0], "INSERT INTO measurements VALUES (1, 0.5000000000001), (2, 1.25), (3, 100.0000000000002)"]);
  assert.equal(reordered, reference);
  assert.equal(noisy, reference);
});

test("a value change inside nine significant digits changes the digest", async () => {
  const changed = await digestOf([BASE[0], "INSERT INTO measurements VALUES (1, 0.5001), (2, 1.25), (3, 100.0)"]);
  assert.notEqual(changed, await digestOf(BASE));
});

test("a column type change changes the digest although the values print alike", async () => {
  const widened = await digestOf(["CREATE TABLE measurements(id BIGINT, value DOUBLE)", BASE[1]]);
  assert.notEqual(widened, await digestOf(BASE));
});

test("a view definition change changes the digest although the rows match", async () => {
  const view = (predicate: string) => [...BASE, `CREATE VIEW fast AS SELECT id FROM measurements WHERE ${predicate}`];
  const original = await digestOf(view("value > 1"));
  assert.notEqual(await digestOf(view("value >= 1")), original);
  assert.equal(await digestOf(view("value > 1")), original);
});

test("an index definition change changes the digest", async () => {
  const plain = await digestOf(BASE);
  const indexed = await digestOf([...BASE, "CREATE INDEX measurements_id ON measurements(id)"]);
  const other = await digestOf([...BASE, "CREATE INDEX measurements_value ON measurements(value)"]);
  assert.notEqual(indexed, plain);
  assert.notEqual(other, indexed);
});
