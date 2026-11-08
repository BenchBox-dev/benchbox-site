import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export const NEUTRAL_PLACEHOLDERS = new Set(["/data", "/output"]);

const PATH_TAIL = String.raw`[^\s'",;)]*`;
const PATH_BOUNDARY = String.raw`(?=[/\\\s'",;)\]}]|$)`;
const LOCAL_ROOTS = "~|/Users|/home|/root|/private|/var/folders|/var/run|/Volumes|/tmp|/mnt|/opt";

export const PRIVATE_LOCAL_PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9_])(?:(?:${LOCAL_ROOTS})/${PATH_TAIL}|[A-Za-z]:\\${PATH_TAIL}|[A-Za-z]:/(?!/)${PATH_TAIL})` +
    String.raw`|(?<![A-Za-z0-9_\\])\\{2,}[A-Za-z0-9_.$-]+\\+${PATH_TAIL}` +
    String.raw`|(?<![A-Za-z0-9_:/\\])//[A-Za-z0-9_.$-]+/[A-Za-z0-9_.$-]+${PATH_TAIL}`,
  "gi",
);

export function isNeutralPlaceholder(text: string): boolean {
  return NEUTRAL_PLACEHOLDERS.has(text.replace(/[/\\]+$/, ""));
}

function isAbsoluteRoot(text: string): boolean {
  return text.startsWith("/") || text.startsWith("\\") || text.slice(1, 3) === ":\\" || text.slice(1, 3) === ":/";
}

function rootVariants(root: string): Set<string> {
  let text = root.replace(/[/\\]+$/, "");
  if (!text) return new Set();
  if (!isAbsoluteRoot(text)) text = path.resolve(text).replace(/[/\\]+$/, "");
  if (text.length <= 1 || !isAbsoluteRoot(text) || isNeutralPlaceholder(text)) return new Set();
  const variants = new Set([text, text.replaceAll("\\", "/")]);
  if (existsSync(text)) {
    const resolved = realpathSync(text).replace(/[/\\]+$/, "");
    variants.add(resolved);
    variants.add(resolved.replaceAll("\\", "/"));
  }
  return new Set([...variants].filter((variant) => variant.length > 1 && !isNeutralPlaceholder(variant)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rootAlternatives(variants: Iterable<string>): string[] {
  const alternatives: string[] = [];
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    alternatives.push(String.raw`(?<![A-Za-z0-9_])${escapeRegExp(variant)}`);
    if (variant.startsWith("/") && variant.replace(/^\/+|\/+$/g, "").split("/").length >= 2) {
      alternatives.push(String.raw`(?<![A-Za-z0-9_/.])${escapeRegExp(variant.slice(1))}`);
    }
  }
  return alternatives;
}

export function localPathMatcher(roots: Iterable<string> = []): (text: string) => boolean {
  const variants = new Set<string>();
  for (const root of roots) for (const variant of rootVariants(root)) variants.add(variant);
  const configured = variants.size > 0 ? new RegExp(`(?:${rootAlternatives(variants).join("|")})${PATH_BOUNDARY}`, "i") : null;
  return (text) => {
    if (configured?.test(text)) return true;
    return [...text.matchAll(PRIVATE_LOCAL_PATH)].some((match) => !isNeutralPlaceholder(match[0]));
  };
}

export function findPathLeaks(value: unknown, roots: Iterable<string> = []): string[] {
  const contains = localPathMatcher(roots);
  const leaks = new Set<string>();
  const visit = (node: unknown, trail: string[]): void => {
    if (typeof node === "string") {
      if (contains(node)) leaks.add(trail.join(".") || "<root>");
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, [...trail, String(index)]));
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        let label = key;
        if (contains(key)) {
          label = "<key>";
          leaks.add([...trail, label].join("."));
        }
        visit(child, [...trail, label]);
      }
    }
  };
  visit(value, []);
  return [...leaks];
}
