import { readFileSync } from "node:fs";

export type SqlRendering = {
  dialect: string;
  is_template: boolean;
  sql: string;
  pretty_sql: string;
};

export type DataframeRendering = {
  family: string;
  source: string;
};

export type QueryRecord = {
  id: string;
  slug: string;
  label: string;
  display_name: string | null;
  heading: string;
  description: string | null;
  groups: string[];
  native_key: string | number;
  native_key_repr: string;
  source_path: string | null;
  seed_driven: boolean;
  answer_set_note: string | null;
  subscale_note: string | null;
  sql: SqlRendering | null;
  sql_native: SqlRendering | null;
  reference_dialect_label: string | null;
  dataframe: DataframeRendering | null;
  dataframe_renderings: DataframeRendering[];
};

export type BenchmarkGroup = {
  name: string;
  slug: string;
  query_ids: string[];
};

export type BenchmarkRecipe = {
  import_line: string;
  class_name: string;
};

export type BenchmarkRecord = {
  id: string;
  display_name: string;
  overview_slug: string;
  query_count: number;
  tpc_derived: boolean;
  seed_driven: boolean;
  supports_dialect_translation: boolean;
  default_scale: number;
  recipe: BenchmarkRecipe;
  groups: BenchmarkGroup[] | null;
  queries: QueryRecord[];
};

export type QueriesData = {
  reference_dialect: string;
  tpc_notice: string;
  group_threshold: number;
  bucket_size: number;
  tpcds_parity_notes_url: string;
  tpcds_subscale_notes_url: string;
  benchmarks: BenchmarkRecord[];
};

export type CompatRule = {
  platform: string;
  phase: string;
  benchmark: string | null;
  query_id: string | null;
  scope: string;
  action: string;
  support_level: string;
  failure_mode: string;
  rule_id: string;
  reason: string;
};

export type CompatData = {
  phase_order: string[];
  will_not_run_levels: string[];
  runs_with_caveats_levels: string[];
  rules: CompatRule[];
};

export type TuningApplied = {
  type: string;
  requires_sorted_ingestion: boolean;
};

export type TuningPlatform = {
  platform: string;
  shipped_templates: string[];
  applied: TuningApplied[];
  not_applied: string[];
  session_config: boolean;
  catalog_introspector: boolean | null;
  can_reach_applied_verified: boolean;
};

export type TuningData = {
  aliases: Record<string, string>;
  platforms: TuningPlatform[];
};

export type DocsData = {
  schema_version: 1;
  queries: QueriesData;
  compat: CompatData;
  tuning: TuningData;
};

export function parseDocsData(text: string): DocsData {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("docs-data payload is not a JSON object");
  const payload = parsed as { schema_version?: unknown; queries?: unknown; compat?: unknown; tuning?: unknown };
  if (payload.schema_version !== 1) throw new Error(`unsupported docs-data schema_version ${String(payload.schema_version)}`);
  for (const section of ["queries", "compat", "tuning"] as const) {
    if (typeof payload[section] !== "object" || payload[section] === null) {
      throw new Error(`docs-data payload is missing section ${section}`);
    }
  }
  return parsed as DocsData;
}

export function loadDocsData(file: string): DocsData {
  return parseDocsData(readFileSync(file, "utf-8"));
}
