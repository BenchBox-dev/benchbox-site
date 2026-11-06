import path from "node:path";
import { createServer } from "vite";
import type * as resultEmbed from "../../explorer/src/lib/resultEmbed.ts";
import { explorerAliases, explorerDatabasePlugin } from "../src/lib/explorer-alias.ts";
import { formatCitationBlock } from "../src/lib/results-embed.ts";
import type * as resultsDb from "../src/lib/results-db.ts";
import { bundleManifest, explorerSnapshotSha, REPO_ROOT, siteInputsPath } from "../src/lib/site-inputs.ts";

const resultId = process.argv[2];
if (!resultId) {
  console.error("usage: npm run results:cite -w website -- <result id>");
  process.exit(2);
}

const producedAt = bundleManifest().produced_at;
if (!producedAt) {
  console.error("The core bundle manifest has no produced_at, so the snapshot date is unknown.");
  process.exit(1);
}

const server = await createServer({
  root: path.join(REPO_ROOT, "website"),
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [explorerDatabasePlugin],
  resolve: { alias: explorerAliases },
});

try {
  const db = (await server.ssrLoadModule(path.join(REPO_ROOT, "website", "src", "lib", "results-db.ts"))) as typeof resultsDb;
  await db.openResultsSnapshot(siteInputsPath("explorer", "results.duckdb"));
  const { loadEmbedResult, embedFacts } = (await server.ssrLoadModule(path.join(REPO_ROOT, "explorer", "src", "lib", "resultEmbed.ts"))) as typeof resultEmbed;
  const result = await loadEmbedResult(resultId);
  if (result.state === "withdrawn") {
    console.error(`${resultId} is not published in the current snapshot, so it cannot be cited.`);
    process.exitCode = 1;
  } else {
    const facts = embedFacts(result);
    process.stdout.write(
      formatCitationBlock({
        result: resultId,
        snapshot: explorerSnapshotSha(),
        snapshotDate: producedAt.slice(0, 10),
        platform: facts.platform,
        benchmark: facts.benchmark,
        scale: facts.scale,
        runDate: facts.runDate,
        metric: facts.metric.label,
        direction: facts.metric.direction,
        value: facts.metric.text,
      }),
    );
  }
  db.closeResultsSnapshot();
} finally {
  await server.close();
}
