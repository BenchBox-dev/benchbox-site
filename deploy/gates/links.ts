import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "parse5";
import { filesUnder } from "./files.ts";
import { fail, pass, type GateResult } from "./types.ts";

export type BrokenLink = [source: string, target: string, reason: "missing path" | "missing fragment"];
type Element = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Element[] };

const CHROME = new Set(["nav", "header", "footer", "aside"]);
const BASE_HOSTS = ["benchbox.dev", "www.benchbox.dev"];
const SPA_MARKER = "benchbox.results.redirect";

export function pageUrl(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

export function internalTarget(href: string, page: string, hosts: string[]): { path: string; fragment: string } | null {
  let url: URL;
  try {
    url = new URL(href, `https://benchbox.dev${page}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || !hosts.includes(url.hostname)) return null;
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return { path: decode(url.pathname) || "/", fragment: decode(url.hash.replace(/^#/, "")) };
}

function attribute(node: Element, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function isChrome(node: Element): boolean {
  if (!CHROME.has(node.nodeName)) return false;
  return !(node.nodeName === "aside" && (attribute(node, "class") ?? "").split(/\s+/).includes("starlight-aside"));
}

export function scanPage(html: string): { ids: Set<string>; links: { href: string; chrome: boolean }[]; images: string[] } {
  const ids = new Set<string>();
  const links: { href: string; chrome: boolean }[] = [];
  const images: string[] = [];
  const visit = (node: Element, chrome: boolean) => {
    const inChrome = chrome || isChrome(node);
    const id = attribute(node, "id");
    if (id) ids.add(id);
    if (node.nodeName === "a") {
      const name = attribute(node, "name");
      if (name) ids.add(name);
      const href = attribute(node, "href");
      if (href) links.push({ href, chrome: inChrome });
    }
    if (node.nodeName === "img") {
      const src = attribute(node, "src");
      if (src) images.push(src);
    }
    for (const child of node.childNodes ?? []) visit(child, inChrome);
    const content = (node as { content?: Element }).content;
    if (content) visit(content, inChrome);
  };
  visit(parse(html) as unknown as Element, false);
  return { ids, links, images };
}

export function feedLinks(xml: string): string[] {
  return [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].flatMap((entry) =>
    [...entry[0].matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&")),
  );
}

export function routedAllowance(entries: BrokenLink[]): BrokenLink[] {
  const routed = (value: string) => (value.startsWith("/docs/") && !value.startsWith("/docs/dev/") ? `/docs/dev/${value.slice("/docs/".length)}` : value);
  const extra = entries.map(([source, target, reason]) => [routed(source), routed(target), reason] as BrokenLink);
  const seen = new Set<string>();
  return [...entries, ...extra].filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findBrokenLinks(siteDir: string, extraHosts: string[] = []): { broken: BrokenLink[]; missingImages: string[] } {
  const hosts = [...BASE_HOSTS, ...extraHosts];
  const files = filesUnder(siteDir);
  const served = new Set(files.map((file) => `/${file}`));
  const spa = existsSync(path.join(siteDir, "404.html")) && readFileSync(path.join(siteDir, "404.html"), "utf8").includes(SPA_MARKER);
  const idsByFile = new Map<string, Set<string>>();
  const sources: { page: string; links: { href: string; chrome: boolean }[]; images: string[] }[] = [];
  for (const file of files) {
    if (file.endsWith(".html")) {
      const scanned = scanPage(readFileSync(path.join(siteDir, file), "utf8"));
      idsByFile.set(`/${file}`, scanned.ids);
      sources.push({ page: pageUrl(file), links: scanned.links, images: scanned.images });
    } else if (file.endsWith("atom.xml")) {
      sources.push({ page: `/${file}`, links: feedLinks(readFileSync(path.join(siteDir, file), "utf8")).map((href) => ({ href, chrome: false })), images: [] });
    }
  }
  const resolve = (target: string): string | null => {
    const candidates = target.endsWith("/") ? [target, `${target}index.html`] : [target, `${target}.html`, `${target}/index.html`];
    return candidates.find((candidate) => served.has(candidate) && statSync(path.join(siteDir, candidate.slice(1))).isFile()) ?? null;
  };
  const broken = new Map<string, BrokenLink>();
  const missingImages = new Set<string>();
  for (const source of sources) {
    for (const link of source.links) {
      const target = internalTarget(link.href, source.page, hosts);
      if (!target) continue;
      const origin = link.chrome ? "(site chrome)" : source.page;
      const resolved = resolve(target.path);
      if (!resolved) {
        if (spa && target.path.startsWith("/results/")) continue;
        const entry: BrokenLink = [origin, target.path, "missing path"];
        broken.set(JSON.stringify(entry), entry);
        continue;
      }
      if (target.fragment && target.fragment !== "top" && resolved.endsWith(".html") && !idsByFile.get(resolved)?.has(target.fragment)) {
        const entry: BrokenLink = [origin, `${target.path}#${target.fragment}`, "missing fragment"];
        broken.set(JSON.stringify(entry), entry);
      }
    }
    for (const src of source.images) {
      const target = internalTarget(src, source.page, hosts);
      if (target && !resolve(target.path)) missingImages.add(`${source.page} -> ${target.path}`);
    }
  }
  return { broken: [...broken.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), missingImages: [...missingImages].sort() };
}

export function linksGate(input: { siteDir: string; allowance: BrokenLink[]; extraHosts?: string[] }): GateResult {
  const { broken, missingImages } = findBrokenLinks(input.siteDir, input.extraHosts);
  const routed = routedAllowance(input.allowance);
  const allowed = new Set(routed.map((entry) => JSON.stringify(entry)));
  const unexpected = broken.filter((entry) => !allowed.has(JSON.stringify(entry))).map((entry) => entry.join(" -> "));
  const findings = [...unexpected.map((line) => `broken internal link: ${line}`), ...missingImages.map((line) => `missing image: ${line}`)];
  if (findings.length > 0) return fail(`${unexpected.length} new broken links and ${missingImages.length} missing images`, findings);
  return pass(`${broken.length} broken links, all within the allowance of ${routed.length} (${input.allowance.length} entries and their /docs/dev/ copies)`);
}
