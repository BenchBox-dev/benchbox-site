import type { CombinedCohortFields } from "@/types";

const LOAD_SCOPE_LABELS: Record<string, string> = {
  schema_creation: "schema creation",
  data_loading: "data loading",
  statistics_gathering: "statistics gathering",
  post_load_maintenance: "post-load maintenance",
  merge_settle: "merge settle",
};

export type CombinedDisclosureFields = Pick<CombinedCohortFields, "load_scope" | "transactional_steps">;

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function parseJsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadScopeComponents(row: CombinedDisclosureFields): string[] | null {
  const scope = row.load_scope;
  if (!Array.isArray(scope) || scope.length === 0) return null;
  return scope.map((component) => LOAD_SCOPE_LABELS[component] ?? component.replace(/_/g, " "));
}

export function loadScopeText(row: CombinedDisclosureFields): string | null {
  const components = loadScopeComponents(row);
  return components === null ? null : `Load time includes ${joinList(components)}.`;
}

export function nonTransactionalSteps(row: CombinedDisclosureFields): string[] {
  const steps = row.transactional_steps;
  if (steps === null || steps === undefined) return [];
  return Object.entries(steps)
    .filter(([, transactional]) => transactional === false)
    .map(([step]) => step)
    .sort();
}

export function nonTransactionalText(row: CombinedDisclosureFields): string | null {
  const steps = nonTransactionalSteps(row);
  if (steps.length === 0) return null;
  return `Not transactional: ${joinList(steps)} ran without a transaction, so a failed step is not rolled back.`;
}

export function combinedDisclosures(row: CombinedDisclosureFields): string[] {
  return [nonTransactionalText(row), loadScopeText(row)].filter((text): text is string => text !== null);
}

export function hasNonTransactionalSteps(row: CombinedDisclosureFields): boolean {
  return nonTransactionalSteps(row).length > 0;
}
