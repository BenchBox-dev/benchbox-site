import { canonicalBenchmarkSlug, formatBenchmarkLabel } from "@/lib/displayLabels";
import type { ResultRow } from "@/lib/duckdbQueries";

export type SectionKind = "benchmarks" | "platforms";

export interface SectionEntry {
  id: string;
  label: string;
  href: string;
  resultCount: number;
  coverageCount: number;
  latestRun: string;
  runDates: string[];
  supportStatus: string | null;
}

const INDEXED_VISIBILITY_PREFIX = "public-";

export function isIndexedVisibility(visibility: string | null | undefined): boolean {
  return typeof visibility === "string" && visibility.startsWith(INDEXED_VISIBILITY_PREFIX);
}

export function indexedResults<T extends { visibility: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => isIndexedVisibility(row.visibility));
}

export function sectionEntryHref(kind: SectionKind, id: string): string {
  return kind === "benchmarks" ? `/results/${encodeURIComponent(id)}/` : `/results/p/${encodeURIComponent(id)}/`;
}

export function buildSectionEntries(rows: readonly ResultRow[], kind: SectionKind): SectionEntry[] {
  const grouped = new Map<string, { label: string; supportStatus: string | null; rows: ResultRow[] }>();

  for (const row of rows) {
    const id = kind === "benchmarks" ? canonicalBenchmarkSlug(row.benchmark) : row.platform_id;
    const label = kind === "benchmarks" ? formatBenchmarkLabel(id) : row.platform;
    const supportStatus = kind === "benchmarks" ? (row.benchmark_support_status ?? null) : null;
    const existing = grouped.get(id);
    if (existing) {
      existing.rows.push(row);
      if (existing.supportStatus === null && supportStatus !== null) {
        existing.supportStatus = supportStatus;
      }
    } else {
      grouped.set(id, { label, supportStatus, rows: [row] });
    }
  }

  return Array.from(grouped, ([id, group]) => ({
    id,
    label: group.label,
    href: sectionEntryHref(kind, id),
    resultCount: group.rows.length,
    coverageCount:
      kind === "benchmarks"
        ? new Set(group.rows.map((row) => row.platform_id)).size
        : new Set(group.rows.map((row) => canonicalBenchmarkSlug(row.benchmark))).size,
    latestRun: group.rows.reduce((latest, row) => (row.run_date > latest ? row.run_date : latest), ""),
    runDates: group.rows.map((row) => row.run_date),
    supportStatus: group.supportStatus,
  }));
}
