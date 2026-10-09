#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("explorer/package.json"));
const ts = require("typescript");

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const MARKUP_EXTENSIONS = new Set([".astro", ".html"]);
const EXCLUDED = [/^drafts\//, /(^|\/)node_modules\//, /(^|\/)dist\//, /\.min\.js$/, /(^|\/)vendor\//];
const DIRECTIVES = [
  /^\/\/\/\s*<reference\b/,
  /^#!/,
  /^\/[/*]\s*(eslint|@ts-|prettier-ignore|istanbul|c8 |@vite-ignore|@vitest-environment|webpack|@license|@preserve|biome-ignore|@jsx|@refresh|global )/,
  /^\/\*\s*@vite-ignore\s*\*\/$/,
  /^<!--\s*(@license|prettier-ignore)/,
];

function isDirective(text) {
  return DIRECTIVES.some((pattern) => pattern.test(text.trim()));
}

function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function scriptComments(source, offset = 0, name = "file.tsx") {
  const kind = /\.(tsx|jsx)$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind);
  const seen = new Map();
  const collect = (ranges) => {
    for (const range of ranges ?? []) seen.set(range.pos, source.slice(range.pos, range.end));
  };
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(source, node.pos));
    collect(ts.getTrailingCommentRanges(source, node.end));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  collect(ts.getLeadingCommentRanges(source, tree.endOfFileToken.pos));
  return [...seen].map(([pos, text]) => ({ offset: offset + pos, text }));
}

function markupComments(source) {
  const found = [];
  for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
    found.push({ offset: match.index, text: match[0] });
  }
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) found.push(...scriptComments(frontmatter[1], 4, "frontmatter.ts"));
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = match[1];
    found.push(...scriptComments(body, match.index + match[0].indexOf(body), "script.ts"));
  }
  for (const match of source.matchAll(/\{\s*(\/\*[\s\S]*?\*\/)\s*\}/g)) {
    found.push({ offset: match.index + match[0].indexOf(match[1]), text: match[1] });
  }
  return found;
}

export function findComments(name, source) {
  const extension = path.extname(name);
  const comments = MARKUP_EXTENSIONS.has(extension) ? markupComments(source) : scriptComments(source, 0, name);
  return comments
    .filter((comment) => !isDirective(comment.text))
    .map((comment) => ({ line: lineOf(source, comment.offset), text: comment.text.split("\n")[0].slice(0, 120) }));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((file) => SCRIPT_EXTENSIONS.has(path.extname(file)) || MARKUP_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !EXCLUDED.some((pattern) => pattern.test(file)));
}

function main(files) {
  let count = 0;
  for (const file of files) {
    for (const finding of findComments(file, readFileSync(file, "utf8"))) {
      count += 1;
      console.log(`${file}:${finding.line}: ${finding.text}`);
    }
  }
  console.log(`comment check: ${files.length} files, ${count} comments`);
  return count === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.length > 2 ? process.argv.slice(2) : trackedFiles()));
}
