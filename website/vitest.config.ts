import { defineConfig } from "vitest/config";
import { explorerAliases, explorerDatabasePlugin } from "./src/lib/explorer-alias.ts";

export default defineConfig({
  plugins: [explorerDatabasePlugin],
  resolve: { alias: explorerAliases },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
