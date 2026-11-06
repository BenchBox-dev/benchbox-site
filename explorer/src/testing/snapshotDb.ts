import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

interface ArrowRow {
  toJSON(): unknown;
}
interface ArrowTable {
  toArray(): ArrowRow[];
}
interface Statement {
  query(...params: unknown[]): ArrowTable;
  close(): void;
}
interface Connection {
  query(sql: string): ArrowTable;
  prepare(sql: string): Statement;
  close(): void;
}
interface Bindings {
  instantiate(): Promise<unknown>;
  open(config: object): void;
  registerFileBuffer(name: string, buffer: Uint8Array): void;
  connect(): Connection;
}
interface NodeBlocking {
  createDuckDB(bundles: object, logger: object, runtime: object): Promise<Bindings>;
  VoidLogger: new () => object;
  NODE_RUNTIME: object;
}

export interface SnapshotDb {
  queryRows<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): void;
}

const require = createRequire(import.meta.url);

export async function openSnapshot(file: string): Promise<SnapshotDb> {
  const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs") as NodeBlocking;
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
  const bundles = {
    mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({});
  db.registerFileBuffer("snapshot.duckdb", new Uint8Array(readFileSync(file)));
  const connection = db.connect();
  connection.query("ATTACH 'snapshot.duckdb' AS bench (READ_ONLY)");
  return {
    async queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (params.length === 0) return connection.query(sql).toArray().map((row) => row.toJSON() as T);
      const statement = connection.prepare(sql);
      try {
        return statement
          .query(...params)
          .toArray()
          .map((row) => row.toJSON() as T);
      } finally {
        statement.close();
      }
    },
    close() {
      connection.close();
    },
  };
}
