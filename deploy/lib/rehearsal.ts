import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "../gates/files.ts";

export const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
export const REHEARSAL_ROBOTS = "User-agent: *\nDisallow: /\n";

export function addNoindex(html: string): string {
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return html;
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}${NOINDEX}${html.slice(at)}`;
}

export function markRehearsal(siteDir: string): number {
  let pages = 0;
  for (const file of filesUnder(siteDir).filter((name) => name.endsWith(".html"))) {
    const target = path.join(siteDir, file);
    const before = readFileSync(target, "utf8");
    const after = addNoindex(before);
    if (after !== before) {
      writeFileSync(target, after);
      pages += 1;
    }
  }
  writeFileSync(path.join(siteDir, "robots.txt"), REHEARSAL_ROBOTS);
  return pages;
}
