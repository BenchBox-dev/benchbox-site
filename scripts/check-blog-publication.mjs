#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const STALE_AFTER_DAYS = 45;
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const POST_NAME = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9][a-z0-9-]*\.md$/;
const DATE_FIELD = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const PLAN_NOTE = "Time-sensitive figures";
const FACTS_VERIFIED = /^(-|never|\d{4}-\d{2}-\d{2})$/;

export function frontMatterOf(source) {
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(source);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isoFromPostDate(value) {
  const match = DATE_FIELD.exec(String(value).trim());
  if (!match) return null;
  const word = match[1].toLowerCase();
  const month = MONTH_NAMES.findIndex((name) => name === word || name.slice(0, 3) === word);
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function toctreeEntries(indexSource) {
  const block = /```\{toctree\}\n([\s\S]*?)\n```/.exec(indexSource);
  if (!block) return null;
  return block[1].split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith(":"));
}

function hasTags(value) {
  if (Array.isArray(value)) return value.some((tag) => String(tag).trim());
  return typeof value === "string" && value.split(",").some((tag) => tag.trim());
}

export function postFindings(posts, indexSource) {
  const findings = [];
  const stems = new Set();
  for (const { name, source } of posts) {
    const file = `blog/${name}`;
    const nameMatch = POST_NAME.exec(name);
    if (!nameMatch) {
      findings.push(`${file}: file name must be YYYY-MM-DD-slug.md`);
      continue;
    }
    stems.add(name.slice(0, -3));
    const front = frontMatterOf(source);
    if (!front) {
      findings.push(`${file}: missing or invalid front matter`);
      continue;
    }
    if (front.blogpost !== true) findings.push(`${file}: front matter needs blogpost: true`);
    if (typeof front.author !== "string" || !front.author.trim()) findings.push(`${file}: front matter needs author`);
    if (!hasTags(front.tags)) findings.push(`${file}: front matter needs tags`);
    const iso = isoFromPostDate(front.date);
    if (!iso) findings.push(`${file}: date must read Month D, YYYY`);
    else if (iso !== `${nameMatch[1]}-${nameMatch[2]}-${nameMatch[3]}`) {
      findings.push(`${file}: date ${front.date} does not match the file name date`);
    }
  }
  const entries = toctreeEntries(indexSource);
  if (!entries) {
    findings.push("blog/index.md: no toctree block");
    return findings;
  }
  const listed = new Set();
  for (const entry of entries) {
    if (listed.has(entry)) findings.push(`blog/index.md: toctree lists ${entry} twice`);
    listed.add(entry);
    if (!stems.has(entry)) findings.push(`blog/index.md: toctree lists ${entry} but blog/${entry}.md does not exist`);
  }
  for (const stem of stems) {
    if (!listed.has(stem)) findings.push(`blog/index.md: toctree is missing ${stem}`);
  }
  return findings;
}

function queueRows(scheduleSource) {
  const section = /## Upcoming queue\n([\s\S]*?)\n---/.exec(scheduleSource);
  if (!section) return null;
  const rows = section[1].split("\n").filter((line) => line.startsWith("|"));
  const header = rows[0]?.split("|").slice(1, -1).map((cell) => cell.trim()) ?? [];
  const body = rows.slice(2).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  return { header, body };
}

export function queueFindings({ scheduleSource, draftFiles, readDraft, today }) {
  const findings = [];
  const warnings = [];
  const table = queueRows(scheduleSource);
  if (!table) return { findings: ["drafts/PUBLICATION_SCHEDULE.md: no Upcoming queue table"], warnings };
  const column = (name) => table.header.indexOf(name);
  const [article, source, notes, verified] = ["Article", "Source", "Blockers / notes", "Facts verified"].map(column);
  if ([article, source, notes, verified].some((index) => index < 0)) {
    return { findings: ["drafts/PUBLICATION_SCHEDULE.md: queue needs Article, Source, Facts verified and Blockers / notes columns"], warnings };
  }
  const linked = new Map();
  let unverified = 0;
  for (const row of table.body) {
    const label = row[article];
    const target = /\]\(([^)]+)\)/.exec(row[source] ?? "")?.[1];
    if (!target) {
      findings.push(`queue row "${label}": Source needs a link`);
      continue;
    }
    const file = path.posix.join("drafts", target);
    if (linked.has(file)) findings.push(`queue row "${label}": ${file} is already queued as "${linked.get(file)}"`);
    linked.set(file, label);
    const draft = readDraft(file);
    if (draft === null) {
      findings.push(`queue row "${label}": ${file} does not exist`);
      continue;
    }
    const held = frontMatterOf(draft)?.hold !== undefined;
    const withheld = /withheld/i.test(row[notes]);
    if (withheld && !held) findings.push(`queue row "${label}": marked withheld but ${file} has no hold field`);
    if (held && !withheld) findings.push(`${file}: has a hold field but its queue row is not marked withheld`);
    const factsVerified = row[verified];
    if (!FACTS_VERIFIED.test(factsVerified ?? "")) {
      findings.push(`queue row "${label}": Facts verified must be -, never or YYYY-MM-DD`);
      continue;
    }
    if (/time-sensitive/i.test(row[notes])) {
      if (factsVerified === "-") findings.push(`queue row "${label}": time-sensitive rows need a Facts verified date or never`);
      else if (factsVerified === "never") unverified += 1;
      else if (today - Date.parse(factsVerified) > STALE_AFTER_DAYS * 86400000) {
        warnings.push(`queue row "${label}": facts last verified ${factsVerified}; re-verify before publishing`);
      }
    }
  }
  for (const file of draftFiles) {
    if (!linked.has(file)) findings.push(`${file}: draft has no row in the Upcoming queue`);
  }
  if (unverified > 0) warnings.push(`${unverified} time-sensitive queue rows have never had their facts verified`);
  return { findings, warnings };
}

export function linkFindings(file, source, exists) {
  const findings = [];
  const base = path.posix.dirname(file);
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!exists(path.posix.normalize(path.posix.join(base, target)))) {
        findings.push(`${file}:${index + 1}: link ${match[1]} does not resolve`);
      }
    }
  });
  return findings;
}

export function planFindings(file, source) {
  if (/\$\d/.test(source) && !source.includes(PLAN_NOTE)) {
    return [`${file}: states prices but lacks a "${PLAN_NOTE}" note pointing to the queue`];
  }
  return [];
}

function listDraftFiles(root) {
  const files = [];
  for (const series of readdirSync(path.join(root, "drafts"), { withFileTypes: true })) {
    const dir = path.join(root, "drafts", series.name, "drafts");
    if (!series.isDirectory() || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".md")) files.push(`drafts/${series.name}/drafts/${entry}`);
    }
  }
  return files.sort();
}

function listPlans(root) {
  return readdirSync(path.join(root, "drafts"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `drafts/${entry.name}/outlines/series-plan.md`)
    .filter((file) => existsSync(path.join(root, file)));
}

export function checkPublication(root, today = Date.now()) {
  const read = (file) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), "utf8") : null);
  const exists = (file) => existsSync(path.join(root, file));
  const blogDir = path.join(root, "blog");
  const posts = readdirSync(blogDir)
    .filter((name) => name.endsWith(".md") && name !== "index.md")
    .sort()
    .map((name) => ({ name, source: readFileSync(path.join(blogDir, name), "utf8") }));
  const findings = postFindings(posts, read("blog/index.md") ?? "");
  const scheduleFile = "drafts/PUBLICATION_SCHEDULE.md";
  const scheduleSource = read(scheduleFile) ?? "";
  const queue = queueFindings({ scheduleSource, draftFiles: listDraftFiles(root), readDraft: read, today });
  findings.push(...queue.findings, ...linkFindings(scheduleFile, scheduleSource, exists));
  for (const plan of listPlans(root)) {
    const source = read(plan);
    findings.push(...linkFindings(plan, source, exists), ...planFindings(plan, source));
  }
  return { findings, warnings: queue.warnings };
}

function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const { findings, warnings } = checkPublication(root);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const finding of findings) console.log(finding);
  console.log(`blog publication: ${findings.length} findings, ${warnings.length} warnings`);
  return findings.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
