import { readFileSync } from "node:fs";
import type { Catalog } from "./prompt-builder.ts";
import { siteInputsPath } from "./site-inputs.ts";

const ASSIGNMENT = /window\.__BENCHBOX_PROMPT_CATALOG__\s*=\s*/;

export function parseCatalogSource(source: string): Catalog {
  const match = ASSIGNMENT.exec(source);
  if (!match) throw new Error("catalog.generated.js does not assign window.__BENCHBOX_PROMPT_CATALOG__");
  const json = source.slice(match.index + match[0].length).trim().replace(/;$/, "");
  return JSON.parse(json) as Catalog;
}

export function loadPromptCatalog(file: string = siteInputsPath("landing", "prompt-catalog.json")): Catalog {
  const source = readFileSync(file, "utf-8");
  return file.endsWith(".json") ? (JSON.parse(source) as Catalog) : parseCatalogSource(source);
}
