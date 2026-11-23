import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const WORK = "work.duckdb";
const DEFAULT_COMPARISON_VERSION = "version not recorded";

function quote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function definition(column) {
  return `${column.name} ${column.type}${column.nullable ? "" : " NOT NULL"}`;
}

function tableSql(name, spec) {
  const key = spec.primary_key ? `, PRIMARY KEY (${spec.primary_key.join(", ")})` : "";
  return `CREATE TABLE ${name} (${spec.columns.map(definition).join(", ")}${key})`;
}

function insertSql(name, columns, row) {
  return `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map((column) => quote(row[column])).join(", ")})`;
}

async function openBindings() {
  const duckdb = require("@duckdb/duckdb-wasm/blocking");
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm"));
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: "" },
      eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: "" },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate(() => {});
  return db;
}

export function readContract(contractFile) {
  const contract = JSON.parse(readFileSync(contractFile, "utf8"));
  if (!Number.isInteger(contract.read_model_version)) throw new Error(`${contractFile} has no integer read_model_version`);
  if (!contract.tables?.results?.added_columns) throw new Error(`${contractFile} adds no columns to results`);
  return contract;
}

export function exampleRowIds(contract) {
  return contract.rows.results.map((row) => row.result_id);
}

export async function buildSnapshot({ sourceFile, outputFile, contractFile, assignments }) {
  const contract = readContract(contractFile);
  const columns = contract.tables.results.added_columns;
  const names = columns.map((column) => column.name);
  const examples = new Map(contract.rows.results.map((row) => [row.result_id, row]));
  const db = await openBindings();
  db.registerFileBuffer(WORK, new Uint8Array(readFileSync(sourceFile)));
  const conn = db.connect();
  try {
    conn.query(`ATTACH '${WORK}' AS target`);
    conn.query("USE target");
    for (const column of columns) conn.query(`ALTER TABLE results ADD COLUMN ${column.name} ${column.type}`);
    conn.query(
      "UPDATE results SET corpus_class = 'none', corpus_lanes = '[]', corpus_labels = '[]'," +
        ` comparison_identity = variant_id || ' (${DEFAULT_COMPARISON_VERSION})',` +
        ` comparison_version = '${DEFAULT_COMPARISON_VERSION}', version_is_release = FALSE`,
    );
    const chosen = typeof assignments === "function" ? assignments(conn) : assignments;
    for (const [resultId, exampleId] of Object.entries(chosen)) {
      const example = examples.get(exampleId);
      if (!example) throw new Error(`the contract has no example row ${exampleId}`);
      const sets = names.map((name) => `${name} = ${quote(example[name])}`).join(", ");
      conn.query(`UPDATE results SET ${sets} WHERE result_id = ${quote(resultId)}`);
      const updated = conn.query(`SELECT count(*) AS n FROM results WHERE result_id = ${quote(resultId)}`).toArray()[0].toJSON().n;
      if (Number(updated) !== 1) throw new Error(`result ${resultId} is not in the source snapshot`);
    }
    const detail = conn.query("SELECT sql FROM duckdb_views() WHERE view_name = 'result_detail_metrics'").toArray()[0].toJSON().sql;
    const widened = detail.replace(", e.os,", `, ${names.map((name) => `r.${name}`).join(", ")}, e.os,`);
    if (widened === detail) throw new Error("result_detail_metrics has no environment columns to widen before");
    conn.query("DROP VIEW result_detail_metrics");
    conn.query(widened);
    for (const table of ["result_lane_scores", "identity_medians"]) {
      conn.query(tableSql(table, contract.tables[table]));
    }
    const exampleTarget = new Map(Object.entries(chosen).map(([resultId, exampleId]) => [exampleId, resultId]));
    for (const row of contract.rows.result_lane_scores) {
      const resultId = exampleTarget.get(row.result_id);
      if (resultId !== undefined) conn.query(insertSql("result_lane_scores", Object.keys(row), { ...row, result_id: resultId }));
    }
    for (const row of contract.rows.identity_medians) conn.query(insertSql("identity_medians", Object.keys(row), row));
    conn.query(`UPDATE metadata SET read_model_version = ${contract.read_model_version}`);
    const platforms = Object.fromEntries(
      Object.keys(chosen).map((resultId) => [
        resultId,
        conn.query(`SELECT platform_id FROM results WHERE result_id = ${quote(resultId)}`).toArray()[0].toJSON().platform_id,
      ]),
    );
    conn.query("CHECKPOINT target");
    conn.query("USE memory");
    conn.query("DETACH target");
    writeFileSync(outputFile, db.copyFileToBuffer(WORK));
    return { readModelVersion: contract.read_model_version, assigned: chosen, platforms };
  } finally {
    conn.close();
  }
}

export function pickRankedSingles(conn, { benchmark, scaleFactor, testType, count }) {
  const rows = conn
    .query(
      "SELECT min(result_id) AS result_id FROM results" +
        ` WHERE benchmark = ${quote(benchmark)} AND scale_factor = ${quote(scaleFactor)} AND test_type = ${quote(testType)}` +
        " AND ranking_exclusion_reason IS NULL AND visibility = 'public-curated'" +
        " GROUP BY platform_id HAVING count(*) = 1 ORDER BY 1",
    )
    .toArray()
    .map((row) => row.toJSON().result_id);
  if (rows.length < count) throw new Error(`the source snapshot has ${rows.length} single-run platforms in the cohort, ${count} needed`);
  return rows.slice(0, count);
}
