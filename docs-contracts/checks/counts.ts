import { page, type Context, type Violation } from "../lib/types.ts";

function boundaryPattern(fragment: string): RegExp {
  const parts: string[] = [];
  let offset = 0;
  for (const match of fragment.matchAll(/\d+/g)) {
    parts.push(escape(fragment.slice(offset, match.index)));
    parts.push(`\\b${match[0]}\\b`);
    offset = match.index + match[0].length;
  }
  parts.push(escape(fragment.slice(offset)));
  return new RegExp(parts.join(""));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function claimPresent(text: string, fragment: string): boolean {
  return boundaryPattern(fragment).test(text);
}

const SNAPSHOT_ROW = /^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/;
const MATRIX_ROW = /^\|\s*`([a-z0-9_]+)`\s*\|\s*`([a-z_]+)`\s*\|\s*(.*?)\s*\|/;

export function countViolations(ctx: Context): Violation[] {
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
  const { platforms, benchmarks } = contracts;
  const summary = platforms.count_summary;
  const statuses = summary.support_status;

  const matrix = need("platforms/comparison-matrix.md");
  if (matrix !== null) {
    const marker =
      `Platform registry: **${summary.total}** metadata entries; **${summary.sql_capable}** SQL-capable; ` +
      `**${summary.dataframe_capable}** DataFrame-capable; **${summary.dual_mode}** dual-mode; ` +
      `support status counts: stable=${statuses.stable}, beta=${statuses.beta}, experimental=${statuses.experimental}, deprecated=${statuses.deprecated}.`;
    if (!matrix.includes(marker)) fail("platform-counts", "platforms/comparison-matrix.md", `registry count marker differs from: ${marker}`);
  }

  const support = need("platforms/support-status.md");
  if (support !== null) {
    const path = "platforms/support-status.md";
    const rows = new Map<string, [number, number, number]>();
    for (const line of support.split("\n")) {
      const match = SNAPSHOT_ROW.exec(line);
      if (match !== null) rows.set(match[1], [Number(match[2]), Number(match[3]), Number(match[4])]);
    }
    for (const status of platforms.support_status_values) {
      const expected = platforms.support_status_snapshot[status];
      const row = rows.get(status);
      if (row === undefined) fail("platform-status-snapshot", path, `snapshot row for ${status} is missing`);
      else if (row[0] !== expected.entries || row[1] !== expected.sql || row[2] !== expected.dataframe) {
        fail("platform-status-snapshot", path, `${status} row is entries=${row[0]} sql=${row[1]} dataframe=${row[2]}, contracts give entries=${expected.entries} sql=${expected.sql} dataframe=${expected.dataframe}`);
      }
    }
    for (const status of rows.keys()) {
      if (!platforms.support_status_values.includes(status)) fail("platform-status-snapshot", path, `snapshot row for unknown status ${status}`);
    }
    const start = support.indexOf("<!-- benchbox-registry-counts:start -->");
    const end = support.indexOf("<!-- benchbox-registry-counts:end -->", start);
    if (start < 0 || end < 0) fail("platform-counts", path, "registry counts block markers are missing");
    else {
      const block = support.slice(start, end);
      for (const [status, count] of Object.entries(statuses)) {
        if (count !== 0 && !block.includes(`${status}=${count}`)) fail("platform-counts", path, `registry counts block lacks ${status}=${count}`);
      }
      for (const match of block.matchAll(/(\w+)=(\d+)/g)) {
        if (match[1] in statuses && Number(match[2]) !== statuses[match[1]]) fail("platform-counts", path, `registry counts block says ${match[1]}=${match[2]}, contracts give ${statuses[match[1]]}`);
      }
    }
  }

  const contractsPage = need("reference/public-contracts.md");
  if (contractsPage !== null) {
    const path = "reference/public-contracts.md";
    const st = benchmarks.registry_summary.support_status;
    const marker =
      `Benchmark API snapshot: **${benchmarks.registry_summary.total}** registry entries; **${benchmarks.registry_summary.loader}** loader-resolved core families; ` +
      `**${benchmarks.registry_summary.public}** public discovery entries; **${benchmarks.facades.top_level}** top-level Python benchmark facades; ` +
      `**${benchmarks.facades.lazy}** lazy facades; **${benchmarks.facades.eager}** eager facades; **${benchmarks.core_only_ids.length}** core-only benchmark IDs. ` +
      `Benchmark support status: **${st.stable ?? 0}** stable, **${st.beta ?? 0}** beta, **${st.experimental ?? 0}** experimental, **${st.repo_only ?? 0}** repo-only, ` +
      `**${st.deprecated ?? 0}** deprecated, **${st.document_only ?? 0}** document-only.`;
    if (!contractsPage.includes(marker)) fail("benchmark-api-surface", path, `benchmark API snapshot marker differs from: ${marker}`);
    const { api_surfaces: surfaces } = benchmarks;
    for (const row of [
      `| \`benchbox.base.BaseBenchmark\` | \`${surfaces.public_base}\` |`,
      `| \`BaseBenchmark.run_with_platform\` | \`${surfaces.run_with_platform}\` |`,
      `| \`benchbox.core.base_benchmark.BaseBenchmark\` | \`${surfaces.core_base}\` |`,
      `| \`benchbox.core.benchmark_loader\` | \`${surfaces.loader}\` |`,
    ]) {
      if (!contractsPage.includes(row)) fail("benchmark-api-surface", path, `surface table row is missing or changed: ${row}`);
    }
    const fragments = [
      `${benchmarks.ids.length} benchmark metadata entries`,
      `${benchmarks.loader_ids.length} loader-resolved IDs`,
      `${summary.total} platform metadata entries`,
      `${summary.sql_capable} SQL-capable`,
      `${summary.dataframe_capable} DataFrame-capable`,
      `${summary.dual_mode} dual-mode`,
      `Current result schema version: \`${contracts.result_schema_version}\``,
    ];
    for (const fragment of fragments) {
      if (!claimPresent(contractsPage, fragment)) fail("public-contract-claims", path, `source-derived claim is missing or stale: ${fragment}`);
    }
  }

  const publicCount = benchmarks.public_ids.length;
  const specCount = benchmarks.spec_ids.length;
  const claims: [string, string][] = [
    ["design/architecture.md", `currently ${publicCount} benchmarks`],
    ["development/result-integrity-validation.md", `Specs exist for ${specCount} of ${publicCount} registered benchmarks`],
    ["reference/cli/utilities.md", `Specs cover ${specCount} of ${publicCount} benchmarks`],
    ["usage/faq.md", `BenchBox includes **${publicCount}** public-discovery benchmarks`],
  ];
  for (const [path, fragment] of claims) {
    const text = need(path);
    if (text !== null && !claimPresent(text, fragment)) fail("benchmark-count-claims", path, `registry-derived claim is missing or stale: ${fragment}`);
  }

  const status = need("benchmarks/support-status.md");
  if (status !== null) {
    const path = "benchmarks/support-status.md";
    const rows = new Map<string, { status: string; rationale: string }>();
    let inMatrix = false;
    for (const line of status.split("\n")) {
      if (line === "## Benchmark Status Rationale") {
        inMatrix = true;
        continue;
      }
      if (inMatrix && line.startsWith("## ")) break;
      if (!inMatrix) continue;
      const match = MATRIX_ROW.exec(line);
      if (match === null) continue;
      if (!(match[1] in benchmarks.support_status)) fail("benchmark-status-matrix", path, `row for ${match[1]} names no registry benchmark`);
      else if (rows.has(match[1])) fail("benchmark-status-matrix", path, `${match[1]} has more than one row`);
      else rows.set(match[1], { status: match[2], rationale: match[3] });
    }
    for (const id of benchmarks.ids) {
      const row = rows.get(id);
      if (row === undefined) {
        fail("benchmark-status-matrix", path, `${id} has no row`);
        continue;
      }
      if (row.status !== benchmarks.support_status[id]) fail("benchmark-status-matrix", path, `${id} is ${row.status}, contracts give ${benchmarks.support_status[id]}`);
      const queries = /\b(\d+)-(?:query|variant)\b/.exec(row.rationale);
      if (queries === null) fail("benchmark-status-matrix", path, `${id} has no parseable query-count claim`);
      else if (Number(queries[1]) !== benchmarks.num_queries[id]) fail("benchmark-status-matrix", path, `${id} claims ${queries[1]} queries, contracts give ${benchmarks.num_queries[id]}`);
      const negative = row.rationale.includes("not DataFrame-capable");
      if (benchmarks.supports_dataframe[id] && (negative || !row.rationale.includes("DataFrame-capable"))) fail("benchmark-status-matrix", path, `${id} must be described as DataFrame-capable`);
      if (!benchmarks.supports_dataframe[id] && !negative) fail("benchmark-status-matrix", path, `${id} must be described as not DataFrame-capable`);
    }
  }
  return found;
}
