import { statSync, type Stats } from "node:fs";
import path from "node:path";
import { REPOSITORY_URL, repoFilesFor } from "../../lib/repo-files.ts";
import { routeFor } from "../docs-index.ts";
import { UnresolvedReferenceError } from "../errors.ts";
import type { Link, PhrasingContent } from "mdast";
import type { SourcePosition } from "../model.ts";
import type { ConvertContext, SyntaxHandler } from "../types.ts";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DOC_SUFFIX = /\.(md|rst)$/;
const FALLBACK_REF = "develop";

function repositoryRef(docsRoot: string): string {
  return repoFilesFor(docsRoot)?.coreSha ?? FALLBACK_REF;
}

function decode(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function statOf(absolute: string): Stats | undefined {
  try {
    return statSync(absolute);
  } catch {
    return undefined;
  }
}

function withFragment(url: string, fragment: string): string {
  return fragment === "" ? url : `${url}#${fragment}`;
}

function repositoryKind(relative: string, absolute: string, docsRoot: string): "file" | "tree" | undefined {
  if (relative === "") return "tree";
  const repoFiles = repoFilesFor(docsRoot);
  if (repoFiles) return repoFiles.kinds.get(relative);
  const stats = statOf(absolute);
  if (stats === undefined) return undefined;
  return stats.isDirectory() ? "tree" : "file";
}

function repositoryTarget(absolute: string, docsRoot: string, fragment: string, unresolved: (detail: string) => UnresolvedReferenceError): string {
  const relative = path.relative(path.dirname(docsRoot), absolute).split(path.sep).join("/");
  const kind = relative.startsWith("..") ? undefined : repositoryKind(relative, absolute, docsRoot);
  if (kind === undefined) throw unresolved("does not match a file in the repository");
  const ref = repositoryRef(docsRoot);
  return withFragment(relative === "" ? `${REPOSITORY_URL}/tree/${ref}` : `${REPOSITORY_URL}/${kind === "tree" ? "tree" : "blob"}/${ref}/${relative}`, fragment);
}

export const BLOG_PAGES: Readonly<Record<string, string>> = {
  "blog/archive.html": "/blog/archive.html",
  "blog/tag.html": "/blog/tag.html",
  "blog/author.html": "/blog/author.html",
};

type Resolution = { url: string };

function resolveTarget(target: string, context: ConvertContext, at: SourcePosition, fragment: string): Resolution {
  const unresolved = (detail: string): UnresolvedReferenceError => new UnresolvedReferenceError(at.file, at.line, `link:${withFragment(target, fragment)}`, detail);
  const absolute = target.startsWith("/") ? path.join(context.docsRoot, target) : path.resolve(context.docsRoot, path.dirname(context.file), target);
  const insideDocs = path.relative(context.docsRoot, absolute);
  if (insideDocs.startsWith("..") || path.isAbsolute(insideDocs)) {
    return { url: repositoryTarget(absolute, context.docsRoot, fragment, unresolved) };
  }
  const relative = insideDocs.split(path.sep).join("/");
  if (Object.hasOwn(BLOG_PAGES, relative)) {
    if (fragment !== "") throw unresolved(`${relative} has no anchors`);
    return { url: BLOG_PAGES[relative] };
  }
  if (DOC_SUFFIX.test(target)) {
    const resolved = context.resolveDoc(target, at, "link");
    if (fragment !== "") context.checkFragment(resolved.path, fragment, at);
    return { url: withFragment(resolved.route, fragment) };
  }
  const doc = context.findDoc(target);
  if (doc) {
    if (fragment !== "") throw unresolved("names a document without its .md suffix; link to the .md file");
    return { url: doc.route };
  }
  const stats = statOf(absolute);
  if (stats?.isFile()) return { url: repositoryTarget(absolute, context.docsRoot, fragment, unresolved) };
  const index = stats?.isDirectory() ? context.findDoc(`${target.replace(/\/+$/, "")}/index`) : undefined;
  if (index && fragment === "") return { url: index.route };
  throw unresolved("does not match a document or file under docs/");
}

function isEmpty(node: Link): boolean {
  return node.children.every((child) => child.type === "text" && child.value.trim() === "");
}

function noText(node: Link, at: SourcePosition): UnresolvedReferenceError {
  return new UnresolvedReferenceError(at.file, at.line, `link:${node.url}`, "has no link text; write the text");
}

export const linkSyntax: SyntaxHandler<"link"> = {
  kind: "syntax",
  name: "link",
  handle(node, at, context) {
    const link = node.type === "link" ? node : undefined;
    if (link && isEmpty(link)) throw noText(link, at);
    if (SCHEME.test(node.url)) return [node];
    const hash = node.url.indexOf("#");
    const target = hash < 0 ? node.url : node.url.slice(0, hash);
    const fragment = hash < 0 ? "" : node.url.slice(hash + 1);
    if (target === "") {
      context.checkFragment(context.file, fragment, at);
      return [node];
    }
    if (context.pass === "collect") return [node];
    try {
      node.url = resolveTarget(decode(target), context, at, fragment).url;
    } catch (error) {
      if (!(error instanceof UnresolvedReferenceError) || !context.knownBroken(`${routeFor(context.file)}#${node.url}`)) throw error;
    }
    return [node];
  },
};
