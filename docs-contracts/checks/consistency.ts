import { sameSet, sorted, tally } from "../lib/markdown.ts";
import type { Context, Counts, Violation } from "../lib/types.ts";

const WHERE = "doc-contracts.json";

function countDiffs(label: string, actual: Counts, expected: Counts): string[] {
  const keys = sorted(new Set([...Object.keys(actual), ...Object.keys(expected)]));
  return keys.filter((key) => (actual[key] ?? 0) !== (expected[key] ?? 0)).map((key) => `${label}.${key} is ${actual[key] ?? 0}, entries give ${expected[key] ?? 0}`);
}

function setDiffs(label: string, actual: Iterable<string>, expected: Iterable<string>): string[] {
  const { missing, extra } = sameSet(actual, expected);
  return [...missing.map((value) => `${label} lacks ${value}`), ...extra.map((value) => `${label} has unexpected ${value}`)];
}

export function consistencyViolations({ manifest, contracts }: Context): Violation[] {
  const found: Violation[] = [];
  const add = (check: string, invariant: string): void => {
    found.push({ check, page: WHERE, invariant });
  };

  if (contracts.package.version !== manifest.package_version) {
    add("package-version", `package.version ${contracts.package.version} differs from manifest package_version ${manifest.package_version}`);
  }

  const { benchmarks, platforms } = contracts;
  const entries = Object.values(platforms.entries);
  const summary = platforms.count_summary;
  const derived = {
    total: entries.length,
    sql_capable: entries.filter((entry) => entry.supports_sql).length,
    dataframe_capable: entries.filter((entry) => entry.supports_dataframe).length,
    dual_mode: entries.filter((entry) => entry.supports_sql && entry.supports_dataframe).length,
    dataframe_only: entries.filter((entry) => !entry.supports_sql && entry.supports_dataframe).length,
  };
  for (const [field, value] of Object.entries(derived)) {
    const stated = summary[field as keyof typeof derived];
    if (stated !== value) add("platform-counts", `platforms.count_summary.${field} is ${stated}, entries give ${value}`);
  }
  for (const message of countDiffs("platforms.count_summary.support_status", summary.support_status, tally(entries, (entry) => entry.support_status))) {
    add("platform-counts", message);
  }
  for (const message of countDiffs("platforms.count_summary.category", summary.category, tally(entries, (entry) => entry.category))) {
    add("platform-counts", message);
  }
  for (const message of setDiffs("platforms.support_status_snapshot", Object.keys(platforms.support_status_snapshot), platforms.support_status_values)) {
    add("platform-status-snapshot", message);
  }
  for (const status of platforms.support_status_values) {
    const members = entries.filter((entry) => entry.support_status === status);
    const row = platforms.support_status_snapshot[status];
    if (row === undefined) continue;
    const expected = { entries: members.length, sql: members.filter((entry) => entry.supports_sql).length, dataframe: members.filter((entry) => entry.supports_dataframe).length };
    for (const [field, value] of Object.entries(expected)) {
      if (row[field as keyof typeof expected] !== value) add("platform-status-snapshot", `${status}.${field} is ${row[field as keyof typeof expected]}, entries give ${value}`);
    }
  }
  for (const message of setDiffs("platform_manifest.entries", contracts.platform_manifest.entries.map((entry) => entry.key), Object.keys(platforms.entries))) {
    add("platform-manifest", message);
  }

  const registry = benchmarks.registry_summary;
  const registryChecks: [string, number, number][] = [
    ["total", registry.total, benchmarks.ids.length],
    ["loader", registry.loader, benchmarks.loader_ids.length],
    ["public", registry.public, benchmarks.public_ids.length],
    ["dataframe_supported", registry.dataframe_supported, Object.values(benchmarks.supports_dataframe).filter(Boolean).length],
    ["facades.top_level", benchmarks.facades.top_level, benchmarks.ids.length - benchmarks.core_only_ids.length],
    ["facades.lazy + facades.eager", benchmarks.facades.lazy + benchmarks.facades.eager, benchmarks.facades.top_level],
  ];
  for (const [field, stated, expected] of registryChecks) {
    if (stated !== expected) add("benchmark-counts", `benchmarks ${field} is ${stated}, ids give ${expected}`);
  }
  for (const message of countDiffs("benchmarks.registry_summary.support_status", registry.support_status, tally(Object.values(benchmarks.support_status), (status) => status))) {
    add("benchmark-counts", message);
  }
  const known = new Set(benchmarks.ids);
  for (const [field, ids] of [["public_ids", benchmarks.public_ids], ["loader_ids", benchmarks.loader_ids], ["core_only_ids", benchmarks.core_only_ids], ["spec_ids", benchmarks.spec_ids]] as const) {
    for (const id of ids) if (!known.has(id)) add("benchmark-ids", `benchmarks.${field} names ${id}, which is not a registry id`);
  }
  const publicIds = new Set(benchmarks.public_ids);
  for (const id of benchmarks.spec_ids) if (!publicIds.has(id)) add("benchmark-ids", `benchmarks.spec_ids names ${id}, which is not public`);
  for (const field of ["support_status", "num_queries", "supports_dataframe"] as const) {
    for (const message of setDiffs(`benchmarks.${field}`, Object.keys(benchmarks[field]), benchmarks.ids)) add("benchmark-ids", message);
  }

  const { publication, ownership, sf1_calibrated_sizes: sf1 } = contracts;
  const allow = new Set(publication.allowlist);
  const excluded = (path: string): boolean => publication.exclusions.includes(path) || publication.excluded_roots.some((root) => path.startsWith(`${root}/`));
  for (const path of publication.allowlist) {
    if (excluded(path)) add("publication-lists", `${path} is both allowlisted and excluded`);
    if (!publication.gated_pages.includes(path)) add("publication-lists", `allowlisted ${path} is not a gated page`);
  }
  for (const path of publication.gated_pages) {
    if (!allow.has(path) && !excluded(path)) add("publication-lists", `gated page ${path} is neither published nor excluded`);
  }
  if (ownership.counts["site-owned"] !== ownership.site_owned.length) {
    add("ownership", `ownership.counts.site-owned is ${ownership.counts["site-owned"]}, the list holds ${ownership.site_owned.length}`);
  }

  for (const message of setDiffs("sf1_calibrated_sizes.sizes", Object.keys(sf1.sizes), sf1.measurable_benchmark_ids)) add("sf1-sizes", message);

  const symbols = contracts.public_symbols.symbols.map((item) => item.symbol);
  if (new Set(symbols).size !== symbols.length) add("public-symbols", "public_symbols.symbols repeats a symbol");

  const paths = new Set(contracts.cli.commands.map((command) => command.path));
  if (paths.size !== contracts.cli.commands.length) add("cli-commands", "cli.commands repeats a command path");
  const groups = new Set(contracts.cli.commands.filter((command) => command.is_group).map((command) => command.path));
  for (const path of paths) {
    const parent = path.split(" ").slice(0, -1).join(" ");
    if (parent !== "" && !groups.has(parent)) add("cli-commands", `${path} has no group ${parent}`);
  }

  for (const [platform, tuning] of Object.entries(contracts.tuning.platforms)) {
    const verified = tuning.has_catalog_introspector && tuning.applied_types.length > 0;
    if (tuning.can_reach_applied_verified !== verified) add("tuning-support", `${platform}: can_reach_applied_verified is ${tuning.can_reach_applied_verified}, introspector and applied types give ${verified}`);
  }

  for (const tool of contracts.mcp.remote_only_tools) {
    if (tool in contracts.mcp.tools) add("mcp-tools", `${tool} is listed as both local and remote-only`);
  }
  return found;
}
