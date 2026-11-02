import childProcess from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const scenario = JSON.parse(readFileSync(process.env.RESOLVE_SCENARIO, "utf8"));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

globalThis.fetch = async (url) => {
  const route = new URL(url).pathname + new URL(url).search;
  if (route.includes("/deployments?")) return json(scenario.deployments.map(({ id }) => ({ id })));
  const statuses = /\/deployments\/(\d+)\/statuses/.exec(route);
  if (statuses) {
    const deployment = scenario.deployments.find(({ id }) => String(id) === statuses[1]);
    return json([{ state: "success", description: deployment.description }]);
  }
  if (route.includes("/compare/")) return json({ status: scenario.compare });
  return json({ message: `unstubbed ${route}` }, 404);
};

function writeBundle(destination, bundle) {
  mkdirSync(path.join(destination, "explorer"), { recursive: true });
  writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ core_sha: bundle.core_sha, corpus_sha: bundle.corpus_sha }));
  writeFileSync(path.join(destination, ".fetched.json"), JSON.stringify({ digest: bundle.digest }));
  writeFileSync(path.join(destination, "attestations.json"), "[]");
  writeFileSync(path.join(destination, "explorer", "contract.json"), JSON.stringify({ read_model_version: 14 }));
}

const execFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, args = [], options) => {
  if (file === "gh" && args[0] === "run" && args[1] === "download") {
    const directory = args[args.indexOf("-D") + 1];
    writeFileSync(path.join(directory, "receipt.json"), JSON.stringify(scenario.receipts[args[2]]));
    return Buffer.alloc(0);
  }
  if (String(args[0]).endsWith("bundle-fetch.mjs")) {
    const env = options.env;
    appendFileSync(scenario.fetchLog, `${JSON.stringify({ core_sha: env.SITE_INPUTS_CORE_SHA ?? "", run_id: env.SITE_INPUTS_RUN_ID ?? "", digest: env.SITE_INPUTS_DIGEST ?? "" })}\n`);
    const pinnedByCoreSha = Boolean(env.SITE_INPUTS_CORE_SHA) && !env.SITE_INPUTS_RUN_ID;
    writeBundle(env.SITE_INPUTS, pinnedByCoreSha ? scenario.deployedBundle : scenario.candidate);
    return Buffer.alloc(0);
  }
  return execFileSync(file, args, options);
};
syncBuiltinESMExports();
