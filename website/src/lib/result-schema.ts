import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const RESULT_SCHEMA_MEMBER = "result-bundle.schema.json";
export const RESULT_SCHEMA_ROUTE = path.join("schemas", "result-bundle-2.schema.json");
export const RESULT_SCHEMA_ID = "https://benchbox.dev/schemas/result-bundle-2.schema.json";

export function publishResultSchema(bundleRoot: string, out: string): boolean {
  const source = path.join(bundleRoot, RESULT_SCHEMA_MEMBER);
  if (!existsSync(source)) return false;
  const schema = JSON.parse(readFileSync(source, "utf-8")) as { $id?: unknown };
  if (schema.$id !== RESULT_SCHEMA_ID) {
    throw new Error(`${RESULT_SCHEMA_MEMBER} has $id ${JSON.stringify(schema.$id)}, not ${RESULT_SCHEMA_ID}`);
  }
  const target = path.join(out, RESULT_SCHEMA_ROUTE);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}
