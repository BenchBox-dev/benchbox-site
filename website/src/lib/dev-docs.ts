import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEV_DOCS_PREFIX = "/docs/dev/";
const URL_ATTRIBUTE = /(\s(?:href|src|action|srcset|content|poster|data-[\w-]+)\s*=\s*)(["'])([\s\S]*?)\2/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function docsUrl(origin: string): RegExp {
  return new RegExp(`(^|[\\s,=]|${escapeRegExp(origin)})/docs(?:/|(?=$|[?#\\s,]))`, "g");
}

export function rebaseValue(value: string, prefix: string, origin: string): string {
  return value.replace(docsUrl(origin), (match: string, lead: string, offset: number, whole: string) => {
    const url = whole.slice(offset + lead.length);
    if (url.startsWith(prefix) || url === prefix.replace(/\/$/, "")) return match;
    return `${lead}${prefix}`;
  });
}

export function rebaseDocsLinks(html: string, prefix: string, origin: string): string {
  return html.replace(URL_ATTRIBUTE, (_match, attribute: string, quote: string, value: string) => `${attribute}${quote}${rebaseValue(value, prefix, origin)}${quote}`);
}

function htmlFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

export function mountDevDocs(siteDir: string, origin: string): number {
  const docs = path.join(siteDir, "docs");
  const dev = path.join(docs, "dev");
  if (!existsSync(docs)) throw new Error(`docs are missing from ${siteDir}`);
  rmSync(dev, { recursive: true, force: true });
  const staging = mkdtempSync(path.join(os.tmpdir(), "dev-docs-"));
  cpSync(docs, staging, { recursive: true });
  cpSync(staging, dev, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  let changed = 0;
  for (const page of htmlFiles(dev)) {
    const original = readFileSync(page, "utf8");
    const rebased = rebaseDocsLinks(original, DEV_DOCS_PREFIX, origin);
    if (rebased !== original) {
      writeFileSync(page, rebased);
      changed += 1;
    }
  }
  return changed;
}
