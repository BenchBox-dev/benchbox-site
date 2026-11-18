import { canonicalBenchmarkSlug, canonicalPhase } from "@/lib/displayLabels";

export const HARDWARE_COLUMN_NAMES = [
  "hardware_class",
  "hardware_score",
  "hardware_basis",
  "hardware_table_version",
  "service_size",
  "known_defect_reason",
  "benchbox_version",
  "benchbox_version_basis",
] as const;

export type HardwareColumnName = (typeof HARDWARE_COLUMN_NAMES)[number];

export interface HardwareFields {
  hardware_class?: string | null;
  hardware_score?: number | null;
  hardware_basis?: string | null;
  hardware_table_version?: string | null;
  service_size?: string | null;
  known_defect_reason?: string | null;
  benchbox_version?: string | null;
  benchbox_version_basis?: string | null;
}

export const MIN_RANKED_PLATFORMS_PER_HARDWARE_CLASS = 3;

export const GENERIC_KNOWN_DEFECT_TEXT = "Known defective data; available for comparison, excluded from rankings.";

export const MANAGED_HARDWARE_CLASS = "managed";
export const UNCLASSIFIED_HARDWARE_CLASS = "unclassified";

const TIER_RANGES: Record<string, string> = {
  T0: "below 2.5",
  T1: "2.5 to 10",
  T2: "10 to 40",
  T3: "40 to 160",
  T4: "160 to 640",
  T5: "640 and above",
};

const BASIS_LABELS: Record<string, string> = {
  model_and_count: "from the recorded CPU model and core count",
  model_count_resolved: "from the recorded CPU model; every shipped core count lands in one class",
  attested_model: "from a CPU model attested by the maintainer",
  attested_model_count_resolved: "from a CPU model attested by the maintainer; every shipped core count lands in one class",
  container_host_vendor_fallback: "from the Apple silicon container host's CPU factor and the visible CPU count",
  managed_service: "a managed service, never CPU-tiered",
  remote_host_hardware_unknown: "the server host's hardware was not observed",
  cpu_model_missing: "no CPU model was recorded",
  cpu_model_not_in_table: "the recorded CPU model is not in the class table",
  cpu_count_missing_tiers_differ: "the CPU count is missing and the shipped core counts span several classes",
};

export function formatHardwareClass(value: string): string {
  const trimmed = value.trim();
  if (trimmed === MANAGED_HARDWARE_CLASS) return "Managed service";
  if (trimmed === UNCLASSIFIED_HARDWARE_CLASS) return "Unclassified";
  const range = TIER_RANGES[trimmed];
  return range === undefined ? trimmed : `${trimmed} (${range} CPU units)`;
}

export function formatHardwareBasis(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return BASIS_LABELS[value] ?? value.replace(/_+/g, " ");
}

export function knownDefectText(reason: string | null | undefined): string {
  return typeof reason === "string" && reason.trim() !== "" ? reason.trim() : GENERIC_KNOWN_DEFECT_TEXT;
}

export interface HardwareClassRow {
  hardware_class?: string | null;
  ranking_exclusion_reason?: string | null;
  platform_id?: string | null;
  platform?: string | null;
  variant_id?: string | null;
  benchmark?: string | null;
  scale_factor?: number | string | null;
  test_type?: string | null;
  stream_count?: number | null;
}

export interface HardwareClassOption {
  value: string;
  platformCount: number;
}

function cohortKey(row: HardwareClassRow): string {
  return [
    row.benchmark ? canonicalBenchmarkSlug(row.benchmark) : "",
    row.scale_factor ?? "",
    canonicalPhase(row.test_type),
    row.stream_count ?? "",
  ].join("\u0000");
}

export function hardwareClassOptions(rows: readonly HardwareClassRow[]): HardwareClassOption[] {
  const platformsByClassAndCohort = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const hardwareClass = row.hardware_class;
    if (typeof hardwareClass !== "string" || hardwareClass === "") continue;
    if (row.ranking_exclusion_reason !== null && row.ranking_exclusion_reason !== undefined) continue;
    const cohorts = platformsByClassAndCohort.get(hardwareClass) ?? new Map<string, Set<string>>();
    const key = cohortKey(row);
    const platforms = cohorts.get(key) ?? new Set<string>();
    platforms.add(`${row.platform_id ?? row.platform ?? ""}\u0000${row.variant_id ?? ""}`);
    cohorts.set(key, platforms);
    platformsByClassAndCohort.set(hardwareClass, cohorts);
  }
  const options: HardwareClassOption[] = [];
  for (const [value, cohorts] of platformsByClassAndCohort) {
    const platformCount = Math.max(...[...cohorts.values()].map((platforms) => platforms.size));
    if (platformCount >= MIN_RANKED_PLATFORMS_PER_HARDWARE_CLASS) options.push({ value, platformCount });
  }
  return options.sort((left, right) => left.value.localeCompare(right.value));
}

export interface CitationLineInput {
  benchboxVersion: string | null | undefined;
  versionBasis: string | null | undefined;
  publicResultId: string;
  permalink: string;
  accessed: string;
}

export const NOT_AN_OFFICIAL_TPC_RESULT = "Not an official TPC result.";

export function formatCitationLine(input: CitationLineInput): string {
  const version = typeof input.benchboxVersion === "string" && input.benchboxVersion.trim() !== "" ? input.benchboxVersion.trim() : null;
  const inferred = input.versionBasis === "inferred_from_run_date" ? " (inferred from run date)" : "";
  const label = version === null ? "BenchBox version not recorded" : `BenchBox ${version}${inferred}`;
  return `${label}, result ${input.publicResultId}, ${input.permalink}, accessed ${input.accessed}. ${NOT_AN_OFFICIAL_TPC_RESULT}`;
}
