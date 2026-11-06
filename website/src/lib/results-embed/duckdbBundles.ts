import type * as duckdb from "@duckdb/duckdb-wasm";

export const LOCAL_DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: "/results/assets/duckdb-mvp.wasm",
    mainWorker: "/results/assets/duckdb-browser-mvp.worker.js",
  },
  eh: {
    mainModule: "/results/assets/duckdb-eh.wasm",
    mainWorker: "/results/assets/duckdb-browser-eh.worker.js",
  },
};
