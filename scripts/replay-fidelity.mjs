import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const SEED_RENAMES = [
  ["results-explorer/", "explorer/"],
  ["docs/blog/", "blog/"],
  ["_blog/", "drafts/"],
  ["_project/design/site-inventory/", "inventory/"],
  ["website/", "website/"],
  ["landing/", "landing/"],
];

export function mapSitePath(corePath) {
  for (const [corePrefix, sitePrefix] of SEED_RENAMES) {
    if (corePath.startsWith(corePrefix)) {
      return sitePrefix + corePath.slice(corePrefix.length);
    }
  }
  return null;
}

export function loadAllowlist(siteRoot) {
  return new Map(loadAllowlistEntries(siteRoot).map((entry) => [entry.site, entry.reason]));
}

export function loadAllowlistEntries(siteRoot) {
  const allowlistPath = path.join(siteRoot, "inventory", "replay-allowlist.json");
  return JSON.parse(readFileSync(allowlistPath, "utf8"));
}

export function listSeededFiles(coreRepo, coreRef) {
  const out = execFileSync("git", ["-C", coreRepo, "ls-tree", "-r", "--name-only", coreRef, "--", ...SEED_RENAMES.map(([prefix]) => prefix)], { encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function diffHash(coreBytes, siteBytes) {
  return createHash("sha256").update(coreBytes).update(Buffer.from([0])).update(siteBytes).digest("hex");
}

export function versionConstants(text) {
  const found = new Map();
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9_]*VERSION[A-Z0-9_]*)\s*=\s*(\d+)/g)) {
    found.set(match[1], match[2]);
  }
  return found;
}

export function pinnedCoreRef(siteRoot) {
  return readFileSync(path.join(siteRoot, "inventory", "replay-core-ref.txt"), "utf8").trim();
}

export function checkFullFidelity({ coreRepo, siteRoot, coreRef }) {
  const entries = new Map(loadAllowlistEntries(siteRoot).map((entry) => [entry.site, entry]));
  const results = [];
  for (const corePath of listSeededFiles(coreRepo, coreRef).sort()) {
    const siteRel = mapSitePath(corePath);
    if (siteRel === null) continue;
    const siteAbs = path.join(siteRoot, siteRel);
    const entry = entries.get(siteRel);
    const blob = readCoreBlob(coreRepo, coreRef, corePath);
    if (blob === null) {
      results.push({ site: siteRel, core: corePath, state: existsSync(siteAbs) ? "core-removed" : "removed" });
      continue;
    }
    if (!existsSync(siteAbs)) {
      if (entry?.excluded === true) {
        results.push({ site: siteRel, core: corePath, state: "excluded", reason: entry.reason });
        continue;
      }
      results.push({ site: siteRel, core: corePath, state: "missing" });
      continue;
    }
    const siteBytes = readFileSync(siteAbs);
    if (blob.equals(siteBytes)) {
      results.push({ site: siteRel, core: corePath, state: entry ? "stale-allowlist" : "identical" });
      continue;
    }
    if (!entry || entry.excluded === true || !entry.expectedDiff) {
      results.push({ site: siteRel, core: corePath, state: entry?.excluded === true ? "unexpected-file" : "mismatch" });
      continue;
    }
    if (diffHash(blob, siteBytes) !== entry.expectedDiff) {
      results.push({ site: siteRel, core: corePath, state: "unexpected-diff", reason: entry.reason });
      continue;
    }
    const coreVersions = versionConstants(blob.toString("utf8"));
    const siteVersions = versionConstants(siteBytes.toString("utf8"));
    const drifted = [...coreVersions.entries()].filter(([name, value]) => siteVersions.has(name) && siteVersions.get(name) !== value);
    if (drifted.length > 0) {
      results.push({ site: siteRel, core: corePath, state: "constant-drift", reason: entry.reason });
      continue;
    }
    results.push({ site: siteRel, core: corePath, state: "adapted", reason: entry.reason });
  }
  return { coreRef, results };
}

export function rangeCommits(coreRepo, sinceRef, coreRef) {
  const out = execFileSync("git", ["-C", coreRepo, "log", "--format=%H %h %s", `${sinceRef}..${coreRef}`, "--", ...SEED_RENAMES.map(([prefix]) => prefix)], { encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [full, short, ...subject] = line.split(" ");
      return { full, short, subject: subject.join(" ") };
    });
}

export function seededFilesInCommit(coreRepo, sha) {
  const out = execFileSync("git", ["-C", coreRepo, "show", "--name-only", "--format=", sha], { encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && mapSitePath(line) !== null);
}

export function readCoreBlob(coreRepo, ref, corePath) {
  try {
    return execFileSync("git", ["-C", coreRepo, "show", `${ref}:${corePath}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function checkFidelity({ coreRepo, siteRoot, sinceRef, coreRef }) {
  const allowlist = loadAllowlist(siteRoot);
  const range = rangeCommits(coreRepo, sinceRef, coreRef);
  const touched = new Map();
  for (const commit of range) {
    for (const corePath of seededFilesInCommit(coreRepo, commit.full)) {
      if (!touched.has(corePath)) {
        touched.set(corePath, commit.short);
      }
    }
  }
  const results = [];
  for (const [corePath, commit] of [...touched.entries()].sort()) {
    const siteRel = mapSitePath(corePath);
    const siteAbs = path.join(siteRoot, siteRel);
    const blob = readCoreBlob(coreRepo, coreRef, corePath);
    if (blob === null) {
      results.push({ site: siteRel, core: corePath, commit, state: existsSync(siteAbs) ? "core-removed" : "removed" });
      continue;
    }
    if (!existsSync(siteAbs)) {
      results.push({ site: siteRel, core: corePath, commit, state: "missing" });
      continue;
    }
    if (blob.equals(readFileSync(siteAbs))) {
      results.push({ site: siteRel, core: corePath, commit, state: "identical" });
      continue;
    }
    if (allowlist.has(siteRel)) {
      results.push({ site: siteRel, core: corePath, commit, state: "allowlisted", reason: allowlist.get(siteRel) });
      continue;
    }
    results.push({ site: siteRel, core: corePath, commit, state: "mismatch" });
  }
  return { range, results };
}

export function formatReport({ range, results }) {
  const lines = ["seeded-path replay range:"];
  for (const commit of range) {
    lines.push(`  ${commit.short} ${commit.subject}`);
  }
  for (const result of results) {
    lines.push(`  [${result.state}] ${result.site} (core ${result.core} @ ${result.commit})${result.reason ? ` :: ${result.reason}` : ""}`);
  }
  const bad = results.filter((result) => result.state === "mismatch" || result.state === "missing" || result.state === "core-removed");
  lines.push(`fidelity: ${results.length - bad.length}/${results.length} clean, ${bad.length} blocking`);
  return { text: lines.join("\n"), blocking: bad };
}

export function formatFullReport({ coreRef, results }) {
  const lines = [`seeded-path full fidelity at core ${coreRef}:`];
  for (const result of results) {
    lines.push(`  [${result.state}] ${result.site} (core ${result.core})${result.reason ? ` :: ${result.reason}` : ""}`);
  }
  const bad = results.filter(
    (result) =>
      result.state === "mismatch" ||
      result.state === "missing" ||
      result.state === "core-removed" ||
      result.state === "unexpected-file" ||
      result.state === "unexpected-diff" ||
      result.state === "constant-drift" ||
      result.state === "stale-allowlist",
  );
  lines.push(`fidelity: ${results.length - bad.length}/${results.length} clean, ${bad.length} blocking`);
  return { text: lines.join("\n"), blocking: bad };
}

function parseArgs(argv) {
  const args = { core: null, site: process.cwd(), ref: null, since: null, full: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--site") args.site = argv[++i];
    else if (argv[i] === "--ref") args.ref = argv[++i];
    else if (argv[i] === "--since") args.since = argv[++i];
    else if (argv[i] === "--full") args.full = true;
  }
  return args;
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (args.full) {
    if (!args.core || !args.ref) {
      process.stderr.write("usage: replay-fidelity.mjs --core <core-checkout> --ref <core-sha> --full [--site <site-root>]\n");
      process.exit(2);
    }
    const { text, blocking } = formatFullReport(checkFullFidelity({ coreRepo: args.core, siteRoot: args.site, coreRef: args.ref }));
    process.stdout.write(`${text}\n`);
    process.exit(blocking.length > 0 ? 1 : 0);
  }
  if (!args.core || !args.ref || !args.since) {
    process.stderr.write("usage: replay-fidelity.mjs --core <core-checkout> --ref <core-sha> --since <last-replayed-sha> [--site <site-root>]\n");
    process.exit(2);
  }
  const { text, blocking } = formatReport(checkFidelity({ coreRepo: args.core, siteRoot: args.site, sinceRef: args.since, coreRef: args.ref }));
  process.stdout.write(`${text}\n`);
  process.exit(blocking.length > 0 ? 1 : 0);
}
