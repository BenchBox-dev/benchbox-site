import path from "node:path";
import type { DocInfo } from "../../src/converter/model.ts";
import type { TitleNode } from "../../src/lib/smartypants.ts";
import type { Context } from "./context.ts";

const UNSAFE_OUTSIDE_CODE = /[[\]*_<>\\!|&]/;

function escapeText(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, (character) => `\\${character}`);
}

export function nodesMarkdown(nodes: readonly TitleNode[]): string {
  return nodes.map((node) => (node.type === "inlineCode" ? `\`${node.value}\`` : escapeText(node.value))).join("");
}

function fromNodes(info: DocInfo): string {
  return nodesMarkdown(info.titleNodes);
}

export function titleMarkdown(context: Context, info: DocInfo): string {
  const first = context.headings.get(info.path)?.find((heading) => heading.level === 1);
  if (first === undefined) return fromNodes(info);
  const outsideCode = first.text.replace(/`[^`]*`/g, "");
  return UNSAFE_OUTSIDE_CODE.test(outsideCode) ? fromNodes(info) : first.text;
}

export function relativeLink(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative === "" ? path.posix.basename(to) : relative;
}
