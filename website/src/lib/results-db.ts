import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as duckdbBlocking from "@duckdb/duckdb-wasm/blocking";
import type { DuckDBBindings, DuckDBConnection } from "@duckdb/duckdb-wasm/blocking";

const SNAPSHOT_FILE = "results.duckdb";

type Blocking = typeof duckdbBlocking;

const require = createRequire(import.meta.url);
const wasmDist = path.dirname(require.resolve("@duckdb/duckdb-wasm"));

let connection: DuckDBConnection | undefined;
let attachedFrom: string | undefined;

async function bindings(): Promise<DuckDBBindings> {
  const duckdb = require("@duckdb/duckdb-wasm/blocking") as Blocking;
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(wasmDist, "duckdb-mvp.wasm"), mainWorker: "" },
      eh: { mainModule: path.join(wasmDist, "duckdb-eh.wasm"), mainWorker: "" },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate(() => {});
  return db;
}

export async function openResultsSnapshot(file: string): Promise<void> {
  if (connection !== undefined) {
    if (attachedFrom !== file) throw new Error(`a results snapshot is already open from ${attachedFrom}; refusing to open ${file}`);
    return;
  }
  const db = await bindings();
  db.registerFileBuffer(SNAPSHOT_FILE, new Uint8Array(readFileSync(file)));
  const opened = db.connect();
  opened.query(`ATTACH '${SNAPSHOT_FILE}' AS bench (READ_ONLY)`);
  connection = opened;
  attachedFrom = file;
}

export function closeResultsSnapshot(): void {
  connection?.close();
  connection = undefined;
  attachedFrom = undefined;
}

function plain<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])) as T;
}

export async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (connection === undefined) throw new Error("no results snapshot is open; call openResultsSnapshot first");
  if (params.length === 0) return connection.query(sql).toArray().map((row) => plain<T>(row.toJSON()));
  const statement = connection.prepare(sql);
  try {
    return statement.query(...params).toArray().map((row) => plain<T>(row.toJSON()));
  } finally {
    statement.close();
  }
}
