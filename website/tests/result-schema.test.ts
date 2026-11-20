import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishResultSchema, RESULT_SCHEMA_ID, RESULT_SCHEMA_MEMBER, RESULT_SCHEMA_ROUTE } from "../src/lib/result-schema.ts";

describe("published result bundle schema", () => {
  let root: string;
  let bundle: string;
  let out: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "result-schema-"));
    bundle = path.join(root, "bundle");
    out = path.join(root, "out");
    mkdirSync(bundle, { recursive: true });
    mkdirSync(out, { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("publishes the bundle member byte for byte at the stable route", () => {
    const body = `${JSON.stringify({ $id: RESULT_SCHEMA_ID, result_schema_version: "2.4" })}\n`;
    writeFileSync(path.join(bundle, RESULT_SCHEMA_MEMBER), body);
    expect(publishResultSchema(bundle, out)).toBe(true);
    expect(RESULT_SCHEMA_ROUTE).toBe(path.join("schemas", "result-bundle-2.schema.json"));
    expect(readFileSync(path.join(out, RESULT_SCHEMA_ROUTE), "utf-8")).toBe(body);
  });

  it("publishes nothing for a bundle without the member", () => {
    expect(publishResultSchema(bundle, out)).toBe(false);
    expect(existsSync(path.join(out, "schemas"))).toBe(false);
  });

  it("refuses a schema with another id", () => {
    writeFileSync(path.join(bundle, RESULT_SCHEMA_MEMBER), JSON.stringify({ $id: "https://example.com/other.json" }));
    expect(() => publishResultSchema(bundle, out)).toThrow(/not https:\/\/benchbox.dev\/schemas\/result-bundle-2.schema.json/);
    expect(existsSync(path.join(out, "schemas"))).toBe(false);
  });
});
