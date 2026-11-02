import { cloneTitle } from "../lib/smartypants.ts";
import { readFileSync } from "node:fs";
import { UnresolvedReferenceError } from "./errors.ts";
import type { Collection, DocInfo, ResolvedDoc, SourcePosition } from "./model.ts";
import type { DocSourceFile } from "./sources.ts";

export function stemOf(relative: string): string {
  return relative.replace(/\.(md|rst)$/, "");
}

export function collectionOf(relative: string): Collection {
  return relative.startsWith("blog/") ? "blog" : "docs";
}

export function routeFor(relative: string): string {
  const stem = stemOf(relative);
  return collectionOf(relative) === "blog" ? `/${stem}.html` : `/docs/${stem}.html`;
}

export function contentIdFor(relative: string): string {
  const stem = stemOf(relative);
  return collectionOf(relative) === "blog" ? stem : `docs/${stem}`;
}

export function placeholderInfo(source: { relative: string }): DocInfo {
  return {
    path: source.relative,
    route: routeFor(source.relative),
    title: stemOf(source.relative).split("/").pop() ?? source.relative,
    titleNodes: [{ type: "text", value: stemOf(source.relative).split("/").pop() ?? source.relative }],
    collection: collectionOf(source.relative),
    ids: [],
    tags: [],
    images: [],
  };
}

export class DocsIndex {
  private readonly docs = new Map<string, DocInfo>();

  constructor(infos: Iterable<DocInfo>) {
    for (const info of infos) this.docs.set(info.path, info);
  }

  paths(): string[] {
    return [...this.docs.keys()].sort();
  }

  get(path: string): DocInfo | undefined {
    return this.docs.get(path);
  }

  findDoc(from: string, target: string): ResolvedDoc | undefined {
    const stem = this.stemFor(from, target);
    if (stem === undefined) return undefined;
    for (const candidate of [`${stem}.md`]) {
      const info = this.docs.get(candidate);
      if (info) return { path: info.path, route: info.route, title: info.title, titleNodes: cloneTitle(info.titleNodes) };
    }
    return undefined;
  }

  private stemFor(from: string, target: string): string | undefined {
    const cleaned = target.replace(/\.(md|rst)$/, "");
    const segments = cleaned.startsWith("/") ? cleaned.slice(1).split("/") : [...from.split("/").slice(0, -1), ...cleaned.split("/")];
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === "..") {
        if (resolved.pop() === undefined) return undefined;
      } else if (segment !== "." && segment !== "") resolved.push(segment);
    }
    return resolved.join("/");
  }

  resolveDoc(from: string, target: string, at: SourcePosition, kind = "doc"): ResolvedDoc {
    const found = this.findDoc(from, target);
    if (found) return found;
    const stem = this.stemFor(from, target);
    const detail = stem === undefined ? "points outside docs/" : `does not match a document under docs/ (looked for ${stem}.md)`;
    throw new UnresolvedReferenceError(at.file, at.line, `${kind}:${target}`, detail);
  }
}
