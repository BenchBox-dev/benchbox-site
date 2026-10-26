export type Violation = { check: string; page: string; invariant: string };

export type Counts = Record<string, number>;

export type Contracts = {
  result_schema_version: string;
  package: {
    version: string;
    core_dependencies: string[];
    optional_extras: string[];
    experimental_exported: boolean;
    release_marker: { pattern: string; flags: number; version_group: string };
  };
  benchmarks: {
    ids: string[];
    public_ids: string[];
    loader_ids: string[];
    core_only_ids: string[];
    spec_ids: string[];
    support_status: Record<string, string>;
    num_queries: Record<string, number>;
    supports_dataframe: Record<string, boolean>;
    registry_summary: {
      total: number;
      loader: number;
      public: number;
      dataframe_supported: number;
      support_status: Counts;
      surface: Counts;
    };
    facades: { top_level: number; lazy: number; eager: number };
    api_surfaces: { public_base: string; run_with_platform: string; core_base: string; core_base_decision: string; loader: string };
  };
  platforms: {
    count_summary: {
      total: number;
      sql_capable: number;
      dataframe_capable: number;
      dual_mode: number;
      dataframe_only: number;
      support_status: Counts;
      category: Counts;
    };
    support_status_values: string[];
    support_status_snapshot: Record<string, { entries: number; sql: number; dataframe: number }>;
    entries: Record<string, { category: string; support_status: string; supports_sql: boolean; supports_dataframe: boolean }>;
  };
  platform_manifest: { entries: { key: string }[]; aliases: Record<string, string> };
  execution: {
    deprecated_option_aliases: { platform: string; key: string; target: string; removed_in: string }[];
    deployment_alias_keys: Record<string, string[]>;
    engines: Record<string, { declared: Record<string, { class: string }>; selectable: string[] }>;
    compute_resource_option: string;
    compute_size_option: string;
    compute: Record<string, { resource_aliases: string[]; size_aliases: string[] }>;
  };
  platform_options: {
    platforms: Record<string, Record<string, { value_kind: string; choices: string[] | null; default: unknown; aliases: string[] }>>;
    alias_index: Record<string, Record<string, string>>;
  };
  tuning: {
    aliases: Record<string, string>;
    platforms: Record<string, { applied_types: string[]; has_catalog_introspector: boolean; can_reach_applied_verified: boolean }>;
  };
  cli: {
    commands: { path: string; is_group: boolean; options: { names: string[]; is_flag: boolean }[] }[];
    help_catalog: { command_examples: Record<string, Record<string, string[]>> };
  };
  mcp: {
    tools: Record<string, { params: Record<string, { type: string; required: boolean; default: unknown }> }>;
    remote_only_tools: string[];
  };
  public_symbols: { dropped: string[]; symbols: { symbol: string; name: string | null; aliases: string[] }[] };
  sf1_calibrated_sizes: {
    tolerance: number;
    sizes: Record<string, number>;
    measurable_benchmark_ids: string[];
    documented_without_generation: string[];
  };
  write_primitives: { validation_bounds: Record<string, Record<string, { min: number; max: number | null }>> };
  publication: { gated_roots: string[]; allowlist: string[]; exclusions: string[]; excluded_roots: string[]; gated_pages: string[] };
  ownership: { counts: Counts; site_owned: string[]; core_generated: string[] };
};

export type Manifest = { schema: number; package_version: string; core_sha: string };

export type Page = { path: string; text: string };

export type Context = {
  manifest: Manifest;
  contracts: Contracts;
  pages: Page[];
};

export type BoundaryContext = { pages: Page[]; contracts: Contracts };

export function page(ctx: { pages: Page[] }, relative: string): Page | undefined {
  return ctx.pages.find((candidate) => candidate.path === relative);
}
