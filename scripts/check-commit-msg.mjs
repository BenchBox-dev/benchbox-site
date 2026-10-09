#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const AGENT_COAUTHOR = /^[ \t]*co-authored-by:(.*(noreply@anthropic\.com|noreply@openai\.com)|[ \t]*(chatgpt|claude|codex|gemini|openai)[ \t]*<)/im;
const AGENT_SESSION = /^[ \t]*(claude|codex|gemini|chatgpt)-session:/im;

export function attributionLines(message) {
  return message
    .split("\n")
    .filter((line) => !/^[ \t]*#/.test(line))
    .filter((line) => AGENT_COAUTHOR.test(line) || AGENT_SESSION.test(line));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("check-commit-msg: expected a commit message file argument");
    process.exit(2);
  }
  const found = attributionLines(readFileSync(file, "utf8"));
  if (found.length > 0) {
    console.error("Refusing commit: the message carries agent or service attribution.");
    for (const line of found) console.error(`  ${line}`);
    console.error("Commits in this repository carry no agent trailers. Remove the line and commit again.");
    process.exit(1);
  }
}
