import { openSnapshot, type SnapshotDb } from "../../../explorer/src/testing/snapshotDb.ts";
import { siteInputsPath } from "./site-inputs.ts";

let snapshot: Promise<SnapshotDb> | undefined;

export async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  snapshot ??= openSnapshot(siteInputsPath("explorer", "results.duckdb"));
  return (await snapshot).queryRows<T>(sql, params);
}
