import type { BenchmarkRecord, QueriesData, QueryRecord } from "./docs-data.ts";

const LICENSE = "<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->";
const TO_BENCHMARKS = "../../";
const TO_REPO = "../../../../";

const DATAFRAME_FAMILIES: Record<string, string> = {
  expression: "Expression family (Polars, PySpark, DataFusion)",
  pandas: "Pandas family",
};

function fence(code: string, lang: string): string {
  let ticks = "```";
  while (code.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

function normalize(body: string): string {
  const stripped = body
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\s+$/u, "");
  return `${stripped}\n`;
}

function pythonString(value: string): string {
  if (value.includes("'") && !value.includes('"')) return `"${value}"`;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatScale(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function catalogTable(queries: QueryRecord[]): string[] {
  const rows = ["| Query | Name |", "|---|---|"];
  for (const query of queries) {
    rows.push(`| [${query.label}](${query.slug}.md) | ${escapeCell(query.display_name ?? "")} |`);
  }
  return rows;
}

function sqlSection(query: QueryRecord): string[] {
  if (query.sql === null) return ["_This query could not be rendered as standalone SQL._", ""];
  const label = query.reference_dialect_label ?? query.sql.dialect;
  let note =
    query.sql.dialect === "default"
      ? "Rendered in the benchmark's native SQL with default parameters (no dialect translation available)."
      : `Rendered for **${label}** with default parameters.`;
  if (query.sql.is_template) note += " Parameter placeholders are shown literally.";
  return [note, "", fence(query.sql.pretty_sql, "sql"), ""];
}

function dataframeSection(query: QueryRecord): string[] {
  if (query.dataframe === null) return ["_No DataFrame implementation is registered for this query._", ""];
  const family = DATAFRAME_FAMILIES[query.dataframe.family] ?? query.dataframe.family;
  return [`${family}, default parameters.`, "", fence(query.dataframe.source, "python"), ""];
}

function recipes(queries: QueriesData, benchmark: BenchmarkRecord, query: QueryRecord): string[] {
  const scale = formatScale(benchmark.default_scale);
  const lines: string[] = [];
  let recipe: string;
  if (benchmark.supports_dialect_translation) {
    recipe =
      `${benchmark.recipe.import_line}\n\n` +
      `bench = ${benchmark.recipe.class_name}(scale_factor=${scale})            # your scale factor\n` +
      `queries = bench.get_queries(dialect="${queries.reference_dialect}")   # your platform's dialect; drop dialect= for native SQL\n` +
      `print(queries[${query.native_key_repr}])`;
  } else {
    recipe =
      `${benchmark.recipe.import_line}\n\n` +
      `bench = ${benchmark.recipe.class_name}(scale_factor=${scale})            # your scale factor\n` +
      `print(bench.get_queries()[${query.native_key_repr}])`;
  }
  lines.push(fence(recipe, "python"), "");
  if (benchmark.seed_driven && /^[0-9]+$/.test(query.id)) {
    lines.push(
      "Parameter substitution for this benchmark is seed-driven; pass a `seed` for a specific stream's parameters:",
      "",
      fence(
        `print(bench.get_query(${query.id}, scale_factor=${scale}, seed=42, dialect="${queries.reference_dialect}"))`,
        "python",
      ),
      "",
    );
  }
  if (query.dataframe !== null) {
    lines.push(
      "For the DataFrame form:",
      "",
      fence(
        "from benchbox.core.query_catalog import get_dataframe_render\n\n" +
          `print(get_dataframe_render(${pythonString(benchmark.id)}, ${pythonString(query.id)}, family="expression").source)` +
          '  # or family="pandas"',
        "python",
      ),
      "",
    );
  }
  return lines;
}

function queryPage(queries: QueriesData, benchmark: BenchmarkRecord, query: QueryRecord): string {
  const lines = [
    LICENSE,
    "",
    `# ${query.heading}`,
    "",
    "```{tags} reference, query-template, " + benchmark.id,
    "```",
    "",
    `> [${benchmark.display_name}](${TO_BENCHMARKS}${benchmark.overview_slug}.md) benchmark · [all ${benchmark.display_name} queries](index.md)`,
    "",
  ];
  if (query.description) lines.push(query.description, "");
  if (query.answer_set_note) lines.push(query.answer_set_note, "");
  if (query.subscale_note) lines.push(query.subscale_note, "");
  lines.push("## Representative SQL", "", ...sqlSection(query));
  lines.push("## Representative DataFrame", "", ...dataframeSection(query));
  lines.push("## Get the exact query for your run", "");
  lines.push(
    "The blocks above are representative. To get the precise statement a specific platform runs at a specific scale, substitute your own values:",
    "",
  );
  lines.push(...recipes(queries, benchmark, query));
  if (query.source_path) lines.push("## Source", "", `Query text: [\`${query.source_path}\`](${TO_REPO}${query.source_path})`, "");
  return normalize(lines.join("\n"));
}

function benchmarkIndex(queries: QueriesData, benchmark: BenchmarkRecord): string {
  const header = [
    LICENSE,
    "",
    `# ${benchmark.display_name} Query Templates`,
    "",
    "```{tags} reference, query-template, " + benchmark.id,
    "```",
    "",
    `> [${benchmark.display_name} overview](${TO_BENCHMARKS}${benchmark.overview_slug}.md)`,
    "",
    `Representative SQL and DataFrame renderings for each of the ${benchmark.query_count} ${benchmark.display_name} queries. Every page also shows how to extract the exact query for a given platform and scale.`,
    "",
  ];
  if (benchmark.tpc_derived) header.push(queries.tpc_notice, "");
  if (benchmark.groups === null) {
    const body = [
      ...header,
      ...catalogTable(benchmark.queries),
      "",
      "```{toctree}",
      ":hidden:",
      "",
      ...benchmark.queries.map((query) => query.slug),
      "```",
    ];
    return normalize(body.join("\n"));
  }
  const body = [...header, "## Query groups", ""];
  for (const group of benchmark.groups) {
    body.push(`- [${group.name}](group-${group.slug}.md) (${group.query_ids.length})`);
  }
  body.push("", "```{toctree}", ":hidden:", "", ...benchmark.groups.map((group) => `group-${group.slug}`), "```");
  return normalize(body.join("\n"));
}

function groupPage(benchmark: BenchmarkRecord, name: string, slug: string, queries: QueryRecord[]): string {
  const body = [
    LICENSE,
    "",
    `# ${benchmark.display_name} Query Templates — ${name}`,
    "",
    "```{tags} reference, query-template, " + benchmark.id,
    "```",
    "",
    `> [All ${benchmark.display_name} query groups](index.md)`,
    "",
    ...catalogTable(queries),
    "",
    "```{toctree}",
    ":hidden:",
    "",
    ...queries.map((query) => query.slug),
    "```",
  ];
  return normalize(body.join("\n"));
}

function topIndex(benchmarks: BenchmarkRecord[]): string {
  const lines = [
    LICENSE,
    "",
    "# Query Templates",
    "",
    "```{tags} reference, query-template",
    "```",
    "",
    "Representative SQL and DataFrame renderings for every query in every BenchBox benchmark, one page per query. Each page shows a DataFusion rendering with default parameters and a short recipe for extracting the exact query a specific platform runs at a specific scale.",
    "",
    "| Benchmark | Queries |",
    "|---|---|",
  ];
  for (const benchmark of benchmarks) {
    lines.push(`| [${benchmark.display_name}](${benchmark.id}/index.md) | ${benchmark.query_count} |`);
  }
  lines.push("", "```{toctree}", ":hidden:", "", ...benchmarks.map((benchmark) => `${benchmark.id}/index`), "```");
  return normalize(lines.join("\n"));
}

export function renderQueryPages(data: { queries: QueriesData }): Map<string, string> {
  const files = new Map<string, string>();
  for (const benchmark of data.queries.benchmarks) {
    const byId = new Map(benchmark.queries.map((query) => [query.id, query]));
    for (const query of benchmark.queries) {
      files.set(`benchmarks/queries/${benchmark.id}/${query.slug}.md`, queryPage(data.queries, benchmark, query));
    }
    files.set(`benchmarks/queries/${benchmark.id}/index.md`, benchmarkIndex(data.queries, benchmark));
    if (benchmark.groups !== null) {
      for (const group of benchmark.groups) {
        const members = group.query_ids.map((id) => {
          const found = byId.get(id);
          if (!found) throw new Error(`query group ${group.name} lists unknown query ${id}`);
          return found;
        });
        files.set(`benchmarks/queries/${benchmark.id}/group-${group.slug}.md`, groupPage(benchmark, group.name, group.slug, members));
      }
    }
  }
  files.set("benchmarks/queries/index.md", topIndex(data.queries.benchmarks));
  return files;
}
