import { readFileSync } from "node:fs";
import type { Catalog } from "./prompt-builder.ts";
import { siteInputsPath } from "./site-inputs.ts";

export function loadPromptCatalog(file: string = siteInputsPath("landing", "prompt-catalog.json")): Catalog {
  return JSON.parse(readFileSync(file, "utf-8")) as Catalog;
}
