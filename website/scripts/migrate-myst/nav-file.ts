import type { Context } from "./context.ts";
import type { SidebarItem } from "../../src/converter/sidebar.ts";

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 _./&()-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|y|n|\d+)$/i;

function scalar(value: string): string {
  return PLAIN.test(value) && !RESERVED.test(value) ? value : JSON.stringify(value);
}

function pathOf(route: string): string {
  return `${route.replace(/^\/docs\//, "").replace(/\.html$/, "")}.md`;
}

function itemLines(context: Context, item: SidebarItem, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const page = pathOf(item.link);
  const info = context.infos.get(page);
  if (!info) throw new Error(`sidebar link ${item.link} is not a page`);
  const renamed = item.label !== info.title;
  if (!renamed && !item.items) return [`${indent}- ${scalar(page)}`];
  const lines = [`${indent}- page: ${scalar(page)}`];
  if (renamed) lines.push(`${indent}  label: ${scalar(item.label)}`);
  if (item.items) {
    lines.push(`${indent}  items:`);
    for (const child of item.items) lines.push(...itemLines(context, child, depth + 2));
  }
  return lines;
}

export function navFile(context: Context): string {
  const lines = ["groups:"];
  for (const group of context.sidebar.groups) {
    if (group.label === null) throw new Error("a sidebar group has no caption");
    lines.push(`  - label: ${scalar(group.label)}`);
    if (group.label === "Browse by Tag") lines.push("    generated: tag-categories");
    else {
      lines.push("    items:");
      for (const item of group.items) lines.push(...itemLines(context, item, 3));
    }
  }
  return `${lines.join("\n")}\n`;
}
