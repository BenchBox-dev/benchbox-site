#!/usr/bin/env node
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const key = (capture) => `${capture.route}@${capture.viewport_width}`;

export function compareCaptures(deployed, pr) {
  const before = new Map(deployed.captures.map((capture) => [key(capture), capture]));
  const after = new Map(pr.captures.map((capture) => [key(capture), capture]));
  const report = { same: [], changed: [], removed: [], added: [] };
  for (const [name, capture] of after) {
    if (!before.has(name)) report.added.push({ name, pr: capture });
    else if (before.get(name).digest === capture.digest) report.same.push(name);
    else report.changed.push({ name, deployed: before.get(name), pr: capture });
  }
  for (const [name, capture] of before) if (!after.has(name)) report.removed.push({ name, deployed: capture });
  return report;
}

export function summaryMarkdown(report, deployedRun) {
  const lines = [
    "## Visual comparison with the deployed site",
    "",
    `Deployed artifact: run ${deployedRun}. This check is advisory and never fails CI.`,
    "",
    `${report.same.length} unchanged, ${report.changed.length} changed, ${report.added.length} added, ${report.removed.length} removed.`,
  ];
  const rows = [
    ...report.changed.map((entry) => `| ${entry.name} | changed |`),
    ...report.added.map((entry) => `| ${entry.name} | only in this PR |`),
    ...report.removed.map((entry) => `| ${entry.name} | only on the deployed site |`),
  ];
  if (rows.length > 0) {
    lines.push("", "| Capture | Result |", "| --- | --- |", ...rows, "", "Both screenshots of each difference are in the `visual-diff` artifact.");
  }
  return `${lines.join("\n")}\n`;
}

function copyPair(entry, deployedDir, prDir, outDir) {
  const folder = path.join(outDir, (entry.pr ?? entry.deployed).filename.replace(/\.png$/, ""));
  mkdirSync(folder, { recursive: true });
  if (entry.deployed) copyFileSync(path.join(deployedDir, entry.deployed.filename), path.join(folder, "deployed.png"));
  if (entry.pr) copyFileSync(path.join(prDir, entry.pr.filename), path.join(folder, "pr.png"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [deployedDir, prDir, outDir, deployedRun = "unknown"] = process.argv.slice(2);
  if (!deployedDir || !prDir || !outDir) {
    console.error("usage: visual-diff.mjs <deployed captures> <pr captures> <out dir> [deployed run id]");
    process.exit(2);
  }
  const read = (dir) => JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const report = compareCaptures(read(deployedDir), read(prDir));
  mkdirSync(outDir, { recursive: true });
  for (const entry of [...report.changed, ...report.added, ...report.removed]) copyPair(entry, deployedDir, prDir, outDir);
  const summary = summaryMarkdown(report, deployedRun);
  writeFileSync(path.join(outDir, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}
