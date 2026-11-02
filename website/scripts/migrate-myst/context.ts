import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSite, loadKnownBrokenLinks } from "../../src/converter/build.ts";
import { DocsIndex } from "../../src/converter/docs-index.ts";
import type { DocInfo, LabelInfo } from "../../src/converter/model.ts";
import { parseMarkdown } from "../../src/converter/parse.ts";
import type { SidebarManifest } from "../../src/converter/sidebar.ts";
import { listDocSources } from "../../src/converter/sources.ts";
import { plainText } from "../../src/converter/text.ts";
import { docutilsMakeId } from "../../src/lib/docutils-slug.ts";
import { assembleDocsSource, repoPath } from "../../src/lib/site-inputs.ts";

export type Heading = { line: number; level: number; text: string; slug: string };

export type LabelSite = { label: string; id: string; heading?: Heading; firstHeading: boolean; uniqueSlug: boolean };

export type Snapshot = { sidebar: string; tags: string; ids: Record<string, string[]> };

export type Context = {
  docsRoot: string;
  index: DocsIndex;
  infos: Map<string, DocInfo>;
  sources: Map<string, string>;
  sidebar: SidebarManifest;
  snapshot: Snapshot;
  labelOwners: Map<string, { path: string; info: LabelInfo }>;
  labelSites: Map<string, Map<string, LabelSite>>;
  headings: Map<string, Heading[]>;
};

const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const LABEL_LINE = /^\(([^)\s][^)]*)\)=\s*$/;
const MARKER_LINE = /^(\(([^)\s][^)]*)\)=|\{#[^\s#.=]+\}|%.*)\s*$/;

export function splitFrontMatter(raw: string): { front: string[] | undefined; body: string[] } {
  const lines = raw.split("\n");
  if (lines[0] !== "---") return { front: undefined, body: lines };
  const close = lines.findIndex((line, index) => index > 0 && line === "---");
  if (close < 0) return { front: undefined, body: lines };
  return { front: lines.slice(1, close), body: lines.slice(close + 1) };
}

export function slugOf(headingText: string): string {
  const tree = parseMarkdown(`# ${headingText}\n`);
  const heading = tree.children[0];
  return heading?.type === "heading" ? docutilsMakeId(plainText(heading)) : "";
}

export function headingsOf(body: readonly string[]): Heading[] {
  const found: Heading[] = [];
  let fence: string | undefined;
  body.forEach((line, index) => {
    const opening = FENCE.exec(line);
    if (opening) {
      if (fence === undefined) fence = opening[1];
      else if (opening[1][0] === fence[0] && opening[1].length >= fence.length && line.trim() === opening[1]) fence = undefined;
      return;
    }
    if (fence !== undefined) return;
    const heading = ATX.exec(line);
    if (heading) found.push({ line: index, level: heading[1].length, text: heading[2], slug: slugOf(heading[2]) });
  });
  return found;
}

function labelSitesOf(body: readonly string[], headings: readonly Heading[], info: DocInfo): Map<string, LabelSite> {
  const sites = new Map<string, LabelSite>();
  body.forEach((line, index) => {
    const label = LABEL_LINE.exec(line);
    if (!label) return;
    let next = index + 1;
    while (next < body.length && (body[next].trim() === "" || MARKER_LINE.test(body[next]))) next += 1;
    const heading = headings.find((candidate) => candidate.line === next);
    const id = info.labels.get(label[1])?.id ?? "";
    sites.set(label[1], {
      label: label[1],
      id,
      heading,
      firstHeading: heading !== undefined && headings[0] === heading,
      uniqueSlug: heading !== undefined && heading.slug !== "" && headings.filter((candidate) => candidate.slug === heading.slug).length === 1,
    });
  });
  return sites;
}

export function buildContext(): Context {
  const docsRoot = assembleDocsSource(mkdtempSync(path.join(os.tmpdir(), "benchbox-migrate-")));
  const result = buildSite({ docsRoot, knownBrokenLinks: loadKnownBrokenLinks(repoPath("inventory", "known-broken-links.json")) });
  if (result.errors.length > 0) throw new Error(`the current content does not convert:\n${result.errors.map((error) => error.message).join("\n")}`);
  const infos = new Map(result.infos.map((info) => [info.path, info]));
  const sources = new Map(listDocSources(docsRoot).map((source) => [source.relative, readFileSync(source.absolute, "utf-8")]));
  const sidebarText = result.files.get("manifest/sidebar.json") as string;
  const labelOwners = new Map<string, { path: string; info: LabelInfo }>();
  const headings = new Map<string, Heading[]>();
  const labelSites = new Map<string, Map<string, LabelSite>>();
  for (const info of result.infos) for (const [name, label] of info.labels) labelOwners.set(name, { path: info.path, info: label });
  for (const [relative, raw] of sources) {
    const info = infos.get(relative) as DocInfo;
    const { body } = splitFrontMatter(raw);
    const found = headingsOf(body);
    headings.set(relative, found);
    labelSites.set(relative, labelSitesOf(body, found, info));
  }
  return {
    docsRoot,
    index: new DocsIndex(result.infos),
    infos,
    sources,
    sidebar: JSON.parse(sidebarText) as SidebarManifest,
    snapshot: {
      sidebar: sidebarText,
      tags: result.files.get("manifest/tags.json") as string,
      ids: Object.fromEntries(result.infos.map((info) => [info.path, info.ids])),
    },
    labelOwners,
    labelSites,
    headings,
  };
}

export function snapshotOf(): Snapshot {
  return buildContext().snapshot;
}

export { MARKER_LINE, LABEL_LINE, FENCE };
