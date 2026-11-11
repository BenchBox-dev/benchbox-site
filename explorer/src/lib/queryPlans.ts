export interface QueryPlanNode {
  operator: string;
  details: string[];
  children: QueryPlanNode[];
  truncatedAtDepth: number | null;
  omittedChildren: number;
}

export interface PlanVariant {
  fingerprint: string;
  iteration: string | null;
  runType: string | null;
}

export interface CapturedQueryPlan {
  id: string;
  label: string;
  queryId: string;
  platform: string | null;
  estimatedCost: string | null;
  estimatedRows: string | null;
  fingerprint: string | null;
  iteration: string | null;
  runType: string | null;
  variants: PlanVariant[];
  root: QueryPlanNode | null;
  textualPlan: string | null;
  textualPlanTruncated: boolean;
}

export interface PlanCaptureError {
  queryId: string;
  streamId: string | null;
  iteration: string | null;
  message: string;
}

export interface QueryPlanDocument {
  plans: CapturedQueryPlan[];
  captureFailures: number;
  captureErrors: PlanCaptureError[];
  truncated: boolean;
}

export const MAX_PLAN_SIDECAR_BYTES = 2_000_000;

const MAX_PLAN_COUNT = 500;
const MAX_PLAN_NODES = 500;
const MAX_PLAN_DEPTH = 60;
const MAX_CAPTURE_ERRORS = 200;
const MAX_PLAN_VARIANTS = 50;
const MAX_DISPLAY_VALUE_CHARS = 2_000;
const MAX_PLAN_TEXT_CHARS = 20_000;

type JsonObject = Record<string, unknown>;

interface NodeBudget {
  remaining: number;
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function displayValue(value: unknown): string | null {
  const text = asText(value);
  if (text !== null) return text.slice(0, MAX_DISPLAY_VALUE_CHARS);
  if (!Array.isArray(value) && asObject(value) === null) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized ? serialized.slice(0, MAX_DISPLAY_VALUE_CHARS) : null;
  } catch {
    return null;
  }
}

function planFallbackText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? null;
  } catch {
    return null;
  }
}

function detailLines(node: JsonObject): string[] {
  const fields: Array<[string, unknown]> = [
    ["Table", node.table_name],
    ["Join", node.join_type],
    ["Join conditions", node.join_conditions],
    ["Filters", node.filter_expressions],
    ["Aggregations", node.aggregation_functions],
    ["Group by", node.group_by_keys],
    ["Sort keys", node.sort_keys],
    ["Projection", node.projection_expressions],
    ["Limit", node.limit_count],
    ["Offset", node.offset_count],
  ];
  const physical = asObject(node.physical_operator);
  if (physical) fields.push(["Physical operator", physical.operator_type]);

  return fields.flatMap(([label, value]) => {
    const text = displayValue(value);
    return text === null ? [] : [`${label}: ${text}`];
  });
}

function parseNode(value: unknown, budget: NodeBudget, depth = 0): QueryPlanNode | null {
  const node = asObject(value);
  if (!node || budget.remaining <= 0 || depth > MAX_PLAN_DEPTH) return null;

  budget.remaining -= 1;
  const children = Array.isArray(node.children) ? node.children : [];
  const parsedChildren: QueryPlanNode[] = [];
  for (const child of children) {
    if (budget.remaining <= 0 || depth >= MAX_PLAN_DEPTH) break;
    const parsed = parseNode(child, budget, depth + 1);
    if (parsed) parsedChildren.push(parsed);
  }

  const marker = node.truncated_at_depth;
  const omitted = node.children_omitted;
  const omittedChildren =
    typeof omitted === "number" && Number.isFinite(omitted) && omitted > 0
      ? Math.floor(omitted) + Math.max(0, children.length - parsedChildren.length)
      : Math.max(0, children.length - parsedChildren.length);

  return {
    operator: asText(node.operator_type)?.slice(0, MAX_DISPLAY_VALUE_CHARS) ?? "Unknown operator",
    details: detailLines(node),
    children: parsedChildren,
    truncatedAtDepth: typeof marker === "number" && Number.isFinite(marker) ? marker : null,
    omittedChildren,
  };
}

function queryEntries(rawQueries: unknown): Array<[string, unknown]> {
  if (Array.isArray(rawQueries)) {
    return rawQueries.slice(0, MAX_PLAN_COUNT).map((entry, index) => {
      const record = asObject(entry);
      return [displayValue(record?.query_id) ?? `Query ${index + 1}`, entry];
    });
  }
  const queryMap = asObject(rawQueries);
  return queryMap
    ? Object.entries(queryMap)
        .slice(0, MAX_PLAN_COUNT)
        .map(([id, value]) => [id.slice(0, MAX_DISPLAY_VALUE_CHARS), value])
    : [];
}

function textualPlan(plan: unknown, planRecord: JsonObject | null): { text: string | null; truncated: boolean } {
  let text = asText(planRecord?.raw_explain_output) ?? asText(planRecord?.plan_text);
  if (text === null && (typeof plan === "string" || typeof plan === "number" || typeof plan === "boolean")) {
    text = planFallbackText(plan);
  }
  if (text === null && plan !== null && planRecord && !asObject(planRecord.logical_root)) {
    text = planFallbackText(plan);
  }
  if (text === null) return { text: null, truncated: false };
  return {
    text: text.slice(0, MAX_PLAN_TEXT_CHARS),
    truncated: text.length > MAX_PLAN_TEXT_CHARS,
  };
}

const QUALIFIED_KEY = /^(.+?)#(\d+)(?::(.*))?$/;

function planLabel(id: string, queryId: string): string {
  const qualified = QUALIFIED_KEY.exec(id);
  if (!qualified) return id === queryId ? id : `${queryId} (${id})`;
  const [, base, stream, testType] = qualified;
  const label = [base, `stream ${stream}`, testType].filter((part) => part).join(" · ");
  return normalizeQueryIdForMatch(base!) === normalizeQueryIdForMatch(queryId) ? label : `${queryId} (${label})`;
}

function parseVariants(value: unknown): PlanVariant[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PLAN_VARIANTS).flatMap((item) => {
    const record = asObject(item);
    const fingerprint = displayValue(record?.fingerprint);
    if (record === null || fingerprint === null) return [];
    return [{ fingerprint, iteration: displayValue(record.iteration), runType: displayValue(record.run_type) }];
  });
}

function parseEntry(id: string, value: unknown): CapturedQueryPlan | null {
  const entry = asObject(value);
  const plan = entry && "plan" in entry ? entry.plan : value;
  const planRecord = asObject(plan);
  const root = planRecord ? parseNode(planRecord.logical_root, { remaining: MAX_PLAN_NODES }) : null;
  const text = textualPlan(plan, planRecord);
  if (!root && text.text === null) return null;

  const queryId = displayValue(planRecord?.query_id) ?? displayValue(entry?.query_id) ?? id;
  return {
    id,
    label: planLabel(id, queryId),
    queryId,
    platform: displayValue(planRecord?.platform),
    estimatedCost: displayValue(planRecord?.estimated_cost),
    estimatedRows: displayValue(planRecord?.estimated_rows),
    fingerprint: displayValue(planRecord?.plan_fingerprint) ?? displayValue(entry?.fingerprint),
    iteration: displayValue(entry?.iteration),
    runType: displayValue(entry?.run_type),
    variants: entry?.fingerprint_varied === true ? parseVariants(entry.fingerprint_variants) : [],
    root,
    textualPlan: text.text,
    textualPlanTruncated: text.truncated,
  };
}

function parseCaptureErrors(value: unknown): PlanCaptureError[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CAPTURE_ERRORS).flatMap((item) => {
    const record = asObject(item);
    if (record === null) return [];
    return [
      {
        queryId: displayValue(record.query_id) ?? "unknown",
        streamId: displayValue(record.stream_id),
        iteration: displayValue(record.iteration),
        message: displayValue(record.error) ?? "Unknown error",
      },
    ];
  });
}

export function normalizeQueryIdForMatch(queryId: string): string {
  const base = queryId.trim().split("#")[0]?.trim() ?? "";
  const numeric = /^q?0*(\d+)$/i.exec(base);
  return numeric ? numeric[1]! : base.toLowerCase();
}

export function plansForQuery(plans: readonly CapturedQueryPlan[], queryId: string): CapturedQueryPlan[] {
  const wanted = normalizeQueryIdForMatch(queryId);
  return plans.filter((plan) => normalizeQueryIdForMatch(plan.queryId) === wanted);
}

export function captureErrorsForQuery(errors: readonly PlanCaptureError[], queryId: string): PlanCaptureError[] {
  const wanted = normalizeQueryIdForMatch(queryId);
  return errors.filter((error) => normalizeQueryIdForMatch(error.queryId) === wanted);
}

export interface PlanCaptureErrorGroup {
  queryId: string;
  streamId: string | null;
  message: string;
  iterations: string[];
}

export function groupCaptureErrors(errors: readonly PlanCaptureError[]): PlanCaptureErrorGroup[] {
  const groups = new Map<string, PlanCaptureErrorGroup>();
  for (const error of errors) {
    const key = JSON.stringify([error.queryId, error.streamId, error.message]);
    let group = groups.get(key);
    if (!group) {
      group = { queryId: error.queryId, streamId: error.streamId, message: error.message, iterations: [] };
      groups.set(key, group);
    }
    if (error.iteration !== null) group.iterations.push(error.iteration);
  }
  return [...groups.values()];
}

export function parseQueryPlanDocument(payload: unknown): QueryPlanDocument {
  const document = asObject(payload);
  if (!document) return { plans: [], captureFailures: 0, captureErrors: [], truncated: false };

  const plans = queryEntries(document.queries)
    .map(([id, value]) => parseEntry(id, value))
    .filter((plan): plan is CapturedQueryPlan => plan !== null);
  const captureFailures = document.capture_failures;

  return {
    plans,
    captureFailures:
      typeof captureFailures === "number" && Number.isFinite(captureFailures) && captureFailures > 0
        ? Math.floor(captureFailures)
        : 0,
    captureErrors: parseCaptureErrors(document.errors),
    truncated: document.truncated === true,
  };
}
