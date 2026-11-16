import type { Blockquote, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { ConvertedDocument } from "./document.ts";
import { stemOf } from "./docs-index.ts";
import { STRINGIFY_OPTIONS } from "./serialize.ts";

export const MARKDOWN_DIRECTORY = "markdown";

export type MarkdownRoutes = { origin: string; docRoutes: ReadonlyMap<string, string> };

type Attribute = { name: string; value: string | { value: string } | null };
type JsxElement = { type: "mdxJsxFlowElement"; name: string; attributes: Attribute[]; children: RootContent[] };

const BARE_ANCHOR = /^<span id="[^"<>\s]+"><\/span>$/;
const ANCHOR_OPEN = /^<span id="[^"<>\s]+">$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALERT_KINDS: Readonly<Record<string, string>> = { Note: "NOTE", Tip: "TIP", Important: "IMPORTANT", Warning: "WARNING", Caution: "CAUTION" };
const ISLANDS: ReadonlySet<string> = new Set(["CitedResult", "CurrentResults"]);

const markdownWriter = unified().use(remarkGfm).use(remarkStringify, STRINGIFY_OPTIONS);

export function markdownUrl(origin: string, relative: string): string {
  return `${origin}/docs/${stemOf(relative)}.md`;
}

export function markdownPath(relative: string): string {
  return `${MARKDOWN_DIRECTORY}/docs/${stemOf(relative)}.md`;
}

export function docRoutesOf(documents: readonly ConvertedDocument[]): Map<string, string> {
  return new Map(documents.filter((document) => document.collection === "docs").map((document) => [document.info.route, document.path]));
}

function attribute(element: JsxElement, name: string): string {
  const value = element.attributes.find((entry) => entry.name === name)?.value;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : value.value;
}

function rewriteUrl(url: string, routes: MarkdownRoutes): string {
  if (url.startsWith("#") || SCHEME.test(url) || url.startsWith("//")) return url;
  if (!url.startsWith("/")) return url;
  const hash = url.indexOf("#");
  const route = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? "" : url.slice(hash);
  const page = routes.docRoutes.get(route);
  return page === undefined ? `${routes.origin}${url}` : `${markdownUrl(routes.origin, page)}${fragment}`;
}

function jsx(node: RootContent): JsxElement | undefined {
  return (node as { type: string }).type === "mdxJsxFlowElement" ? (node as unknown as JsxElement) : undefined;
}

function convertNodes(nodes: readonly RootContent[], routes: MarkdownRoutes, htmlUrl: string): RootContent[] {
  return nodes.flatMap((node, index) => {
    const previous = nodes[index - 1];
    if (node.type === "html" && node.value === "</span>" && previous?.type === "html" && ANCHOR_OPEN.test(previous.value)) return [];
    if (node.type === "html" && ANCHOR_OPEN.test(node.value) && nodes[index + 1]?.type === "html" && (nodes[index + 1] as { value: string }).value === "</span>") return [];
    return convertNode(node, routes, htmlUrl);
  });
}

function convertNode(node: RootContent, routes: MarkdownRoutes, htmlUrl: string): RootContent[] {
  const element = jsx(node);
  if (element?.name === "Callout") {
    const kind = ALERT_KINDS[attribute(element, "title")] ?? "NOTE";
    const children = [{ type: "html", value: `[!${kind}]` }, ...convertNodes(element.children, routes, htmlUrl)] as Blockquote["children"];
    return [{ type: "blockquote", children }];
  }
  if (element?.name === "Mermaid") {
    return [{ type: "code", lang: "mermaid", value: JSON.parse(attribute(element, "diagram")) as string }];
  }
  if (element && ISLANDS.has(element.name)) {
    const label = "Interactive results embed; it renders on the HTML version of this page";
    return [{ type: "blockquote", children: [{ type: "paragraph", children: [{ type: "link", url: htmlUrl, children: [{ type: "text", value: label }] }] }] }];
  }
  if (node.type === "html") return BARE_ANCHOR.test(node.value) ? [] : [node];
  if (node.type === "link" || node.type === "definition" || node.type === "image") {
    const rewritten = { ...node, url: rewriteUrl(node.url, routes) } as RootContent;
    return [node.type === "link" ? ({ ...rewritten, children: convertNodes((node as { children: RootContent[] }).children, routes, htmlUrl) } as RootContent) : rewritten];
  }
  if ("children" in node) {
    const children = convertNodes(node.children as RootContent[], routes, htmlUrl);
    return node.type === "paragraph" && children.length === 0 ? [] : [{ ...node, children } as RootContent];
  }
  return [node];
}

function collectLinks(nodes: readonly RootContent[], found: Set<string>, docRoutes: ReadonlyMap<string, string>): void {
  for (const node of nodes) {
    if (node.type === "link" || node.type === "definition") {
      const page = docRoutes.get(node.url.split("#")[0]);
      if (page !== undefined) found.add(page);
    }
    if ("children" in node) collectLinks(node.children as RootContent[], found, docRoutes);
  }
}

export function linkedPages(document: ConvertedDocument, docRoutes: ReadonlyMap<string, string>): string[] {
  const found = new Set<string>();
  collectLinks(document.root.children, found, docRoutes);
  found.delete(document.path);
  return [...found].sort();
}

export function exportMarkdown(document: ConvertedDocument, routes: MarkdownRoutes): string {
  const htmlUrl = `${routes.origin}${document.info.route}`;
  const heading: RootContent = { type: "heading", depth: 1, children: [{ type: "text", value: document.info.title }] };
  const root: Root = { type: "root", children: [heading, ...convertNodes(document.root.children, routes, htmlUrl)] };
  return markdownWriter.stringify(root);
}
