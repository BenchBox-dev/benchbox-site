import path from "node:path";
import type { Plugin } from "vite";
import { REPO_ROOT } from "./site-inputs.ts";

export const explorerAliases: { find: RegExp; replacement: string }[] = [{ find: /^@\/(?!db$)/, replacement: `${path.join(REPO_ROOT, "explorer", "src")}/` }];

export const explorerDatabasePlugin: Plugin = {
  name: "explorer-database",
  enforce: "pre",
  resolveId(source, _importer, options) {
    if (source !== "@/db") return null;
    return path.join(REPO_ROOT, options.ssr ? "website/src/lib/results-db.ts" : "explorer/src/db.ts");
  },
};
