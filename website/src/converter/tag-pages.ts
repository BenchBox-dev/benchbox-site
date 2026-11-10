import type { TitleNode } from "../lib/smartypants.ts";
import { TAG_CATEGORIES, type TagCategory } from "./tag-categories.ts";

export const TAGS_DIRECTORY = "_tags";

export type TaggedDocument = { path: string; title: readonly TitleNode[]; tags: readonly string[] };

export type VirtualSource = { relative: string; raw: string };

const CATEGORY_TAG = /^[a-z0-9_-]+$/;

export function displayTag(tag: string): string {
  return tag.replace(/\\n/g, "\n").replace(/^"+|"+$/g, "").trim().replace(/\s+/g, " ");
}

export function tagBasename(tag: string): string {
  return tag
    .replace(/[\s\W]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

function compareCodepoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type TagGroup = { name: string; pages: TaggedDocument[] };

function titleMarkdown(title: readonly TitleNode[]): string {
  return title.map((node) => (node.type === "inlineCode" ? `\`${node.value}\`` : node.value.replace(/[\\`*_[\]<>]/g, "\\$&"))).join("");
}

function groupByTag(documents: readonly TaggedDocument[]): Map<string, TagGroup> {
  const groups = new Map<string, TagGroup>();
  for (const document of documents) {
    for (const raw of document.tags) {
      const name = displayTag(raw);
      if (name === "") continue;
      const basename = tagBasename(name);
      if (basename === "") continue;
      const group = groups.get(basename) ?? { name, pages: [] };
      group.pages.push(document);
      groups.set(basename, group);
    }
  }
  for (const group of groups.values()) group.pages.sort((a, b) => compareCodepoints(a.path, b.path));
  return groups;
}

export function tagCounts(documents: readonly TaggedDocument[]): Map<string, number> {
  return new Map([...groupByTag(documents)].map(([basename, group]) => [basename, group.pages.length]));
}

function tagPage(name: string, pages: readonly TaggedDocument[]): string {
  const lines = [`# Tagged with: ${name}`, "", "**Pages with this tag**", ""];
  for (const page of pages) lines.push(`- [${titleMarkdown(page.title)}](../${page.path})`);
  lines.push("");
  return lines.join("\n");
}

function categoryPage(title: string, entries: readonly string[]): string {
  const lines = [`# ${title}`, ""];
  if (entries.length === 0) lines.push("*No tags in this category yet.*");
  else lines.push(...entries.map((entry) => `- ${entry}`));
  lines.push("");
  return lines.join("\n");
}

export function browseCategories(tags: Iterable<string>): readonly TagCategory[] {
  const categorized = new Set(TAG_CATEGORIES.flatMap((category) => category.tags));
  const leftovers = [...tags].filter((tag) => !categorized.has(tag)).sort(compareCodepoints);
  return leftovers.length === 0 ? TAG_CATEGORIES : [...TAG_CATEGORIES, { slug: "other", title: "Other Tags", tags: leftovers }];
}

function tagEntries(category: TagCategory, groups: ReadonlyMap<string, TagGroup>): string[] {
  return category.tags.filter((tag) => CATEGORY_TAG.test(tag) && groups.has(tag)).map((tag) => `[${tag} (${groups.get(tag)?.pages.length ?? 0})](${tag}.md)`);
}

function indexPage(categories: readonly TagCategory[], groups: ReadonlyMap<string, TagGroup>): string {
  const lines = ["# Browse by Tag", "", "Select a category to browse tags:", ""];
  for (const category of categories) {
    lines.push(`- [${category.title}](cat-${category.slug}.md)`);
    for (const entry of tagEntries(category, groups)) lines.push(`  - ${entry}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateTagSources(documents: readonly TaggedDocument[]): VirtualSource[] {
  const groups = groupByTag(documents);
  if (groups.size === 0) return [];
  const categories = browseCategories(groups.keys());
  const sources: VirtualSource[] = [];
  for (const [basename, group] of [...groups.entries()].sort((a, b) => compareCodepoints(a[0], b[0]))) {
    sources.push({ relative: `${TAGS_DIRECTORY}/${basename}.md`, raw: tagPage(group.name, group.pages) });
  }
  for (const category of categories) {
    sources.push({ relative: `${TAGS_DIRECTORY}/cat-${category.slug}.md`, raw: categoryPage(category.title, tagEntries(category, groups)) });
  }
  sources.push({ relative: `${TAGS_DIRECTORY}/tagsindex.md`, raw: indexPage(categories, groups) });
  return sources;
}
