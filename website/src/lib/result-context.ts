import { formatArchitecture, formatCpuFamily, formatMemoryGb, formatTrustLabel, formatTuningMode } from "@/lib/displayLabels";
import type { PrimaryMetric } from "@/lib/displayEligibility";
import { formatFacetDisplayValue } from "@/lib/facetDisplay";

export const NOT_RECORDED = "Not recorded";

export const METHODOLOGY_PATH = "/docs/concepts/benchmark-methodology.html";

export interface ContextFields {
  deployment_class?: string | null;
  cloud_provider?: string | null;
  cloud_region?: string | null;
  instance_or_warehouse?: string | null;
  arch?: string | null;
  cpu_family?: string | null;
  memory_gb?: number | null;
  tuning_mode?: string | null;
  trust_label?: string | null;
}

export interface ScoreDefinition {
  metric: PrimaryMetric;
  label: string;
  unit: string;
  direction: string;
  meaning: string;
  href: string;
}

const SCORE_DEFINITIONS: Record<PrimaryMetric, ScoreDefinition> = {
  power_score: {
    metric: "power_score",
    label: "Power score",
    unit: "queries per hour at scale factor size",
    direction: "higher is better",
    meaning: "Power@Size: scale factor × 3600 divided by the geometric mean of the query times of the final iteration, in seconds.",
    href: `${METHODOLOGY_PATH}#iterations-and-warm-up`,
  },
  throughput_at_size: {
    metric: "throughput_at_size",
    label: "Throughput@Size",
    unit: "queries per hour at scale factor size",
    direction: "higher is better",
    meaning: "Throughput@Size: number of queries run across all streams × scale factor × 3600 divided by the elapsed throughput time, in seconds.",
    href: `${METHODOLOGY_PATH}#when-two-results-are-comparable`,
  },
  display_geomean_ms: {
    metric: "display_geomean_ms",
    label: "Geomean query time",
    unit: "milliseconds, shown as seconds from 1,000 ms",
    direction: "lower is better",
    meaning: "Geometric mean of the displayed per-query times of the run.",
    href: `${METHODOLOGY_PATH}#when-two-results-are-comparable`,
  },
};

export function scoreDefinitions(metrics: Iterable<PrimaryMetric>): ScoreDefinition[] {
  const wanted = new Set<PrimaryMetric>(metrics);
  wanted.add("display_geomean_ms");
  return (Object.keys(SCORE_DEFINITIONS) as PrimaryMetric[]).filter((metric) => wanted.has(metric)).map((metric) => SCORE_DEFINITIONS[metric]);
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== "";
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function executionEnvironment(row: ContextFields): string {
  const deployment = present(row.deployment_class) && row.deployment_class !== "unavailable" ? row.deployment_class : present(row.cloud_provider) ? "cloud" : null;
  const parts: string[] = [];
  if (deployment !== null) parts.push(capitalized(formatFacetDisplayValue("deployment_class", deployment)));
  const location = [present(row.cloud_provider) ? formatFacetDisplayValue("cloud_provider", row.cloud_provider) : null, present(row.cloud_region) ? row.cloud_region : null].filter((part): part is string => part !== null);
  if (location.length > 0) parts.push(location.join(" "));
  if (present(row.instance_or_warehouse)) parts.push(row.instance_or_warehouse);
  if (deployment === null || deployment === "local") {
    if (present(row.arch)) parts.push(formatArchitecture(row.arch));
    if (present(row.cpu_family)) parts.push(formatCpuFamily(row.cpu_family));
    if (row.memory_gb !== null && row.memory_gb !== undefined) parts.push(formatMemoryGb(row.memory_gb));
  }
  return parts.length === 0 ? NOT_RECORDED : parts.join(", ");
}

export function tuningModeText(row: ContextFields): string {
  return present(row.tuning_mode) ? formatTuningMode(row.tuning_mode) : NOT_RECORDED;
}

export function trustLabelText(row: ContextFields): string {
  return present(row.trust_label) ? formatTrustLabel(row.trust_label) : NOT_RECORDED;
}

export interface RunContext {
  environment: string;
  tuningMode: string;
  trustLabel: string;
}

export function runContext(row: ContextFields): RunContext {
  return { environment: executionEnvironment(row), tuningMode: tuningModeText(row), trustLabel: trustLabelText(row) };
}
