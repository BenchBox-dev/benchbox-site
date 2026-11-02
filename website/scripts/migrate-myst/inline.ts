import path from "node:path";
import type { Context } from "./context.ts";
import { FENCE } from "./context.ts";
import { relativeLink, titleMarkdown } from "./titles.ts";

type Segment = { code: boolean; text: string };

const ROLE_SUFFIX = /\{(doc|ref)\}$/;
const TITLED = /^([\s\S]+?)\s*<([^<>]*)>$/;
const LINK_WITH_FRAGMENT = /\]\(([^)#\s:]*)#([^)\s]+)\)/g;

function segments(line: string): Segment[] {
  const found: Segment[] = [];
  let text = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      text += line[index];
      index += 1;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run += 1;
    const ticks = "`".repeat(run);
    const close = line.indexOf(ticks, index + run);
    if (close < 0) {
      text += ticks;
      index += run;
      continue;
    }
    if (text !== "") found.push({ code: false, text });
    text = "";
    found.push({ code: true, text: line.slice(index, close + run) });
    index = close + run;
  }
  if (text !== "") found.push({ code: false, text });
  return found;
}

function codeContent(span: string): string {
  const ticks = /^`+/.exec(span)![0].length;
  return span.slice(ticks, span.length - ticks).trim();
}

function docRole(file: string, content: string, context: Context): string {
  const titled = TITLED.exec(content);
  const target = titled ? titled[2] : content;
  const resolved = context.index.resolveDoc(file, target, { file, line: 0 });
  const info = context.infos.get(resolved.path)!;
  return `[${titled ? titled[1] : titleMarkdown(context, info)}](${relativeLink(file, info.path)})`;
}

function refRole(file: string, content: string, context: Context): string {
  const titled = TITLED.exec(content);
  const label = titled ? titled[2] : content;
  const owner = context.labelOwners.get(label);
  if (!owner) throw new Error(`${file}: {ref} label ${label} is not defined`);
  const info = context.infos.get(owner.path)!;
  const site = context.labelSites.get(owner.path)?.get(label);
  const text = titled ? titled[1] : owner.info.title === undefined ? titleMarkdown(context, info) : owner.info.title.map((node) => (node.type === "inlineCode" ? `\`${node.value}\`` : node.value)).join("");
  const target = relativeLink(file, owner.path);
  if (site?.firstHeading && site.heading?.level === 1) return `[${text}](${target})`;
  const fragment = site?.heading !== undefined && site.uniqueSlug ? site.heading.slug : owner.info.id;
  return `[${text}](${target}#${fragment})`;
}

function rewriteFragments(file: string, text: string, context: Context): string {
  return text.replace(LINK_WITH_FRAGMENT, (whole, target: string, fragment: string) => {
    const targetPath = target === "" ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    if (target !== "" && !target.endsWith(".md")) return whole;
    const sites = context.labelSites.get(targetPath);
    if (!sites) return whole;
    const site = [...sites.values()].find((candidate) => candidate.id === fragment);
    if (!site || site.heading === undefined || !site.uniqueSlug || site.heading.slug === fragment) return whole;
    return `](${target}#${site.heading.slug})`;
  });
}

function rewriteLine(file: string, line: string, context: Context): string {
  const parts = segments(line);
  const table = line.trimStart().startsWith("|");
  let out = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];
    if (!part.code) {
      const role = next?.code ? ROLE_SUFFIX.exec(part.text) : null;
      out += rewriteFragments(file, role ? part.text.slice(0, part.text.length - role[0].length) : part.text, context);
      if (role && next) {
        const link = role[1] === "doc" ? docRole(file, codeContent(next.text), context) : refRole(file, codeContent(next.text), context);
        out += table ? link.replace(/\|/g, "\\|") : link;
        index += 1;
      }
    } else out += part.text;
  }
  return out;
}

export function rewriteInline(file: string, lines: readonly string[], context: Context): string[] {
  let fence: string | undefined;
  return lines.map((line) => {
    const opening = FENCE.exec(line);
    if (opening) {
      if (fence === undefined) fence = opening[1];
      else if (opening[1][0] === fence[0] && opening[1].length >= fence.length && line.trim() === opening[1]) fence = undefined;
      return line;
    }
    return fence === undefined && /[{\]]/.test(line) ? rewriteLine(file, line, context) : line;
  });
}
