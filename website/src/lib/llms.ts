import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { inGeneratedScope } from "./docs-generators/generate.ts";
import type { SidebarItem, SidebarManifest } from "../converter/sidebar.ts";

export type LlmsPage = { path: string; route: string; title: string; description?: string; links: readonly string[] };

export type FeaturedSection = { heading: string; blurb: string; pages: readonly string[]; urls?: readonly { label: string; path: string; description: string }[] };

export const FEATURED_SECTIONS: readonly FeaturedSection[] = [
  { heading: "Install and first run", blurb: "Install BenchBox, then run the first benchmark.", pages: ["usage/installation.md", "usage/getting-started.md"] },
  { heading: "CLI reference", blurb: "Every `benchbox` command and option.", pages: ["reference/cli/index.md", "reference/cli/run.md"] },
  { heading: "MCP reference", blurb: "The `benchbox-mcp` server for agents.", pages: ["reference/mcp.md", "guides/mcp-integration.md"] },
  { heading: "Methodology", blurb: "How BenchBox measures and what its results mean.", pages: ["concepts/benchmark-methodology.md"] },
  {
    heading: "Result summaries",
    blurb: "Published results, rendered as static HTML pages.",
    pages: [],
    urls: [
      { label: "Result summaries", path: "/result-summaries/", description: "Index of result summaries (HTML only)" },
      { label: "Result summaries by benchmark", path: "/result-summaries/benchmarks", description: "One page per benchmark (HTML only)" },
      { label: "Result summaries by platform", path: "/result-summaries/platforms", description: "One page per platform (HTML only)" },
    ],
  },
];

export const OPTIONAL_HEADING = "Optional";
export const TAG_DIRECTORY = "_tags/";

export class LlmsError extends Error {
  constructor(problems: readonly string[]) {
    super(`llms.txt cannot be generated:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "LlmsError";
  }
}

function escapeLabel(label: string): string {
  return label.replace(/([[\]\\])/g, "\\$1");
}

function entry(label: string, url: string, description: string | undefined): string {
  return `- [${escapeLabel(label)}](${url})${description ? `: ${description.replace(/\s+/g, " ").trim()}` : ""}`;
}

function flatten(items: readonly SidebarItem[]): SidebarItem[] {
  return items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
}

export type LlmsInput = {
  origin: string;
  summary: string;
  sidebar: SidebarManifest;
  pages: readonly LlmsPage[];
  markdownUrl: (relative: string) => string;
};

export function renderLlms(input: LlmsInput): string {
  const byPath = new Map(input.pages.map((page) => [page.path, page]));
  const byRoute = new Map(input.pages.map((page) => [page.route, page]));
  const listed = new Set<string>();
  const sections: string[] = [];
  const problems: string[] = [];

  const line = (page: LlmsPage, label = page.title): string => entry(label, input.markdownUrl(page.path), page.description);

  for (const section of FEATURED_SECTIONS) {
    const lines: string[] = [];
    for (const relative of section.pages) {
      const page = byPath.get(relative);
      if (page === undefined) {
        problems.push(`${section.heading}: ${relative} is not a documentation page`);
        continue;
      }
      listed.add(relative);
      lines.push(line(page));
    }
    for (const link of section.urls ?? []) lines.push(entry(link.label, `${input.origin}${link.path}`, link.description));
    sections.push(`## ${section.heading}\n\n${section.blurb}\n\n${lines.join("\n")}`);
  }

  for (const group of input.sidebar.groups) {
    const lines: string[] = [];
    for (const item of flatten(group.items)) {
      const page = byRoute.get(item.link);
      if (page === undefined || listed.has(page.path) || page.path.startsWith(TAG_DIRECTORY)) continue;
      listed.add(page.path);
      lines.push(line(page, item.label));
    }
    if (lines.length > 0) sections.push(`## ${group.label}\n\n${lines.join("\n")}`);
  }

  const reached = new Set(listed);
  const queue = [...listed];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const target of byPath.get(next)?.links ?? []) {
      if (reached.has(target) || !inGeneratedScope(target) || !byPath.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }

  const rest = input.pages.filter((page) => !reached.has(page.path) && !page.path.startsWith(TAG_DIRECTORY)).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (rest.length > 0) sections.push(`## ${OPTIONAL_HEADING}\n\nPages that docs/nav.yml does not list and that no listed generated index links to.\n\n${rest.map((page) => line(page)).join("\n")}`);

  if (problems.length > 0) throw new LlmsError(problems);

  const preface = [
    "# BenchBox",
    `> ${input.summary}`,
    `Every documentation page is also served as Markdown. Replace the \`.html\` suffix of a page URL with \`.md\`: ${input.origin}/docs/usage/installation.html has a Markdown version at ${input.origin}/docs/usage/installation.md. Links inside the Markdown pages point at other Markdown pages. Result summaries, search and the Results Explorer exist as HTML only.`,
  ];
  return `${[...preface, ...sections].join("\n\n")}\n`;
}

const LINK = /\]\(([^)\s]+)\)/g;

export function linksIn(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[1]);
}

function servedFile(distDir: string, pathname: string): string | undefined {
  const decoded = decodeURI(pathname);
  const candidates = decoded.endsWith("/") ? [`${decoded}index.html`] : /\.[a-z0-9]+$/i.test(decoded) ? [decoded] : [decoded, `${decoded}.html`, `${decoded}/index.html`];
  return candidates.find((candidate) => {
    const file = path.join(distDir, candidate);
    return file.startsWith(distDir) && existsSync(file) && statSync(file).isFile();
  });
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entryInfo) => {
    const full = path.join(directory, entryInfo.name);
    if (entryInfo.isDirectory()) return entryInfo.name === "dev" && directory.endsWith(`${path.sep}docs`) ? [] : markdownFiles(full);
    return entryInfo.name.endsWith(".md") ? [full] : [];
  });
}

function deadLinks(distDir: string, origin: string, source: string, text: string): string[] {
  const problems: string[] = [];
  for (const link of linksIn(text)) {
    if (link.startsWith("#")) continue;
    let url: URL;
    try {
      url = new URL(link, `${origin}/`);
    } catch {
      problems.push(`${source}: ${link} is not a URL`);
      continue;
    }
    if (url.origin !== origin) {
      if (source === "llms.txt") problems.push(`llms.txt: ${link} is not on ${origin}`);
      continue;
    }
    if (servedFile(distDir, url.pathname) === undefined) problems.push(`${source}: ${link} does not resolve to a file in the built site`);
  }
  return problems;
}

export function checkPublishedLlms(distDir: string, origin: string): string[] {
  const llms = path.join(distDir, "llms.txt");
  if (!existsSync(llms)) return ["llms.txt is missing from the built site"];
  const text = readFileSync(llms, "utf-8");
  const problems = text.startsWith("# ") ? [] : ["llms.txt does not start with an H1 title"];
  problems.push(...deadLinks(distDir, origin, "llms.txt", text));
  if (linksIn(text).length === 0) problems.push("llms.txt links to nothing");
  const docs = path.join(distDir, "docs");
  for (const file of existsSync(docs) ? markdownFiles(docs) : []) {
    problems.push(...deadLinks(distDir, origin, path.relative(distDir, file).split(path.sep).join("/"), readFileSync(file, "utf-8")));
  }
  return problems;
}
