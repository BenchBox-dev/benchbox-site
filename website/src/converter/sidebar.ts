import { smarten } from "../lib/smartypants.ts";
import type { DocsIndex } from "./docs-index.ts";
import { ConverterError } from "./errors.ts";
import type { DocInfo, ToctreeEntry } from "./model.ts";
import { NAV_FILE, type Nav, type NavGroup, type NavItem } from "./nav.ts";
import { TAG_CATEGORIES } from "./tag-categories.ts";
import { TAGS_DIRECTORY } from "./tag-pages.ts";

export type SidebarItem = { label: string; link: string; items?: SidebarItem[] };

export type SidebarGroup = { label: string | null; items: SidebarItem[] };

export type SidebarManifest = { groups: SidebarGroup[]; order: Record<string, number> };

export const ROOT_DOCUMENT = "index.md";

type Walk = { index: DocsIndex; order: Map<string, number> };

function claim(walk: Walk, path: string): void {
  if (!walk.order.has(path)) walk.order.set(path, walk.order.size);
}

function orderOf(walk: Walk): Record<string, number> {
  const order: Record<string, number> = {};
  for (const [path, position] of [...walk.order.entries()].sort((a, b) => a[1] - b[1])) order[path] = position;
  return order;
}

function itemFor(walk: Walk, entry: ToctreeEntry, trail: string[]): SidebarItem | undefined {
  if (entry.kind === "self") return undefined;
  if (entry.kind === "url") return { label: smarten(entry.title), link: entry.url };
  const info = walk.index.get(entry.path);
  if (!info) return undefined;
  claim(walk, info.path);
  const item: SidebarItem = { label: entry.title === undefined ? info.title : smarten(entry.title), link: info.route };
  if (trail.includes(info.path)) return item;
  const children = info.toctrees
    .flatMap((block) => block.entries)
    .map((child) => itemFor(walk, child, [...trail, info.path]))
    .filter((child): child is SidebarItem => child !== undefined);
  if (children.length > 0) item.items = children;
  return item;
}

export function buildSidebar(index: DocsIndex): SidebarManifest {
  const walk: Walk = { index, order: new Map() };
  const root = index.get(ROOT_DOCUMENT);
  const groups: SidebarGroup[] = [];
  if (root) {
    claim(walk, root.path);
    for (const block of root.toctrees) {
      const items = block.entries.map((entry) => itemFor(walk, entry, [root.path])).filter((item): item is SidebarItem => item !== undefined);
      groups.push({ label: block.caption === undefined ? null : smarten(block.caption), items });
    }
  }
  return { groups, order: orderOf(walk) };
}

function navItem(walk: Walk, entry: NavItem): SidebarItem {
  if (entry.kind === "url") return { label: smarten(entry.label), link: entry.url };
  const info = walk.index.get(entry.page);
  if (!info) throw new ConverterError(NAV_FILE, entry.line, `${entry.page} does not match a document under docs/`);
  claim(walk, info.path);
  const item: SidebarItem = { label: entry.label === undefined ? info.title : smarten(entry.label), link: info.route };
  if (entry.items.length > 0) item.items = entry.items.map((child) => navItem(walk, child));
  return item;
}

function tagCategoryItems(walk: Walk, group: NavGroup, tagCounts: ReadonlyMap<string, number>): SidebarItem[] {
  return TAG_CATEGORIES.map((category) => {
    const info = walk.index.get(`${TAGS_DIRECTORY}/cat-${category.slug}.md`);
    if (!info) throw new ConverterError(NAV_FILE, group.line, `generated tag category page cat-${category.slug} is missing`);
    claim(walk, info.path);
    const item: SidebarItem = { label: info.title, link: info.route };
    const tags = category.tags.filter((tag) => tagCounts.has(tag) && walk.index.get(`${TAGS_DIRECTORY}/${tag}.md`) !== undefined);
    if (tags.length > 0) {
      item.items = tags.map((tag) => {
        const page = walk.index.get(`${TAGS_DIRECTORY}/${tag}.md`) as DocInfo;
        claim(walk, page.path);
        return { label: smarten(`${tag} (${tagCounts.get(tag)})`), link: page.route };
      });
    }
    return item;
  });
}

export function buildNavSidebar(index: DocsIndex, nav: Nav, tagCounts: ReadonlyMap<string, number>): SidebarManifest {
  const walk: Walk = { index, order: new Map() };
  const root = index.get(ROOT_DOCUMENT);
  if (root) claim(walk, root.path);
  const groups: SidebarGroup[] = nav.groups.map((group) => ({
    label: smarten(group.label),
    items: group.generated === "tag-categories" ? tagCategoryItems(walk, group, tagCounts) : group.items.map((entry) => navItem(walk, entry)),
  }));
  return { groups, order: orderOf(walk) };
}

export type StarlightSidebarEntry = { label: string; link: string } | { label: string; collapsed: boolean; items: StarlightSidebarEntry[] };

function toStarlight(item: SidebarItem): StarlightSidebarEntry {
  if (!item.items) return { label: item.label, link: item.link };
  return { label: item.label, collapsed: true, items: [{ label: item.label, link: item.link }, ...item.items.map(toStarlight)] };
}

export function toStarlightSidebar(manifest: SidebarManifest): StarlightSidebarEntry[] {
  return manifest.groups.map((group, position) => ({
    label: group.label ?? `Section ${position + 1}`,
    collapsed: false,
    items: group.items.map(toStarlight),
  }));
}
