import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocsData } from "../src/lib/docs-generators/docs-data.ts";
import { parseDocsData } from "../src/lib/docs-generators/docs-data.ts";
import { renderCompatPages } from "../src/lib/docs-generators/compat-pages.ts";
import { generateDocsPages } from "../src/lib/docs-generators/generate.ts";
import { renderQueryPages } from "../src/lib/docs-generators/query-pages.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "docs-data.json");
const schemaPath = path.join(here, "..", "..", "scripts", "schemas", "docs-data.schema.json");
const goldenRoot = path.join(here, "docs-generators-golden");
const update = process.env.UPDATE_GOLDEN === "1";
const TUNING_PAGE = "reference/tuning-platform-support.md";

function docsData(): DocsData {
  return parseDocsData(readFileSync(fixturePath, "utf-8"));
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const absolute = path.join(root, name);
    if (statSync(absolute).isDirectory()) found.push(...filesUnder(absolute).map((entry) => `${name}/${entry}`));
    else found.push(name);
  }
  return found;
}

function goldenCase(name: string, produce: () => Map<string, string>): void {
  describe(`generated pages: ${name}`, () => {
    const root = path.join(goldenRoot, name);
    const produced = produce();

    beforeAll(() => {
      if (!update) return;
      rmSync(root, { recursive: true, force: true });
      for (const [relative, content] of produced) {
        const target = path.join(root, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
    });

    it("produces exactly the golden path set", () => {
      expect([...produced.keys()].sort()).toEqual(filesUnder(root));
    });

    it.each([...produced.keys()].sort())("matches the golden for %s", (relative) => {
      expect(produced.get(relative)).toBe(readFileSync(path.join(root, relative), "utf-8"));
    });
  });
}

describe("docs-data fixture", () => {
  it("validates against the vendored docs-data schema", () => {
    const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, validateFormats: false });
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf-8")));
    const valid = validate(JSON.parse(readFileSync(fixturePath, "utf-8")));
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });
});

goldenCase("full", () => generateDocsPages(docsData()));

goldenCase("no-aliases", () => {
  const data = docsData();
  data.tuning.aliases = {};
  const tuning = generateDocsPages(data).get(TUNING_PAGE);
  if (tuning === undefined) throw new Error("tuning page was not generated");
  return new Map([[TUNING_PAGE, tuning]]);
});

describe("query pages", () => {
  it("fails on a group that lists an unknown query", () => {
    const data = docsData();
    const grouped = data.queries.benchmarks[1];
    if (grouped.groups === null) throw new Error("fixture lost its groups");
    grouped.groups[0].query_ids.push("missing");
    expect(() => renderQueryPages(data)).toThrow("missing");
  });
});

describe("compat pages", () => {
  it("renders empty states without platform sections", () => {
    const files = renderCompatPages({
      compat: { phase_order: ["query_compile"], will_not_run_levels: ["BLOCKED"], runs_with_caveats_levels: ["INFORMATIONAL"], rules: [] },
    });
    expect(files.get("compat/capability-matrix.md")).toContain("| platform | total |");
    expect(files.get("compat/skip-reference.md")).toContain("_No BLOCKED, SKIPPED_QUERY, SKIPPED_DDL_FRAGMENT, or INFORMATIONAL rules are registered._");
  });
});

describe("docs-data loading", () => {
  it("rejects unknown schemas and missing sections", () => {
    expect(() => parseDocsData('{"schema_version": 2}')).toThrow("schema_version");
    expect(() => parseDocsData('{"schema_version": 1}')).toThrow("queries");
    expect(() => parseDocsData("[]")).toThrow("JSON object");
  });

  it("loads the schema version it understands", () => {
    const data = parseDocsData('{"schema_version": 1, "queries": {}, "compat": {}, "tuning": {}}');
    expect(data.schema_version).toBe(1);
  });
});
