#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function targetOf(url) {
  const parsed = new URL(url);
  return `${decode(parsed.pathname)}${parsed.hash === "" ? "" : `#${decode(parsed.hash.slice(1))}`}`;
}

export function allowedTargets(allowance) {
  return new Set(allowance.map((entry) => entry[1]));
}

export function disallowedFailures(report, allowance) {
  const allowed = allowedTargets(allowance);
  const failures = [];
  for (const map of [report.error_map ?? {}, report.timeout_map ?? {}]) {
    for (const [source, entries] of Object.entries(map)) {
      for (const entry of entries) {
        const target = targetOf(entry.url);
        if (!allowed.has(target)) failures.push({ source, target, reason: entry.status?.details ?? entry.status?.text ?? "error" });
      }
    }
  }
  return failures;
}

export function renderReport(report, failures) {
  const lines = [
    "Published documentation link check",
    "",
    `Checked ${report.total} links (${report.unique} unique): ${report.successful} ok, ${report.errors} failed, ${report.timeouts} timed out.`,
    "",
  ];
  if (failures.length === 0) {
    lines.push("Every failure matches an entry in inventory/known-broken-links.json.");
  } else {
    lines.push(`${failures.length} failures are not in inventory/known-broken-links.json:`, "");
    for (const failure of failures) lines.push(`- ${failure.source} links to ${failure.target}: ${failure.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

export function evaluate(report, allowance) {
  const failures = disallowedFailures(report, allowance);
  const checked = report.successful + report.errors + report.timeouts;
  const problems = checked === 0 ? ["lychee checked no links"] : [];
  return { failures, problems, ok: failures.length === 0 && problems.length === 0, text: renderReport(report, failures) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [reportPath, allowancePath] = process.argv.slice(2);
  if (!reportPath || !allowancePath) {
    console.error("usage: check-published-links.mjs <lychee-report.json> <known-broken-links.json>");
    process.exit(2);
  }
  const result = evaluate(JSON.parse(readFileSync(reportPath, "utf8")), JSON.parse(readFileSync(allowancePath, "utf8")));
  process.stdout.write(result.text);
  for (const problem of result.problems) console.log(problem);
  process.exit(result.ok ? 0 : 1);
}
