#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

let failures = 0;
for (const file of process.argv.slice(2)) {
  for (const document of parseAllDocuments(readFileSync(file, "utf8"))) {
    for (const error of document.errors) {
      failures += 1;
      console.error(`${file}: ${error.message}`);
    }
  }
}
process.exit(failures === 0 ? 0 : 1);
