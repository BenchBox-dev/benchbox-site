import { buildSite } from "../converter/build.ts";
import { ConversionFailedError } from "../converter/errors.ts";
import { createDefaultRegistry } from "../converter/handlers/index.ts";
import { linkSyntax } from "../converter/handlers/links.ts";
import type { SyntaxHandler } from "../converter/types.ts";
import { REPOSITORY_URL, repoFilesFor } from "./repo-files.ts";

export type CoreLinkedPath = { path: string; kind: "file" | "directory"; sources: string[] };

export type CoreLinkedPaths = { paths: CoreLinkedPath[] };

export type CoreLinkedPathsOptions = {
  docsRoot: string;
  sourceOf: (file: string) => string | undefined;
  knownBrokenLinks?: ReadonlySet<string>;
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const REPOSITORY_TARGET = new RegExp(`^${REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:blob|tree)/[^/]+/([^#]+)`);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: string, right: string): number {
  const [leftFile, leftLine] = [left.slice(0, left.lastIndexOf(":")), Number(left.slice(left.lastIndexOf(":") + 1))];
  const [rightFile, rightLine] = [right.slice(0, right.lastIndexOf(":")), Number(right.slice(right.lastIndexOf(":") + 1))];
  return compare(leftFile, rightFile) || leftLine - rightLine;
}

export function collectCoreLinkedPaths(options: CoreLinkedPathsOptions): CoreLinkedPaths {
  const repoFiles = repoFilesFor(options.docsRoot);
  if (repoFiles === undefined) throw new Error(`repo-files.json is missing beside ${options.docsRoot}`);
  const found = new Map<string, Set<string>>();
  const recording: SyntaxHandler<"link"> = {
    ...linkSyntax,
    handle(node, at, context) {
      const authored = node.url;
      const result = linkSyntax.handle(node, at, context);
      const source = options.sourceOf(at.file);
      if (context.pass !== "emit" || source === undefined || SCHEME.test(authored)) return result;
      const target = REPOSITORY_TARGET.exec(node.url)?.[1];
      if (target === undefined || !repoFiles.kinds.has(target)) return result;
      const sources = found.get(target) ?? new Set<string>();
      sources.add(`${source}:${at.line}`);
      found.set(target, sources);
      return result;
    },
  };
  const registry = createDefaultRegistry().register(recording);
  const result = buildSite({ docsRoot: options.docsRoot, registry, knownBrokenLinks: options.knownBrokenLinks });
  if (result.errors.length > 0) throw new ConversionFailedError(result.errors);
  const paths = [...found.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([target, sources]) => ({
      path: target,
      kind: repoFiles.kinds.get(target) === "tree" ? ("directory" as const) : ("file" as const),
      sources: [...sources].sort(compareSources),
    }));
  return { paths };
}

export function formatCoreLinkedPaths(inventory: CoreLinkedPaths): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function isFresh(committed: string, inventory: CoreLinkedPaths): boolean {
  return committed === formatCoreLinkedPaths(inventory);
}
