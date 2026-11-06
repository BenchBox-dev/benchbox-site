import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const explorerSource = path.join(websiteRoot, "..", "explorer", "src");

export const explorerAliases = [{ find: /^@\/(?!db$)/, replacement: `${explorerSource}/` }];

export const explorerDatabasePlugin = {
  name: "benchbox-explorer-database",
  enforce: "pre" as const,
  resolveId(source: string, _importer: string | undefined, options: { ssr?: boolean }): string | undefined {
    if (source !== "@/db") return undefined;
    return options.ssr ? path.join(websiteRoot, "src", "lib", "results-db.ts") : path.join(explorerSource, "db.ts");
  },
};
