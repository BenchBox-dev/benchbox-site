import { sorted } from "../lib/markdown.ts";
import { page, type Context, type Contracts, type Violation } from "../lib/types.ts";

const GUIDE_PLATFORMS: [string, string][] = [
  ["snowflake", "snowflake"],
  ["databricks", "databricks"],
  ["databricks-dataframe", "databricks-df"],
  ["athena", "athena"],
  ["athena-spark", "athena-spark"],
  ["firebolt", "firebolt"],
  ["synapse-spark", "synapse-spark"],
  ["fabric-spark", "fabric-spark"],
  ["emr-serverless", "emr-serverless"],
  ["snowpark-connect", "snowpark-connect"],
  ["microsoft-fabric", "fabric_dw"],
  ["redshift", "redshift"],
];
const ENGINE_GUIDES: [string, string][] = [
  ["pg-duckdb", "platforms/pg_duckdb.md"],
  ["dask", "platforms/dask-dataframe.md"],
  ["databricks", "platforms/databricks.md"],
  ["velox", "platforms/velox.md"],
];
const SKETCH_PAGE = "benchmarks/write-primitives-sketch-functions.md";
const SKETCH_CLAIMS = [
  { op: "sketch_query_theta_union_merge", validation: "theta_storage_size_clickhouse", pattern: /(\d{4,6})\s+bytes verified clickhouse-local\s+[\d.]+,\s+uniq HLL\+\+/ },
  { op: "sketch_query_kll_quantiles_merge", validation: "kll_storage_size_clickhouse", pattern: /(\d{4,6})\s+bytes verified clickhouse-local\s+[\d.]+,\s+T-Digest/ },
  { op: "sketch_query_topk_combine", validation: "topk_storage_size_clickhouse", pattern: /(\d{2,6})\s+bytes verified clickhouse-local\s+[\d.]+,\s+topK/ },
];
const INSTALL_PAGES = ["usage/installation.md", "platforms/platform-selection-guide.md", "platforms/duckdb.md", "usage/faq.md"];
const DUCKDB_DEFAULT_PHRASES = [
  "DuckDB is included with BenchBox by default",
  "included by default with BenchBox",
  "DuckDB is automatically installed as a dependency",
  "works with DuckDB out of the box",
  "DuckDB is embedded and ready to go",
];

export function pythonPatternToJs(marker: Contracts["package"]["release_marker"]): RegExp {
  const unsupported = marker.flags & ~(2 | 32);
  if (unsupported !== 0) throw new Error(`release marker uses regex flags ${marker.flags} that the checker cannot translate`);
  const source = marker.pattern.replace(/\(\?P<([A-Za-z_]\w*)>/g, "(?<$1>").replace(/\(\?P=([A-Za-z_]\w*)\)/g, "\\k<$1>");
  return new RegExp(source, `g${marker.flags & 2 ? "i" : ""}`);
}

export function pageViolations(ctx: Context): Violation[] {
  const { contracts } = ctx;
  const found: Violation[] = [];
  const fail = (check: string, path: string, invariant: string): void => {
    found.push({ check, page: path, invariant });
  };
  const need = (path: string): string | null => {
    const entry = page(ctx, path);
    if (entry === undefined) fail("page-present", path, "page named by a contract check is not published");
    return entry?.text ?? null;
  };

  const marker = pythonPatternToJs(contracts.package.release_marker);
  for (const entry of ctx.pages) {
    for (const match of entry.text.matchAll(marker)) {
      const version = match.groups?.[contracts.package.release_marker.version_group];
      if (version !== contracts.package.version) fail("version-token", entry.path, `release marker says ${version}, package.version is ${contracts.package.version}`);
    }
  }

  const names = new Set<string>();
  for (const entry of ctx.pages.filter((candidate) => candidate.path.startsWith("reference/python-api/"))) {
    for (const heading of entry.text.matchAll(/^#{1,6}\s+(.*)$/gm)) for (const word of heading[1].matchAll(/[A-Za-z_][A-Za-z0-9_.]*/g)) names.add(word[0]);
    for (const anchor of entry.text.matchAll(/(?:\(([A-Za-z0-9_.-]+)\)=|\bid=["']([^"']+)["']|<a\s+name=["']([^"']+)["'])/g)) {
      for (const group of anchor.slice(1)) if (group) names.add(group);
    }
  }
  const missing = contracts.public_symbols.symbols.filter((item) => {
    const candidates = new Set([item.symbol, ...(item.name ? [item.name] : []), ...item.aliases]);
    for (const candidate of [...candidates]) candidates.add(candidate.slice(candidate.lastIndexOf(".") + 1));
    return ![...candidates].some((candidate) => names.has(candidate));
  });
  if (missing.length > 0) fail("api-symbols", "reference/python-api/", `public symbols without an authored heading or anchor: ${sorted(missing.map((item) => item.symbol)).join(", ")}`);

  const sf1 = need("benchmarks/sf1-calibrated-sizes.md");
  if (sf1 !== null) {
    const path = "benchmarks/sf1-calibrated-sizes.md";
    const parsed = new Map<string, number>();
    for (const line of sf1.split("\n")) {
      if (!line.startsWith("| ") || line.includes("Benchmark")) continue;
      const cells = line.split("|").map((cell) => cell.trim());
      const value = Number(cells[2]?.replace(/,/g, ""));
      if (Number.isInteger(value)) parsed.set(cells[1], value);
    }
    const sizes = contracts.sf1_calibrated_sizes;
    for (const id of [...sizes.measurable_benchmark_ids, ...sizes.documented_without_generation]) {
      if (!parsed.has(id)) fail("sf1-sizes", path, `${id} is missing from the calibrated size table`);
    }
    for (const [id, expected] of Object.entries(sizes.sizes)) {
      const actual = parsed.get(id);
      if (actual !== undefined && Math.abs(actual - expected) > sizes.tolerance * Math.abs(expected)) {
        fail("sf1-sizes", path, `${id} is ${actual} bytes, baseline expects ${expected} within ${sizes.tolerance}`);
      }
    }
    for (const [id, actual] of parsed) {
      if (!(id in sizes.sizes) && !sizes.documented_without_generation.includes(id)) fail("sf1-sizes", path, `${id} has no baseline entry`);
      if (id === "metadata_primitives" ? actual !== 0 : actual <= 0) fail("sf1-sizes", path, `${id} has an invalid size ${actual}`);
    }
    if (parsed.get("ai_primitives") !== parsed.get("tpch")) fail("sf1-sizes", path, "ai_primitives must equal tpch");
  }

  const sketch = need(SKETCH_PAGE);
  if (sketch !== null) {
    for (const claim of SKETCH_CLAIMS) {
      const bound = contracts.write_primitives.validation_bounds[claim.op]?.[claim.validation];
      const match = claim.pattern.exec(sketch);
      if (bound === undefined) fail("sketch-bounds", SKETCH_PAGE, `contracts hold no validation bound for ${claim.op}/${claim.validation}`);
      else if (match === null) fail("sketch-bounds", SKETCH_PAGE, `storage-size claim for ${claim.op} is missing`);
      else {
        const observed = Number(match[1]);
        if (observed < bound.min || (bound.max !== null && observed > bound.max)) fail("sketch-bounds", SKETCH_PAGE, `${claim.op} claims ${observed} bytes, the catalog bound is [${bound.min}, ${bound.max}]`);
      }
    }
  }

  for (const [platform, path] of ENGINE_GUIDES) {
    const text = need(path);
    const engines = contracts.execution.engines[platform];
    if (engines === undefined) fail("execution-vocabulary", path, `contracts declare no engines for ${platform}`);
    else if (text !== null) {
      for (const engine of engines.selectable) if (!text.includes(`\`${engine}\``)) fail("execution-vocabulary", path, `guide does not list selectable engine ${engine}`);
    }
  }

  for (const [guide, platform] of GUIDE_PLATFORMS) {
    const path = `platforms/${guide}.md`;
    const text = need(path);
    if (text === null) continue;
    const specs = contracts.platform_options.platforms[platform];
    if (specs === undefined) {
      fail("compute-resource-guides", path, `contracts hold no option specs for ${platform}`);
      continue;
    }
    const declaration = contracts.execution.compute[platform];
    const computeKeys = new Set([contracts.execution.compute_resource_option, contracts.execution.compute_size_option, ...(declaration?.resource_aliases ?? []), ...(declaration?.size_aliases ?? [])]);
    if (platform === "fabric_dw") for (const key of ["database", "warehouse"]) computeKeys.add(key);
    const accepted = new Set(Object.keys(specs));
    for (const spec of Object.values(specs)) for (const alias of spec.aliases) accepted.add(alias);
    for (const match of text.matchAll(/--platform-option\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      if (computeKeys.has(match[1]) && !accepted.has(match[1])) fail("compute-resource-guides", path, `example uses ${match[1]}, which ${platform} does not accept`);
    }
  }

  const { package: pkg } = contracts;
  if (pkg.core_dependencies.includes("duckdb") || !pkg.optional_extras.includes("duckdb")) {
    fail("install-surface", "doc-contracts.json", "duckdb is no longer an optional extra, so the install pages must be rewritten");
  }
  for (const path of INSTALL_PAGES) {
    const entry = page(ctx, path);
    if (entry === undefined) continue;
    for (const phrase of DUCKDB_DEFAULT_PHRASES) if (entry.text.includes(phrase)) fail("install-surface", path, `claims DuckDB is a default dependency: ${phrase}`);
  }
  return found;
}
