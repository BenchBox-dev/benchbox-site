import path from "node:path";
import type { DocInfo, TocSection } from "../../src/converter/model.ts";
import type { Context, LabelSite } from "./context.ts";
import { FENCE, LABEL_LINE } from "./context.ts";
import { nodesMarkdown, relativeLink, titleMarkdown } from "./titles.ts";

type Directive = { name: string; argument: string; options: Map<string, string>; body: string[]; line: number };

export type Findings = { droppedToctrees: string[]; flattened: string[]; kept: string[] };

const DIRECTIVE_INFO = /^\{([^}\s]+)\}\s*(.*)$/;
const OPTION_LINE = /^:([\w-]+):(?:\s+(.*))?$/;
const ATTRS_ID_LINE = /^\{#([^\s#.=]+)\}\s*$/;
const DEFINITION_START = /^:(\s+|$)/;
const BULLET = /^[-*+]\s+/;
const ORDERED = /^\d{1,9}[.)]\s/;
const ALERTS: Readonly<Record<string, string>> = { note: "NOTE", tip: "TIP", warning: "WARNING", important: "IMPORTANT", deprecated: "WARNING" };

function spanLine(id: string): string {
  return `<span id="${id}"></span>`;
}

function parseDirective(name: string, argument: string, rawBody: string[], line: number): Directive {
  const options = new Map<string, string>();
  let consumed = 0;
  while (consumed < rawBody.length) {
    const option = OPTION_LINE.exec(rawBody[consumed]);
    if (!option) break;
    options.set(option[1], option[2] ?? "");
    consumed += 1;
  }
  if (consumed > 0 && rawBody[consumed] !== undefined && rawBody[consumed].trim() === "") consumed += 1;
  return { name, argument, options, body: rawBody.slice(consumed), line };
}

function quoted(lines: readonly string[]): string[] {
  return lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`));
}

function alert(directive: Directive, file: string): string[] {
  const kind = ALERTS[directive.name];
  if (directive.body.some((line) => FENCE.test(line))) throw new Error(`${file}:${directive.line}: an admonition with a code fence is not supported`);
  let body = [...directive.body];
  if (directive.name === "deprecated") {
    const [version, ...rest] = directive.argument.split(/\s+/);
    if (!version) throw new Error(`${file}:${directive.line}: deprecated needs a version`);
    const lead = `**Deprecated since ${version}.**${rest.length > 0 ? ` ${rest.join(" ")}` : ""}`;
    body = [`${lead} ${body[0] ?? ""}`.trimEnd(), ...body.slice(1)];
  } else if (directive.argument !== "") body = [directive.argument, ...body];
  return [`> [!${kind}]`, ...quoted(body)];
}

function listTable(directive: Directive, file: string): string[] {
  const rows: string[][] = [];
  for (const line of directive.body) {
    if (line.trim() === "") continue;
    const start = /^\* - (.*)$/.exec(line);
    const cell = /^ {2}- (.*)$/.exec(line);
    if (start) rows.push([start[1]]);
    else if (cell && rows.length > 0) rows[rows.length - 1].push(cell[1]);
    else throw new Error(`${file}:${directive.line}: list-table line is not a single-line cell: ${line}`);
  }
  const widths = new Set(rows.map((row) => row.length));
  if (rows.length === 0 || widths.size !== 1) throw new Error(`${file}:${directive.line}: list-table rows differ in width`);
  if (directive.options.get("header-rows") !== "1") throw new Error(`${file}:${directive.line}: list-table without exactly one header row`);
  if (rows.some((row) => row.some((cell) => cell.includes("|")))) throw new Error(`${file}:${directive.line}: list-table cell holds a pipe`);
  const render = (row: string[]): string => `| ${row.join(" | ")} |`;
  return [render(rows[0]), `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(render)];
}

function tocEntries(directive: Directive, file: string): { target: string; title?: string }[] {
  return directive.body
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((text) => {
      if (/:\/\//.test(text) || text === "self") throw new Error(`${file}:${directive.line}: toctree entry ${text} is not supported`);
      const titled = /^([\s\S]+?)\s*<([^<>]*)>$/.exec(text);
      return titled ? { target: titled[2], title: titled[1] } : { target: text };
    });
}

function linkedPages(file: string, lines: readonly string[]): Set<string> {
  const linked = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/\]\(([^)#\s:]+\.md)(?:#[^)\s]*)?\)/g)) linked.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  }
  return linked;
}

function additionalTopSections(info: DocInfo, file: string): string[] {
  return info.toc
    .filter((node): node is TocSection => node.kind === "section")
    .slice(1)
    .map((section) => `- [${nodesMarkdown(section.title)}](${relativeLink(file, info.path)}#${section.anchor})`);
}

function staticToctree(directive: Directive, file: string, context: Context, linked: ReadonlySet<string>, findings: Findings): string[] {
  if (directive.options.has("hidden")) return [];
  const entries = tocEntries(directive, file).map((entry) => {
    const info = context.index.resolveDoc(file, entry.target, { file, line: directive.line }, "toctree");
    return { info: context.infos.get(info.path)!, title: entry.title };
  });
  if (entries.every((entry) => linked.has(entry.info.path))) {
    findings.droppedToctrees.push(`${file}:${directive.line}`);
    return [];
  }
  if (directive.options.get("maxdepth") === "2") findings.flattened.push(`${file}:${directive.line}`);
  const caption = directive.options.get("caption");
  const list = entries.flatMap((entry) => [
    `- [${entry.title ?? titleMarkdown(context, entry.info)}](${relativeLink(file, entry.info.path)})`,
    ...(directive.options.get("maxdepth") === "1" ? additionalTopSections(entry.info, file) : []),
  ]);
  return caption ? [`**${caption.trim()}**`, "", ...list] : list;
}

function directiveLines(directive: Directive, file: string, context: Context, linked: ReadonlySet<string>, findings: Findings): string[] | "tags" {
  if (directive.name === "tags") return "tags";
  if (directive.name in ALERTS) return alert(directive, file);
  if (directive.name === "mermaid") return ["```mermaid", ...directive.body, "```"];
  if (directive.name === "list-table") return listTable(directive, file);
  if (directive.name === "toctree") return staticToctree(directive, file, context, linked, findings);
  throw new Error(`${file}:${directive.line}: directive ${directive.name} is not migrated by this script`);
}

type Entry = { term: string; definitions: string[] };

function groupDefinitions(lines: readonly string[]): { preamble: string[]; entries: Entry[] } {
  const entries: Entry[] = [];
  const preamble: string[] = [];
  lines.forEach((line, index) => {
    const current = entries[entries.length - 1];
    const startsDefinition = DEFINITION_START.test(line);
    const nextIsDefinition = index + 1 < lines.length && DEFINITION_START.test(lines[index + 1]);
    if (startsDefinition && current) current.definitions.push(line.replace(DEFINITION_START, ""));
    else if (nextIsDefinition) entries.push({ term: line, definitions: [] });
    else if (current && current.definitions.length > 0) current.definitions[current.definitions.length - 1] += `\n${line}`;
    else preamble.push(line);
  });
  return { preamble, entries };
}

function definitionList(lines: readonly string[]): { lines: string[]; endsWithBullet: boolean } {
  const { preamble, entries } = groupDefinitions(lines);
  const out: string[] = [];
  const gap = (): void => {
    if (out.length > 0) out.push("");
  };
  if (preamble.length > 0) out.push(...preamble);
  let endsWithBullet = false;
  for (const entry of entries) {
    gap();
    const term = entry.term.trim();
    const bold = /^\*\*[^*]+\*\*$/.test(term) ? term : `**${term}**`;
    const [only] = entry.definitions;
    endsWithBullet = false;
    if (entry.definitions.length === 1 && !BULLET.test(only) && !ORDERED.test(only)) out.push(`${bold}: ${only}`);
    else {
      out.push(bold);
      for (const definition of entry.definitions) {
        out.push("", ...definition.split("\n"));
        endsWithBullet = BULLET.test(definition);
      }
    }
  }
  return { lines: out, endsWithBullet };
}

function fenceEnd(lines: readonly string[], start: number, marker: string, indent: string): number {
  const closing = new RegExp(`^${indent}\\s{0,3}${marker[0] === "\`" ? "\`" : "~"}{${marker.length},}\\s*$`);
  for (let index = start + 1; index < lines.length; index += 1) if (closing.test(lines[index])) return index;
  throw new Error(`fence opened at line ${start + 1} is never closed`);
}

export function collapseBlankLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const opening = FENCE.exec(line);
    if (opening) {
      if (fence === undefined) fence = opening[1];
      else if (opening[1][0] === fence[0] && opening[1].length >= fence.length && line.trim() === opening[1]) fence = undefined;
    }
    if (fence === undefined && line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

export function rewriteStructure(file: string, body: readonly string[], context: Context, definitionLists: boolean, findings: Findings): string[] {
  const out: string[] = [];
  const linked = linkedPages(file, body);
  const sites = context.labelSites.get(file) ?? new Map<string, LabelSite>();
  let paragraph: string[] = [];
  let tighten = false;
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    if (definitionLists && paragraph.some((line, position) => position > 0 && DEFINITION_START.test(line))) {
      const converted = definitionList(paragraph);
      out.push(...converted.lines);
      tighten = converted.endsWithBullet;
    } else out.push(...paragraph);
    paragraph = [];
  };
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index];
    const opening = FENCE.exec(line);
    if (opening) {
      flushParagraph();
      const marker = opening[1];
      const indent = /^\s*/.exec(line)![0];
      const end = fenceEnd(body, index, marker, indent);
      const info = DIRECTIVE_INFO.exec(line.slice(indent.length + marker.length).trim());
      if (!info) out.push(...body.slice(index, end + 1));
      else {
        if (indent !== "") throw new Error(`${file}:${index + 1}: an indented directive is not supported`);
        const converted = directiveLines(parseDirective(info[1], info[2].trim(), body.slice(index + 1, end), index + 1), file, context, linked, findings);
        if (converted !== "tags") out.push(...converted);
      }
      index = end;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      if (tighten) {
        tighten = false;
        let next = index;
        while (next < body.length && body[next].trim() === "") next += 1;
        if (next < body.length && BULLET.test(body[next])) {
          index = next - 1;
          continue;
        }
      }
      out.push("");
      continue;
    }
    const label = LABEL_LINE.exec(line);
    const attrs = ATTRS_ID_LINE.exec(line);
    if (label) {
      flushParagraph();
      const site = sites.get(label[1]);
      if (site === undefined || site.id === "") throw new Error(`${file}:${index + 1}: label ${label[1]} has no id`);
      if (site.heading === undefined || site.heading.slug !== site.id) out.push(spanLine(site.id), "");
      continue;
    }
    if (attrs) {
      flushParagraph();
      out.push(spanLine(attrs[1]), "");
      continue;
    }
    if (line.startsWith("%")) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return collapseBlankLines(out);
}
