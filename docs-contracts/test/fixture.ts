export const ROOTS = ["_project", "agent", "internal"];

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Contracts } from "../lib/types.ts";

export const VERSION = "1.2.3";
export const RELEASE_PATTERN =
  "(?P<prefix>Current\\s+release\\s*:?\\s*)(?P<marker>`?)v?(?P<version>\\d+\\.\\d+\\.\\d+(?:-[\\w\\.]+|(?:a|b|rc)\\d+)?)(?P=marker)(?P<suffix>[\\.]?)";

const STATUSES = ["stable", "beta", "experimental", "repo_only", "deprecated", "document_only"];
const COMPUTE_PLATFORMS = ["snowflake", "databricks", "databricks-df", "athena", "athena-spark", "firebolt", "synapse-spark", "fabric-spark", "emr-serverless", "snowpark-connect", "fabric_dw", "redshift"];
const COMPUTE_GUIDES = ["snowflake", "databricks", "databricks-dataframe", "athena", "athena-spark", "firebolt", "synapse-spark", "fabric-spark", "emr-serverless", "snowpark-connect", "microsoft-fabric", "redshift"];
const ENGINE_PLATFORMS: [string, string][] = [["pg-duckdb", "pg_duckdb"], ["dask", "dask-dataframe"], ["databricks", "databricks"], ["velox", "velox"]];

function option(kind: string, defaultValue: unknown = null, choices: string[] | null = null, aliases: string[] = []) {
  return { value_kind: kind, choices, default: defaultValue, aliases };
}

export function buildContracts(): Contracts {
  const platformOptions: Contracts["platform_options"]["platforms"] = {
    duckdb: { threads: option("integer"), memory_limit: option("string"), read_only: option("boolean", false), mode: option("string", "fast", ["fast", "safe"]) },
    snowflake: { warehouse: option("string", null, null, ["wh"]), compute_resource: option("string"), compute_size: option("string"), old_mode: option("string") },
  };
  for (const platform of COMPUTE_PLATFORMS) platformOptions[platform] ??= { compute_resource: option("string"), compute_size: option("string") };
  const engines: Contracts["execution"]["engines"] = {};
  for (const [platform] of ENGINE_PLATFORMS) engines[platform] = { declared: { duckdb: { class: "delegated" } }, selectable: ["alpha", "beta"] };
  return {
    result_schema_version: "1.0",
    package: {
      version: VERSION,
      core_dependencies: ["click"],
      optional_extras: ["all", "duckdb"],
      experimental_exported: false,
      release_marker: { pattern: RELEASE_PATTERN, flags: 34, version_group: "version" },
    },
    benchmarks: {
      ids: ["hidden", "tpcds", "tpch"],
      public_ids: ["tpcds", "tpch"],
      loader_ids: ["hidden", "tpcds", "tpch"],
      core_only_ids: ["hidden"],
      spec_ids: ["tpch"],
      support_status: { hidden: "repo_only", tpcds: "beta", tpch: "stable" },
      num_queries: { hidden: 1, tpcds: 99, tpch: 22 },
      supports_dataframe: { hidden: false, tpcds: false, tpch: true },
      registry_summary: { total: 3, loader: 3, public: 2, dataframe_supported: 1, support_status: { stable: 1, beta: 1, repo_only: 1 }, surface: {} },
      facades: { top_level: 2, lazy: 1, eager: 1 },
      api_surfaces: { public_base: "beta-public", run_with_platform: "beta-public", core_base: "deprecated", core_base_decision: "retained", loader: "internal" },
    },
    platforms: {
      count_summary: {
        total: 2,
        sql_capable: 2,
        dataframe_capable: 1,
        dual_mode: 1,
        dataframe_only: 0,
        support_status: { stable: 1, beta: 1, experimental: 0, repo_only: 0, deprecated: 0, document_only: 0 },
        category: { cloud: 1, embedded: 1 },
      },
      support_status_values: STATUSES,
      support_status_snapshot: Object.fromEntries(
        STATUSES.map((status) => [status, { entries: status === "stable" || status === "beta" ? 1 : 0, sql: status === "stable" || status === "beta" ? 1 : 0, dataframe: status === "stable" ? 1 : 0 }]),
      ),
      entries: {
        duckdb: { category: "embedded", support_status: "stable", supports_sql: true, supports_dataframe: true },
        snowflake: { category: "cloud", support_status: "beta", supports_sql: true, supports_dataframe: false },
      },
    },
    platform_manifest: { entries: [{ key: "duckdb" }, { key: "snowflake" }], aliases: { duck: "duckdb" } },
    execution: {
      deprecated_option_aliases: [{ platform: "snowflake", key: "old_mode", target: "mode", removed_in: "9.9.9" }],
      deployment_alias_keys: { snowflake: ["deployment_mode"] },
      engines,
      compute_resource_option: "compute_resource",
      compute_size_option: "compute_size",
      compute: { snowflake: { resource_aliases: ["warehouse"], size_aliases: [] } },
    },
    platform_options: { platforms: platformOptions, alias_index: { snowflake: { wh: "warehouse" } } },
    tuning: { aliases: {}, platforms: { duckdb: { applied_types: ["sort"], has_catalog_introspector: true, can_reach_applied_verified: true } } },
    cli: {
      commands: [
        { path: "benchbox", is_group: true, options: [{ names: ["--version"], is_flag: true, choices: null }] },
        { path: "benchbox profile", is_group: false, options: [] },
        { path: "benchbox run", is_group: false, options: [{ names: ["--platform"], is_flag: false, choices: null }, { names: ["--benchmark"], is_flag: false, choices: null }, { names: ["--force"], is_flag: true, choices: null }] },
        { path: "benchbox setup", is_group: false, options: [{ names: ["--platform"], is_flag: false, choices: ["duckdb", "singlestore"] }, { names: ["--validate-only"], is_flag: true, choices: null }] },
      ],
      help_catalog: { command_examples: { run: { examples: ["benchbox run --platform duckdb --platform-option threads=4"] } } },
    },
    mcp: {
      tools: {
        list_available: { params: {} },
        run_benchmark: { params: { benchmark: { type: "string", required: true, default: null }, scale_factor: { type: "number", required: false, default: 1 } } },
      },
      remote_only_tools: ["admin_reset"],
    },
    public_symbols: { dropped: [], symbols: [{ symbol: "benchbox.BaseBenchmark", name: "BaseBenchmark", aliases: [], kind: "class" }] },
    sf1_calibrated_sizes: { tolerance: 0.05, sizes: { ssb: 500, tpch: 1000 }, measurable_benchmark_ids: ["ssb", "tpch"], documented_without_generation: ["ai_primitives", "metadata_primitives"] },
    write_primitives: {
      validation_bounds: {
        sketch_query_theta_union_merge: { theta_storage_size_clickhouse: { min: 10000, max: 70000 } },
        sketch_query_kll_quantiles_merge: { kll_storage_size_clickhouse: { min: 1500, max: 8000 } },
        sketch_query_topk_combine: { topk_storage_size_clickhouse: { min: 100, max: 500 } },
      },
    },
    publication: {
      gated_roots: ["development"],
      allowlist: ["development/open.md", "development/result-integrity-validation.md"],
      exclusions: [...ROOTS.map((root) => `${root}/`), "development/closed.md"].sort(),
      excluded_roots: ["_project", "agent", "internal"],
      gated_pages: ["development/closed.md", "development/open.md", "development/result-integrity-validation.md"],
      linkcheck_ignore_patterns: [],
    },
    ownership: { counts: { "site-owned": 2 }, site_owned: ["docs/a.md", "docs/b.md"], core_generated: [] },
  } as unknown as Contracts;
}

export function buildPages(): Record<string, string> {
  const pages: Record<string, string> = {
    "README.md": `# BenchBox\n\nCurrent release: \`v${VERSION}\`. Use the CLI.\n`,
    "development/open.md": "# Open\n",
    "platforms/comparison-matrix.md":
      "# Matrix\n\n<!-- benchbox-registry-counts:start -->\n\nPlatform registry: **2** metadata entries; **2** SQL-capable; **1** DataFrame-capable; **1** dual-mode; support status counts: stable=1, beta=1, experimental=0, deprecated=0.\n\n<!-- benchbox-registry-counts:end -->\n",
    "platforms/support-status.md": [
      "# Support status",
      "<!-- benchbox-registry-counts:start -->",
      "Platform registry: stable=1, beta=1, experimental=0, deprecated=0.",
      "<!-- benchbox-registry-counts:end -->",
      "| Status | Entries | SQL | DataFrame | Dep | CLI | MCP | Docs |",
      "|---|---|---|---|---|---|---|---|",
      ...STATUSES.map((status) => {
        const live = status === "stable" || status === "beta";
        return `| \`${status}\` | ${live ? 1 : 0} | ${live ? 1 : 0} | ${status === "stable" ? 1 : 0} | group | cli | mcp | docs |`;
      }),
      "",
    ].join("\n"),
    "reference/public-contracts.md": [
      "# Public contracts",
      "| `benchbox.base.BaseBenchmark` | `beta-public` | base |",
      "| `BaseBenchmark.run_with_platform` | `beta-public` | hook |",
      "| `benchbox.core.base_benchmark.BaseBenchmark` | `deprecated` | legacy |",
      "| `benchbox.core.benchmark_loader` | `internal` | loader |",
      "Benchmark API snapshot: **3** registry entries; **3** loader-resolved core families; **2** public discovery entries; **2** top-level Python benchmark facades; **1** lazy facades; **1** eager facades; **1** core-only benchmark IDs. Benchmark support status: **1** stable, **1** beta, **0** experimental, **1** repo-only, **0** deprecated, **0** document-only.",
      "Registry: 3 benchmark metadata entries and 3 loader-resolved IDs; 2 platform metadata entries; 2 SQL-capable; 1 DataFrame-capable; 1 dual-mode.",
      "Current result schema version: `1.0`",
      "",
    ].join("\n"),
    "design/architecture.md": "There are currently 2 benchmarks.\n",
    "development/result-integrity-validation.md": "Specs exist for 1 of 2 registered benchmarks.\n",
    "reference/cli/utilities.md": "Specs cover 1 of 2 benchmarks.\n",
    "usage/faq.md": "BenchBox includes **2** public-discovery benchmarks.\n",
    "benchmarks/support-status.md": [
      "## Benchmark Status Rationale",
      "| Benchmark | Status | Rationale |",
      "|---|---|---|",
      "| `hidden` | `repo_only` | Internal 1-query probe; not DataFrame-capable. |",
      "| `tpcds` | `beta` | Decision-support 99-query suite; not DataFrame-capable. |",
      "| `tpch` | `stable` | Canonical 22-query suite; DataFrame-capable. |",
      "",
      "## Promotion",
      "",
    ].join("\n"),
    "usage/getting-started.md": [
      "# Getting started",
      "## Step 1 - Install",
      "```bash",
      "uv add benchbox --extra duckdb",
      "```",
      "## Step 2 - Profile",
      "```bash",
      "uv run -- benchbox profile",
      "uv run -- benchbox run \\",
      "  --platform duckdb \\",
      "  --benchmark tpch",
      "```",
      "",
    ].join("\n"),
    "usage/cli-quick-start.md": [
      "# CLI quick start",
      "```bash",
      "benchbox run --platform duckdb --benchmark tpch",
      "benchbox run --platform duck --benchmark tpch",
      "benchbox run --platform=$PLATFORM --benchmark tpch",
      "benchbox setup --platform singlestore",
      "```",
      "",
    ].join("\n"),
    "platforms/singlestore.md": "```bash\nbenchbox setup --platform singlestore --validate-only\n```\n",
    "reference/mcp.md": [
      "### Actual Tool Inventory",
      "| Tool | Purpose |",
      "| `list_available` | list |",
      "| `run_benchmark` | run |",
      "",
      "Authenticated remote mode additionally registers:",
      "",
      "| `admin_reset` | reset |",
      "",
      "### Run Surface Contract",
      "**MCP run parameter schema:**",
      "| Parameter | Type | Required | Default |",
      "| `benchmark` | string | Yes | - |",
      "| `scale_factor` | number | No | 1 |",
      "**Behavior:**",
      "#### `list_available`",
      "Nothing to pass.",
      "",
    ].join("\n"),
    "reference/python-api/index.md": "# API\n\n## BaseBenchmark\n",
    "benchmarks/sf1-calibrated-sizes.md": [
      "| Benchmark | Measured bytes |",
      "|---|---|",
      "| tpch | 1,000 |",
      "| ssb | 510 |",
      "| ai_primitives | 1,000 |",
      "| metadata_primitives | 0 |",
      "",
    ].join("\n"),
    "benchmarks/write-primitives-sketch-functions.md": [
      "ClickHouse (60003 bytes verified clickhouse-local 25.4.2, uniq HLL++ x);",
      "(4314 bytes verified clickhouse-local 25.4.2, T-Digest compression=100);",
      "(317 bytes verified clickhouse-local 25.4.2, topK K=8);",
      "",
    ].join("\n"),
  };
  for (const [, guide] of ENGINE_PLATFORMS) pages[`platforms/${guide}.md`] = "Engines: `alpha` and `beta`.\n";
  for (const guide of COMPUTE_GUIDES) pages[`platforms/${guide}.md`] ??= "Use `--platform-option compute_size=small`.\n";
  pages["platforms/snowflake.md"] = "```bash\nbenchbox run --platform snowflake --platform-option warehouse=WH --platform-option compute_size=small\n```\n";
  pages["usage/options.md"] = "```bash\nbenchbox run --platform duckdb --platform-option threads=4 --platform-option read_only=true --platform-option mode=fast\n```\n\nAlso `--platform-option memory_limit=2GB`.\n";
  return pages;
}

export function writeBundle(options: { schema: number; contracts?: Contracts | null; pages: Record<string, string>; packageVersion?: string }): string {
  const root = mkdtempSync(path.join(tmpdir(), "docs-contracts-"));
  const contracts = options.contracts === undefined ? buildContracts() : options.contracts;
  for (const [name, body] of Object.entries(options.pages)) {
    mkdirSync(path.dirname(path.join(root, "docs", name)), { recursive: true });
    writeFileSync(path.join(root, "docs", name), body);
  }
  if (contracts !== null) writeFileSync(path.join(root, "doc-contracts.json"), JSON.stringify(contracts));
  writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ schema: options.schema, core_sha: "a".repeat(40), package_version: options.packageVersion ?? VERSION }));
  return root;
}
