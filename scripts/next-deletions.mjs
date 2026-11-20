#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PATHS = ["docs", "blog"];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function mergeTree(cwd, next, main) {
  try {
    return git(cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", next, main]);
  } catch (error) {
    if (error.status === 1 && typeof error.stdout === "string") return error.stdout;
    throw error;
  }
}

export function nextDeletions({ cwd = process.cwd(), next = "origin/next", main = "origin/main" } = {}) {
  const output = mergeTree(cwd, next, main);
  const [tree] = output.split("\n");
  const fields = git(cwd, ["diff", "--numstat", "--no-renames", "-z", next, tree, "--", ...PATHS]).split("\0");
  const deletions = [];
  for (const field of fields) {
    const [, deleted, ...rest] = field.split("\t");
    const file = rest.join("\t");
    if (!file || deleted === "-") continue;
    const count = Number(deleted);
    if (count > 0) deletions.push({ file, deleted: count });
  }
  return deletions.sort((a, b) => a.file.localeCompare(b.file));
}

export function formatDeletions(deletions) {
  return deletions.map(({ file, deleted }) => `- \`${file}\`: ${deleted} line(s) removed`).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(formatDeletions(nextDeletions()));
}
