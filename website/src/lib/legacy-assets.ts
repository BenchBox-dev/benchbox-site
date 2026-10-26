import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { REPOSITORY_URL } from "./repo-files.ts";

export type LegacyFiles = { images: string[] };

export type LegacyDownload = { source: string; path: string; core_sha?: string; notice?: string };
export type LegacyDownloads = { core_sha: string; downloads: LegacyDownload[] };
export type LegacyRedirect = { url: string; target: string; notice?: string };

export const TPC_NOTICE_NAME = "TPC_EULA.txt";

export function downloadUrlPath(relative: string): string {
  const digest = createHash("md5").update(relative).digest("hex");
  return `/docs/_downloads/${digest}/${path.posix.basename(relative)}`;
}

export function imageUrlPath(name: string): string {
  return `/docs/_images/${name}`;
}

export function publishLegacyImages(files: LegacyFiles, docsRoot: string, out: string): number {
  for (const name of files.images) {
    const from = path.join(docsRoot, "blog", "images", name);
    if (!existsSync(from)) throw new Error(`legacy public file is missing: ${from}`);
    const target = path.join(out, imageUrlPath(name));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(from, target);
  }
  return files.images.length;
}

export function loadLegacyDownloads(file: string): LegacyDownloads {
  return JSON.parse(readFileSync(file, "utf-8")) as LegacyDownloads;
}

export function repositoryBlobUrl(coreSha: string, repositoryPath: string): string {
  return `${REPOSITORY_URL}/blob/${coreSha}/${repositoryPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function legacyRedirects(inventory: LegacyDownloads): LegacyRedirect[] {
  const redirects = new Map<string, LegacyRedirect>();
  for (const download of inventory.downloads) {
    const url = downloadUrlPath(download.source);
    const coreSha = download.core_sha ?? inventory.core_sha;
    const notice = download.notice === undefined ? undefined : repositoryBlobUrl(inventory.core_sha, download.notice);
    redirects.set(url, { url, target: repositoryBlobUrl(coreSha, download.path), ...(notice === undefined ? {} : { notice }) });
    if (notice !== undefined) {
      const sidecar = `${path.posix.dirname(url)}/${TPC_NOTICE_NAME}`;
      redirects.set(sidecar, { url: sidecar, target: notice });
    }
  }
  return [...redirects.values()].sort((left, right) => (left.url < right.url ? -1 : 1));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderRedirectPage(redirect: Pick<LegacyRedirect, "target" | "notice">): string {
  const target = escapeAttribute(redirect.target);
  const notice =
    redirect.notice === undefined
      ? []
      : [`    <p>This is a TPC query template. Its use is governed by the <a href="${escapeAttribute(redirect.notice)}">TPC End User License Agreement</a>.</p>`];
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    "    <title>This page has moved</title>",
    '    <meta name="robots" content="noindex">',
    `    <link rel="canonical" href="${target}">`,
    `    <meta http-equiv="refresh" content="0; url=${target}">`,
    "  </head>",
    "  <body>",
    `    <p>This page has moved. <a href="${target}">Continue to the new page</a>.</p>`,
    ...notice,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

export function publishLegacyRedirects(redirects: readonly LegacyRedirect[], out: string): number {
  for (const redirect of redirects) {
    const target = path.join(out, redirect.url, "index.html");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, renderRedirectPage(redirect));
  }
  return redirects.length;
}

export const REDIRECT_PAGES: Readonly<Record<string, string>> = {
  "docs/genindex.html": "/docs/api.html",
  "docs/search.html": "/docs/",
  "docs/blog.html": "/blog/",
};

export type InventoryEntry = { name: string; role: "doc" | "label"; uri: string; title: string };

export function renderObjectsInventory(entries: readonly InventoryEntry[], project: string, version: string): Buffer {
  const header = `# Sphinx inventory version 2\n# Project: ${project}\n# Version: ${version}\n# The remainder of this file is compressed using zlib.\n`;
  const lines = entries.map((entry) => `${entry.name} std:${entry.role} -1 ${entry.uri} ${entry.title.replace(/\s+/g, " ").trim() || "-"}\n`);
  return Buffer.concat([Buffer.from(header, "utf-8"), deflateSync(Buffer.from(lines.join(""), "utf-8"))]);
}
