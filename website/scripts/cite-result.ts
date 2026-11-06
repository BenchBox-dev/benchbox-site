import path from "node:path";
import { createServer } from "vite";
import { formatCitationBlock } from "../src/lib/results-embed.ts";
import { explorerAliases, explorerDatabasePlugin } from "../src/lib/explorer-alias.ts";
import type * as resultEmbed from "../../explorer/src/lib/resultEmbed.ts";
import { bundleManifest, explorerSnapshotSha, REPO_ROOT } from "../src/lib/site-inputs.ts";

const resultId = process.argv[2];
if (!resultId) {
  console.error("usage: npm run results:cite -w website -- <result id>");
  process.exit(2);
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
        snapshotDate: bundleManifest().produced_at.slice(0, 10),
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
} finally {
  await server.close();
}
