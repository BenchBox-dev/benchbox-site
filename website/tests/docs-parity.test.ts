import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocsData } from "../src/lib/docs-generators/docs-data.ts";
import { generateDocsPages } from "../src/lib/docs-generators/generate.ts";
import { compareDocsPages, formatParityReport, readBundledScope, runParity } from "../src/lib/docs-generators/parity.ts";

const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "docs-parity.ts");

function docsData(): DocsData {
  return {
    schema_version: 1,
    queries: {
      reference_dialect: "datafusion",
      tpc_notice: "> TPC test notice.",
      group_threshold: 30,
      bucket_size: 25,
      tpcds_parity_notes_url: "https://example.invalid/parity",
      tpcds_subscale_notes_url: "https://example.invalid/subscale",
      benchmarks: [
        {
          id: "flat",
          display_name: "Flat Demo",
          overview_slug: "flat-demo",
          query_count: 1,
          tpc_derived: false,
          seed_driven: false,
          supports_dialect_translation: true,
          default_scale: 0.01,
          recipe: { import_line: "from benchbox import FlatDemo", class_name: "FlatDemo" },
          groups: null,
          queries: [
            {
              id: "1",
              slug: "q1",
              label: "Q1",
              display_name: "First Query",
              heading: "Flat Demo Q1",
              description: "Counts things.",
              groups: [],
              native_key: "1",
              native_key_repr: "'1'",
              source_path: null,
              seed_driven: false,
              answer_set_note: null,
              subscale_note: null,
              sql: { dialect: "datafusion", is_template: false, sql: "SELECT 1", pretty_sql: "SELECT 1" },
              sql_native: null,
              reference_dialect_label: "DataFusion",
              dataframe: null,
              dataframe_renderings: [],
            },
          ],
        },
      ],
    },
    compat: {
      phase_order: ["query_compile"],
      will_not_run_levels: ["BLOCKED"],
      runs_with_caveats_levels: ["INFORMATIONAL"],
      rules: [
        {
          platform: "a_platform",
          phase: "query_compile",
          benchmark: null,
          query_id: null,
          scope: "platform-wide",
          action: "flag",
          support_level: "INFORMATIONAL",
          failure_mode: "NONE",
          rule_id: "query_compile.a_platform.all.note",
          reason: "Notes a caveat.",
        },
      ],
    },
    tuning: {
      aliases: {},
      platforms: [
        {
          platform: "alpha",
          shipped_templates: ["tpch"],
          applied: [{ type: "sorting", requires_sorted_ingestion: true }],
          not_applied: ["partitioning"],
          session_config: false,
          catalog_introspector: true,
          can_reach_applied_verified: true,
        },
      ],
    },
  };
}

function generatedBuffers(): Map<string, Buffer> {
  return new Map([...generateDocsPages(docsData())].map(([relative, content]) => [relative, Buffer.from(content, "utf-8")]));
}

let bundle: string;

function writeBundle(files: Map<string, Buffer>, schema = 4): void {
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(path.join(bundle, "docs-data"), { recursive: true });
  writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify({ schema, core_sha: "abc123" }));
  writeFileSync(path.join(bundle, "docs-data", "docs-data.json"), JSON.stringify(docsData()));
  for (const [relative, bytes] of files) {
    mkdirSync(path.dirname(path.join(bundle, "docs", relative)), { recursive: true });
    writeFileSync(path.join(bundle, "docs", relative), bytes);
  }
}

beforeEach(() => {
  bundle = mkdtempSync(path.join(os.tmpdir(), "docs-parity-"));
});

afterEach(() => {
  rmSync(bundle, { recursive: true, force: true });
});

describe("docs parity comparison", () => {
  it("passes when every generated file is byte-identical to the bundled file", () => {
    const report = compareDocsPages(generatedBuffers(), generatedBuffers());
    expect(report.diffs).toEqual([]);
    expect(report.identical).toBe(report.generated);
  });

  it("names the path and position of a one-byte drift", () => {
    const bundled = generatedBuffers();
    const target = "compat/capability-matrix.md";
    const original = bundled.get(target) as Buffer;
    const drifted = Buffer.from(original);
    const offset = original.indexOf("a_platform");
    drifted[offset] = "b".charCodeAt(0);
    bundled.set(target, drifted);
    const report = compareDocsPages(generatedBuffers(), bundled);
    expect(report.diffs).toHaveLength(1);
    const [diff] = report.diffs;
    expect(diff).toMatchObject({ kind: "changed", path: target, offset });
    const text = formatParityReport(report);
    expect(text).toContain(`CHANGED ${target}`);
    expect(text).toContain("first difference at byte " + offset);
    expect(text).toContain("changed 1, missing from bundle 0, not generated 0");
  });

  it("reports a length-only difference at the end of the shorter file", () => {
    const bundled = generatedBuffers();
    const target = "benchmarks/queries/index.md";
    const original = bundled.get(target) as Buffer;
    bundled.set(target, Buffer.concat([original, Buffer.from("\n")]));
    const report = compareDocsPages(generatedBuffers(), bundled);
    expect(report.diffs).toMatchObject([{ kind: "changed", path: target, offset: original.length }]);
  });

  it("fails a generated file absent from the bundle", () => {
    const bundled = generatedBuffers();
    bundled.delete("reference/tuning-platform-support.md");
    const report = compareDocsPages(generatedBuffers(), bundled);
    expect(report.diffs).toMatchObject([{ kind: "missing", path: "reference/tuning-platform-support.md" }]);
    expect(formatParityReport(report)).toContain("MISSING reference/tuning-platform-support.md");
  });

  it("fails a bundled file in the generated scope that is not generated", () => {
    const bundled = generatedBuffers();
    bundled.set("benchmarks/queries/flat/stale.md", Buffer.from("stale"));
    const report = compareDocsPages(generatedBuffers(), bundled);
    expect(report.diffs).toMatchObject([{ kind: "extra", path: "benchmarks/queries/flat/stale.md" }]);
    expect(formatParityReport(report)).toContain("EXTRA benchmarks/queries/flat/stale.md");
  });

  it("limits the listing and says how many differences it omitted", () => {
    const bundled = new Map<string, Buffer>();
    for (let index = 0; index < 5; index += 1) bundled.set(`compat/extra-${index}.md`, Buffer.from("x"));
    const text = formatParityReport(compareDocsPages(new Map(), bundled), 2);
    expect(text).toContain("3 more differences");
    expect(text.match(/^EXTRA /gm)).toHaveLength(2);
  });
});

describe("bundled scope", () => {
  it("reads only generated directories and files, ignoring hand-written pages", () => {
    writeBundle(
      new Map([
        ["compat/capability-matrix.md", Buffer.from("a")],
        ["compat/nested/page.md", Buffer.from("b")],
        ["reference/tuning-platform-support.md", Buffer.from("c")],
        ["reference/other.md", Buffer.from("d")],
        ["guides/intro.md", Buffer.from("e")],
      ]),
    );
    const scope = readBundledScope(path.join(bundle, "docs"));
    expect([...scope.keys()].sort()).toEqual(["compat/capability-matrix.md", "compat/nested/page.md", "reference/tuning-platform-support.md"]);
  });
});

describe("docs parity run", () => {
  it("passes against a bundle whose docs equal the generated output", () => {
    const files = generatedBuffers();
    files.set("guides/intro.md", Buffer.from("hand written"));
    writeBundle(files);
    const result = runParity(bundle);
    expect(result.status).toBe("pass");
    if (result.status === "not-applicable") return;
    expect(result.identity).toMatchObject({ schema: 4, coreSha: "abc123" });
    expect(Object.keys(result.generatedInventory)).toEqual(Object.keys(result.bundledInventory));
    expect(result.generatedInventory).toEqual(result.bundledInventory);
  });

  it("fails against a bundle with a seeded drift and extra and missing paths", () => {
    const files = generatedBuffers();
    const matrix = files.get("compat/capability-matrix.md") as Buffer;
    files.set("compat/capability-matrix.md", Buffer.concat([matrix, Buffer.from(" ")]));
    files.delete("benchmarks/queries/flat/q1.md");
    files.set("compat/stale.md", Buffer.from("stale"));
    writeBundle(files);
    const result = runParity(bundle);
    expect(result.status).toBe("fail");
    if (result.status === "not-applicable") return;
    expect(result.report.diffs.map((diff) => `${diff.kind} ${diff.path}`).sort()).toEqual([
      "changed compat/capability-matrix.md",
      "extra compat/stale.md",
      "missing benchmarks/queries/flat/q1.md",
    ]);
  });

  it("is not applicable to a bundle without docs-data", () => {
    writeBundle(new Map(), 4);
    rmSync(path.join(bundle, "docs-data"), { recursive: true });
    expect(runParity(bundle).status).toBe("not-applicable");
  });

  it("is not applicable to a bundle that has docs-data but no docs member", () => {
    writeBundle(new Map(), 5);
    const result = runParity(bundle);
    expect(result.status).toBe("not-applicable");
    expect(result.status === "not-applicable" && result.message).toContain("no docs member");
  });
});

describe("docs parity command", () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SCRIPT, "--bundle", bundle, ...args], {
      encoding: "utf-8",
    });
  }

  it("exits zero on parity and writes a complete inventory report", () => {
    writeBundle(generatedBuffers());
    const reportFile = path.join(bundle, "report.json");
    const result = run("--report", reportFile);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs parity OK");
    const report = JSON.parse(readFileSync(reportFile, "utf-8"));
    expect(report.status).toBe("pass");
    expect(Object.keys(report.generatedInventory).length).toBe(Object.keys(report.bundledInventory).length);
  });

  it("exits nonzero and names the drifted path", () => {
    const files = generatedBuffers();
    const index = files.get("benchmarks/queries/index.md") as Buffer;
    files.set("benchmarks/queries/index.md", Buffer.concat([Buffer.from("X"), index.subarray(1)]));
    writeBundle(files);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("CHANGED benchmarks/queries/index.md");
    expect(result.stderr).toContain("docs parity FAILED");
  });

  it("treats a bundle without docs-data as not applicable unless applicability is required", () => {
    writeBundle(new Map(), 4);
    rmSync(path.join(bundle, "docs-data"), { recursive: true });
    expect(run().status).toBe(0);
    expect(run().stdout).toContain("not applicable");
    expect(run("--require-applicable").status).toBe(1);
  });
});
