import type { TuningData, TuningPlatform } from "./docs-data.ts";

function tuningHeader(aliases: string): string {
  const lines = [
    "# Tuning Platform Support",
    "",
    "This page lists, for each platform in the tuning capability registry, what a",
    "tuning file can change at execution and whether a tuned run can be verified",
    "against the live catalog. It is generated from",
    "`benchbox/core/tuning/capability_registry.py`, the packaged tuning templates,",
    "and each adapter's catalog introspector by",
    "`scripts/generate_tuning_support_matrix.py` (`make tuning-support-matrix`);",
    "a test fails when the page drifts from those sources, so do not edit it by",
    "hand.",
    "",
    "- **Shipped templates**: benchmarks with a packaged `*_tuned.yaml` template,",
    "  used by `--tuning tuned`. Platforms without one use the generic fallback.",
    "- **Applied at execution**: tuning types the platform renders when tables are",
    "  created or loaded. Requesting any other type fails validation.",
    "- **Not applied**: tuning types the registry lists but the platform does not",
    "  apply; requesting one fails validation with the registry's reason.",
    "- **Catalog introspector**: whether the adapter reads the catalog after load",
    "  to corroborate the applied-tuning ledger.",
    "- **Can reach `applied_verified`**: yes only when the platform has a catalog",
    "  introspector and applies at least one tuning type. Other platforms report",
    "  at most `applied_unverified`.",
    "",
    `Aliases resolve to another platform's entry: ${aliases}.`,
    "",
    "| Platform | Shipped templates | Applied at execution | Not applied | Spark session map | Catalog introspector | Can reach `applied_verified` |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  return `${lines.join("\n")}\n`;
}

function appliedText(platform: TuningPlatform): string {
  const names = platform.applied.map((entry) => (entry.requires_sorted_ingestion ? `${entry.type} (with sorted ingestion)` : entry.type));
  return names.length > 0 ? names.join(", ") : "none";
}

function tuningRow(platform: TuningPlatform): string {
  const templates = platform.shipped_templates.length > 0 ? platform.shipped_templates.join(", ") : "none";
  const applied = appliedText(platform);
  const notApplied = platform.not_applied.length > 0 ? platform.not_applied.join(", ") : "none";
  const session = platform.session_config ? "applied" : "-";
  const introspector = platform.catalog_introspector === true ? "yes" : platform.catalog_introspector === false ? "no" : "no adapter";
  const verifiable = platform.catalog_introspector === true && applied !== "none" ? "yes" : "no";
  return `| \`${platform.platform}\` | ${templates} | ${applied} | ${notApplied} | ${session} | ${introspector} | ${verifiable} |\n`;
}

export function renderTuningPage(data: { tuning: TuningData }): { path: string; content: string } {
  const aliases = Object.entries(data.tuning.aliases)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([alias, target]) => `\`${alias}\` -> \`${target}\``)
    .join(", ");
  const platforms = [...data.tuning.platforms].sort((left, right) =>
    left.platform < right.platform ? -1 : left.platform > right.platform ? 1 : 0,
  );
  const rows = platforms.map(tuningRow).join("");
  return { path: "reference/tuning-platform-support.md", content: tuningHeader(aliases) + rows };
}
