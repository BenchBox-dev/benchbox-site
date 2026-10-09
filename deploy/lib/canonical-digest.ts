import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type ArrowTable = {
  numRows: number;
  toArray(): { toJSON(): Record<string, unknown> }[];
  getChildAt(index: number): { get(row: number): unknown } | null;
};
type Connection = { query(sql: string): ArrowTable; close(): void };
type Bindings = { instantiate(): Promise<unknown>; open(config: object): void; registerFileBuffer(name: string, buffer: Uint8Array): void; connect(): Connection };
type NodeBlocking = { createDuckDB(bundles: object, logger: object, runtime: object): Promise<Bindings>; VoidLogger: new () => object; NODE_RUNTIME: object };

const require = createRequire(import.meta.url);
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs") as NodeBlocking;

const EXCLUDED_COLUMNS = new Set(["generated_at"]);
const FLOAT_TYPES = new Set(["DOUBLE", "FLOAT", "REAL"]);

export function formatSignificant(value: number, digits = 9): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const [mantissa, exponentText] = value.toExponential(digits - 1).split("e");
  const exponent = Number(exponentText);
  const trim = (text: string) => (text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text);
  if (exponent < -4 || exponent >= digits) {
    const sign = exponent < 0 ? "-" : "+";
    return `${trim(mantissa)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return trim(value.toFixed(digits - 1 - exponent));
}

export function canonicalValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return "null:";
  if (typeof value === "boolean") return `bool:${value ? "True" : "False"}`;
  if (typeof value === "bigint") return `int:${value}`;
  if (typeof value === "number") return FLOAT_TYPES.has(type) ? `float:${formatSignificant(value)}` : `int:${value}`;
  return `str:${String(value)}`;
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function canonicalDigest(dbFile: string): Promise<string> {
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
  const bundles = {
    mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({});
  db.registerFileBuffer("snapshot.duckdb", new Uint8Array(readFileSync(dbFile)));
  const connection = db.connect();
  try {
    connection.query("ATTACH 'snapshot.duckdb' AS snapshot (READ_ONLY)");
    const rows = (sql: string) => connection.query(sql).toArray().map((row) => row.toJSON());
    const tables = rows(
      "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'snapshot' AND table_schema = 'main' ORDER BY 1",
    ).map((row) => String(row.table_name));
    if (tables.length === 0) throw new Error(`no tables in the main schema of ${dbFile}`);
    const digest = createHash("sha256");
    for (const table of tables) {
      const columns = rows(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_catalog = 'snapshot' AND table_schema = 'main' AND table_name = '${table.replaceAll("'", "''")}' ORDER BY ordinal_position`,
      ).map((row) => ({ name: String(row.column_name), type: String(row.data_type) }));
      const kept = columns.filter((column) => !EXCLUDED_COLUMNS.has(column.name));
      if (kept.length === 0) throw new Error(`table ${table} has no comparable columns after exclusions`);
      const list = kept.map((column) => quote(column.name)).join(", ");
      const result = connection.query(`SELECT ${list} FROM snapshot.main.${quote(table)} ORDER BY ${list}`);
      const vectors = kept.map((_, index) => result.getChildAt(index));
      digest.update(`table:${table}\ncolumns:${kept.map((column) => column.name).join(",")}\nrows:${result.numRows}\n`);
      for (let row = 0; row < result.numRows; row += 1) {
        digest.update(kept.map((column, index) => canonicalValue(vectors[index]?.get(row), column.type)).join("|"));
        digest.update("\n");
      }
    }
    return digest.digest("hex");
  } finally {
    connection.close();
  }
}
