import { parse } from "yaml";

export const EMBED_FENCE = "benchbox-result";
export const MAX_CURRENT_RESULTS = 10;

export interface Citation {
  result: string;
  snapshot: string;
  snapshotDate: string;
  platform: string;
  benchmark: string;
  scale: string;
  runDate: string;
  metric: string;
  direction: string;
  value: string;
}

export type EmbedBlock = { kind: "cited"; citation: Citation } | { kind: "current"; results: string[] };

export class EmbedBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedBlockError";
  }
}

const RESULT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const SNAPSHOT_SHA = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIRECTIONS = ["higher is better", "lower is better"];

const CITED_KEYS = ["kind", "result", "snapshot", "snapshot_date", "platform", "benchmark", "scale", "run_date", "metric", "direction", "value"] as const;
const CURRENT_KEYS = ["kind", "results"] as const;

function mapping(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parse(body, { uniqueKeys: true });
  } catch (error) {
    throw new EmbedBlockError(`the ${EMBED_FENCE} block is not valid YAML: ${(error as Error).message.split("\n")[0]}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new EmbedBlockError(`the ${EMBED_FENCE} block must be a list of "key: value" lines`);
  return parsed as Record<string, unknown>;
}

function rejectUnknownKeys(block: Record<string, unknown>, allowed: readonly string[], kind: string): void {
  const unknown = Object.keys(block).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new EmbedBlockError(`a ${kind} ${EMBED_FENCE} block has no key ${unknown.join(", ")}; allowed keys are ${allowed.join(", ")}`);
}

function text(block: Record<string, unknown>, key: string): string {
  const value = block[key];
  if (typeof value === "number") throw new EmbedBlockError(`${key} must be written as text, for example ${key}: "${String(value)}"`);
  if (typeof value !== "string" || value.trim() === "") throw new EmbedBlockError(`a cited ${EMBED_FENCE} block needs ${key}`);
  return value.trim();
}

function resultId(value: unknown, label: string): string {
  if (typeof value !== "string" || !RESULT_ID.test(value)) throw new EmbedBlockError(`${label} ${JSON.stringify(value)} is not a result id such as tpch-duckdb-sf1.0-20260826-d4fa245c`);
  return value;
}

function cited(block: Record<string, unknown>): EmbedBlock {
  rejectUnknownKeys(block, CITED_KEYS, "cited");
  const snapshot = text(block, "snapshot");
  if (!SNAPSHOT_SHA.test(snapshot)) throw new EmbedBlockError("snapshot must be the 64 hex characters of the snapshot sha256");
  const snapshotDate = text(block, "snapshot_date");
  const runDate = text(block, "run_date");
  for (const [key, date] of [["snapshot_date", snapshotDate], ["run_date", runDate]]) {
    if (!ISO_DATE.test(date!)) throw new EmbedBlockError(`${key} must be a date written as YYYY-MM-DD`);
  }
  const direction = text(block, "direction");
  if (!DIRECTIONS.includes(direction)) throw new EmbedBlockError(`direction must be one of: ${DIRECTIONS.join(", ")}`);
  return {
    kind: "cited",
    citation: {
      result: resultId(block.result, "result"),
      snapshot,
      snapshotDate,
      platform: text(block, "platform"),
      benchmark: text(block, "benchmark"),
      scale: text(block, "scale"),
      runDate,
      metric: text(block, "metric"),
      direction,
      value: text(block, "value"),
    },
  };
}

function current(block: Record<string, unknown>): EmbedBlock {
  rejectUnknownKeys(block, CURRENT_KEYS, "current");
  const list = block.results;
  if (!Array.isArray(list) || list.length === 0) throw new EmbedBlockError(`a current ${EMBED_FENCE} block needs results: a list of result ids`);
  if (list.length > MAX_CURRENT_RESULTS) throw new EmbedBlockError(`a current ${EMBED_FENCE} block lists at most ${MAX_CURRENT_RESULTS} results`);
  const results = list.map((entry) => resultId(entry, "results entry"));
  const repeated = results.find((id, index) => results.indexOf(id) !== index);
  if (repeated) throw new EmbedBlockError(`results lists ${repeated} twice`);
  return { kind: "current", results };
}

export function parseEmbedBlock(body: string): EmbedBlock {
  const block = mapping(body);
  if (block.kind === "cited") return cited(block);
  if (block.kind === "current") return current(block);
  throw new EmbedBlockError(`a ${EMBED_FENCE} block starts with kind: cited or kind: current`);
}

export function formatCitationBlock(citation: Citation): string {
  const lines: [string, string][] = [
    ["kind", "cited"],
    ["result", citation.result],
    ["snapshot", citation.snapshot],
    ["snapshot_date", citation.snapshotDate],
    ["platform", citation.platform],
    ["benchmark", citation.benchmark],
    ["scale", citation.scale],
    ["run_date", citation.runDate],
    ["metric", citation.metric],
    ["direction", citation.direction],
    ["value", citation.value],
  ];
  const body = lines.map(([key, value]) => `${key}: ${key === "kind" ? value : JSON.stringify(value)}`).join("\n");
  return `\`\`\`${EMBED_FENCE}\n${body}\n\`\`\`\n`;
}
