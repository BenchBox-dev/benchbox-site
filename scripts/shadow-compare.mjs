#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HASHED_NAME = /([.-])[A-Za-z0-9_-]{8}(\.(?:js|mjs|css|wasm|woff2?|svg|png|jpe?g))\b/g;
const SCOPED_CLASS = /\bastro-[a-z0-9]{8}\b/g;
const SCOPED_ATTR = /\bdata-astro-cid-[a-z0-9]{8}\b/g;
const ISLAND_UID = /(<astro-island\b[^>]*\buid=")[A-Za-z0-9]+"/g;
const TEXT = /\.(html?|xml|txt|json|js|mjs|css|svg|webmanifest)$/i;

export function normalizePath(file) {
  return file.replace(HASHED_NAME, "$1HASH$2");
}

export function normalizeText(text, rewrites = []) {
  let normalized = text
    .replace(HASHED_NAME, "$1HASH$2")
    .replace(SCOPED_CLASS, "astro-HASH")
    .replace(SCOPED_ATTR, "data-astro-cid-HASH")
    .replace(ISLAND_UID, '$1UID"');
  for (const rewrite of rewrites) normalized = normalized.replace(new RegExp(rewrite.pattern, "g"), rewrite.replacement);
  return normalized;
}

function walk(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(root, relative);
    return entry.isFile() ? [relative] : [];
  });
}

export function sphinxInventoryBody(bytes) {
  let offset = 0;
  for (let line = 0; line < 4; line += 1) offset = bytes.indexOf(10, offset) + 1;
  return Buffer.concat([bytes.subarray(0, offset), inflateSync(bytes.subarray(offset))]);
}

function fingerprint(root, file, rewrites) {
  const raw = readFileSync(path.join(root, file));
  const bytes = file.endsWith("objects.inv") ? sphinxInventoryBody(raw) : raw;
  const body = TEXT.test(file) ? normalizeText(bytes.toString("utf8"), rewrites) : bytes;
  return createHash("sha256").update(body).digest("hex");
}

function index(root) {
  const byPath = new Map();
  for (const file of walk(root)) {
    const key = normalizePath(file);
    if (byPath.has(key)) byPath.set(key, [...byPath.get(key), file]);
    else byPath.set(key, [file]);
  }
  return byPath;
}

function firstDifference(a, b, rewrites) {
  const left = normalizeText(a, rewrites).split("\n");
  const right = normalizeText(b, rewrites).split("\n");
  for (let line = 0; line < Math.max(left.length, right.length); line += 1) {
    if (left[line] !== right[line]) {
      const l = left[line] ?? "";
      const r = right[line] ?? "";
      let column = 0;
      while (column < Math.min(l.length, r.length) && l[column] === r[column]) column += 1;
      const start = Math.max(0, column - 60);
      return { line: line + 1, core: l.slice(start, column + 100), site: r.slice(start, column + 100) };
    }
  }
  return null;
}

export function compareTrees(coreDir, siteDir, allowlist = [], rewrites = []) {
  const core = index(coreDir);
  const site = index(siteDir);
  const allowed = (file) => allowlist.find((entry) => new RegExp(entry.pattern).test(file));
  const report = { onlyCore: [], onlySite: [], differ: [], allowed: [], matched: 0 };
  for (const [key, files] of core) {
    if (!site.has(key)) {
      (allowed(key) ? report.allowed : report.onlyCore).push(key);
      continue;
    }
    const siteFiles = site.get(key);
    if (files.length !== 1 || siteFiles.length !== 1) {
      if (files.length !== siteFiles.length) report.differ.push({ file: key, reason: `ambiguous hashed name (${files.length} vs ${siteFiles.length})` });
      else report.matched += 1;
      continue;
    }
    if (fingerprint(coreDir, files[0], rewrites) === fingerprint(siteDir, siteFiles[0], rewrites)) {
      report.matched += 1;
      continue;
    }
    if (allowed(key)) {
      report.allowed.push(key);
      continue;
    }
    const detail = TEXT.test(key)
      ? firstDifference(readFileSync(path.join(coreDir, files[0]), "utf8"), readFileSync(path.join(siteDir, siteFiles[0]), "utf8"), rewrites)
      : { binary: true };
    report.differ.push({ file: key, ...detail });
  }
  for (const key of site.keys()) if (!core.has(key)) (allowed(key) ? report.allowed : report.onlySite).push(key);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [coreDir, siteDir, allowlistFile] = process.argv.slice(2);
  const policy = allowlistFile ? JSON.parse(readFileSync(allowlistFile, "utf8")) : { entries: [], rewrites: [] };
  const report = compareTrees(coreDir, siteDir, policy.entries ?? [], policy.rewrites ?? []);
  console.log(JSON.stringify(report, null, 2));
  const unexplained = report.onlyCore.length + report.onlySite.length + report.differ.length;
  console.error(`shadow compare: ${report.matched} matched, ${report.allowed.length} allowed, ${unexplained} unexplained`);
  process.exit(unexplained === 0 ? 0 : 1);
}
