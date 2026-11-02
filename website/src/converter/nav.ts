import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { ConverterError } from "./errors.ts";

export const NAV_FILE = "nav.yml";

export type NavItem = { kind: "page"; page: string; label?: string; items: NavItem[]; line: number } | { kind: "url"; url: string; label: string; line: number };

export type NavGroup = { label: string; line: number; items: NavItem[]; generated?: "tag-categories" };

export type Nav = { groups: NavGroup[] };

const GENERATED_SOURCES: ReadonlySet<string> = new Set(["tag-categories"]);

type Source = { text: string; lines: LineCounter };

function lineOf(source: Source, node: Node | null | undefined): number {
  const offset = node?.range?.[0];
  return offset === undefined ? 1 : source.lines.linePos(offset).line;
}

function fail(source: Source, node: Node | null | undefined, message: string): never {
  throw new ConverterError(NAV_FILE, lineOf(source, node), message);
}

function checkKeys(source: Source, map: Node, allowed: readonly string[], context: string): void {
  if (!isMap(map)) return;
  for (const pair of map.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (!allowed.includes(key)) fail(source, pair.key as Node, `unknown key ${JSON.stringify(key)} in ${context}; allowed: ${allowed.join(", ")}`);
  }
}

function stringValue(source: Source, map: Node, key: string, required: boolean, context: string): string | undefined {
  if (!isMap(map)) return undefined;
  const value = map.get(key, true) as Node | undefined;
  if (value === undefined) {
    if (required) fail(source, map, `${context} needs ${key}`);
    return undefined;
  }
  if (!isScalar(value) || typeof value.value !== "string" || value.value.trim() === "") fail(source, value, `${context} ${key} must be a non-empty string`);
  return (value.value as string).trim();
}

function parseItem(source: Source, node: Node): NavItem {
  const line = lineOf(source, node);
  if (isScalar(node)) {
    if (typeof node.value !== "string" || node.value.trim() === "") fail(source, node, "a navigation entry must be a page path or a mapping");
    return { kind: "page", page: node.value.trim(), items: [], line };
  }
  if (!isMap(node)) return fail(source, node, "a navigation entry must be a page path or a mapping");
  if (node.has("url")) {
    checkKeys(source, node, ["label", "url"], "a link entry");
    return { kind: "url", url: stringValue(source, node, "url", true, "a link entry") as string, label: stringValue(source, node, "label", true, "a link entry") as string, line };
  }
  checkKeys(source, node, ["page", "label", "items"], "a page entry");
  const page = stringValue(source, node, "page", true, "a page entry") as string;
  const label = stringValue(source, node, "label", false, "a page entry");
  const children = node.get("items", true) as Node | undefined;
  const items = children === undefined ? [] : parseItems(source, children, `the items of ${page}`);
  const entry: NavItem = { kind: "page", page, items, line };
  if (label !== undefined) entry.label = label;
  return entry;
}

function parseItems(source: Source, node: Node, context: string): NavItem[] {
  if (!isSeq(node) || node.items.length === 0) fail(source, node, `${context} must be a non-empty list`);
  const items = (node as { items: Node[] }).items.map((child) => parseItem(source, child));
  const seen = new Set<string>();
  for (const item of items) {
    if (item.kind !== "page") continue;
    if (seen.has(item.page)) throw new ConverterError(NAV_FILE, item.line, `${item.page} is listed twice in ${context}`);
    seen.add(item.page);
  }
  return items;
}

function parseGroup(source: Source, node: Node): NavGroup {
  if (!isMap(node)) return fail(source, node, "a navigation group must be a mapping with a label");
  checkKeys(source, node, ["label", "items", "generated"], "a group");
  const label = stringValue(source, node, "label", true, "a group") as string;
  const line = lineOf(source, node);
  const generated = stringValue(source, node, "generated", false, `group ${label}`);
  const items = node.get("items", true) as Node | undefined;
  if (generated !== undefined) {
    if (!GENERATED_SOURCES.has(generated)) fail(source, node, `group ${label} generates from unknown source ${JSON.stringify(generated)}; known: ${[...GENERATED_SOURCES].join(", ")}`);
    if (items !== undefined) fail(source, items, `group ${label} cannot have both items and generated`);
    return { label, line, items: [], generated: generated as "tag-categories" };
  }
  if (items === undefined) return fail(source, node, `group ${label} needs items or generated`);
  return { label, line, items: parseItems(source, items, `group ${label}`) };
}

export function parseNav(text: string): Nav {
  const lines = new LineCounter();
  const source: Source = { text, lines };
  const document = parseDocument(text, { lineCounter: lines });
  if (document.errors.length > 0) {
    const [problem] = document.errors;
    throw new ConverterError(NAV_FILE, problem.linePos?.[0].line ?? 1, `not valid YAML: ${problem.message}`);
  }
  const root = document.contents as Node | null;
  if (!isMap(root)) return fail(source, root, "the file must be a mapping with a groups list");
  checkKeys(source, root, ["groups"], "the file");
  const groups = root.get("groups", true) as Node | undefined;
  if (!isSeq(groups) || groups.items.length === 0) return fail(source, groups ?? root, "groups must be a non-empty list");
  const parsed = (groups as { items: Node[] }).items.map((group) => parseGroup(source, group));
  const labels = new Set<string>();
  for (const group of parsed) {
    if (labels.has(group.label)) throw new ConverterError(NAV_FILE, group.line, `group ${group.label} is listed twice`);
    labels.add(group.label);
  }
  return { groups: parsed };
}
