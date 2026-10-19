import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import { fixtureBundle, FIXTURE_CORE } from "./fixture-bundle.mjs";
import { isRetryableDownloadError } from "./github-download.mjs";
import { producingRun } from "./bundle-fetch.mjs";

const RUN = { repository: { full_name: "BenchBox-dev/BenchBox" }, path: ".github/workflows/site-inputs.yml", head_branch: "develop", event: "workflow_run", status: "in_progress", conclusion: null };

for (const conclusion of ["failure", "cancelled", "timed_out"]) {
  test(`${conclusion} fails without sleeping even with an unfinished status`, async () => {
    await assert.rejects(producingRun("503", {}, {
      fetchJson: async () => ({ ...RUN, conclusion }),
      sleep: () => assert.fail("must not sleep"),
    }), new RegExp(`concluded ${conclusion}`));
  });
}

for (const status of [undefined, "in_progress"]) {
  test(`success with status ${status} cannot bypass completion`, async () => {
    let clock = 0;
    await assert.rejects(producingRun("503", {}, {
      maxWaitMs: 100,
      now: () => clock,
      fetchJson: async () => ({ ...RUN, status, conclusion: "success" }),
      sleep: async (ms) => { clock += ms; },
      log: () => {},
    }), /wait cap/);
    assert.equal(clock, 100);
  });
}

test("API elapsed time consumes the deadline and clips the final sleep", async () => {
  let clock = 0;
  let calls = 0;
  const sleeps = [];
  await assert.rejects(producingRun("1", {}, {
    maxWaitMs: 15000,
    now: () => clock,
    fetchJson: async () => { calls += 1; clock += 4000; return RUN; },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    log: () => {},
  }), /15s wait cap/);
  assert.equal(clock, 15000);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [5000, 2000]);
});

test("a late successful API response cannot pass the deadline", async () => {
  let clock = 0;
  await assert.rejects(producingRun("1", {}, {
    maxWaitMs: 100,
    now: () => clock,
    fetchJson: async () => { clock = 101; return { ...RUN, status: "completed", conclusion: "success" }; },
    sleep: () => assert.fail("must not sleep"),
  }), /wait cap/);
});

test("the native fetch receives a deadline signal for a stalled request", async () => {
  const realFetch = globalThis.fetch;
  const keepAlive = setTimeout(() => {}, 1000);
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(producingRun("1", {}, { maxWaitMs: 20 }), /0.02s wait cap/);
  } finally {
    clearTimeout(keepAlive);
    globalThis.fetch = realFetch;
  }
});

test("numeric identifiers are not HTTP status codes", () => {
  assert.equal(isRetryableDownloadError(new Error("artifact 503 not found for run 500")), false);
  assert.equal(isRetryableDownloadError(new Error("run 403: read tcp: connection reset by peer")), true);
  assert.equal(isRetryableDownloadError(new Error("HTTP 403: connection reset by peer")), false);
  assert.equal(isRetryableDownloadError(new Error("HTTP 404: artifact 503 not found")), false);
});

for (const consumer of ["bundle", "receipt"]) {
  const scenarios = ["partial", "network", "403", "404", "exhausted"];
  if (consumer === "bundle") scenarios.push("digest");
  for (const scenario of scenarios) {
    test(`${consumer} process smoke: ${scenario}`, () => {
      const work = mkdtempSync(path.join(tmpdir(), "site-download-smoke-"));
      const root = fileURLToPath(new URL("../", import.meta.url));
      const stub = path.join(work, "gh");
      const archive = path.join(work, "bundle.tar.zst");
      const preload = path.join(work, "fetch.mjs");
      if (consumer === "bundle") {
        fixtureBundle({ dir: path.join(work, "site-inputs-bundle") });
        writeFileSync(archive, zstdCompressSync(execFileSync("tar", ["-cf", "-", "-C", work, "site-inputs-bundle"])));
        writeFileSync(preload, `
Atomics.wait = () => 'timed-out';
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => String(url).endsWith('/artifacts')
    ? { artifacts: [{ name: 'site-inputs-${FIXTURE_CORE}', expired: false }] }
    : String(url).endsWith('/runs/1')
      ? { path: '.github/workflows/trunk.yml', event: 'push', head_branch: 'develop', conclusion: 'success', head_sha: '${FIXTURE_CORE}' }
      : ${JSON.stringify({ ...RUN, status: "completed", conclusion: "success" })}
});
`);
      }
      writeFileSync(stub, `#!${process.execPath}\nimport { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const state = process.env.SMOKE_STATE;
const count = existsSync(state) ? Number(readFileSync(state, 'utf8')) + 1 : 1;
writeFileSync(state, String(count));
const args = process.argv.slice(2);
const dir = args[args.indexOf('-D') + 1];
const file = path.join(dir, process.env.SMOKE_ARCHIVE ? 'bundle.tar.zst' : 'receipt.json');
if (existsSync(file)) { console.error('file already exists'); process.exit(1); }
const scenario = process.env.SMOKE_SCENARIO;
if ((count === 1 && scenario !== 'digest') || scenario === 'exhausted') {
  writeFileSync(file, 'partial');
  console.error(scenario === 'network' ? 'read tcp: connection reset by peer' : 'HTTP ' + (['403', '404'].includes(scenario) ? scenario : '503') + ': download failed');
  process.exit(1);
}
if (process.env.SMOKE_ARCHIVE) copyFileSync(process.env.SMOKE_ARCHIVE, file);
else writeFileSync(file, JSON.stringify({run_id: '503'}));
`);
      chmodSync(stub, 0o755);
      const modulePath = new URL("../deploy/lib/github.ts", import.meta.url).href;
      const source = `import { downloadReceipt } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify(downloadReceipt('owner/repo', '503', {sleep: () => {}})));`;
      try {
        const args = consumer === "bundle"
          ? ["--import", preload, path.join(root, "scripts/bundle-fetch.mjs")]
          : ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source];
        const result = spawnSync(process.execPath, args, {
          cwd: root,
          env: { ...process.env, PATH: `${work}${path.delimiter}${process.env.PATH}`, SMOKE_STATE: path.join(work, "count"), SMOKE_SCENARIO: scenario, SMOKE_ARCHIVE: consumer === "bundle" ? archive : "", SITE_INPUTS_RUN_ID: "503", SITE_INPUTS: path.join(work, "fetched"), SITE_INPUTS_DIGEST: scenario === "digest" ? "sha256:wrong" : "" },
          encoding: "utf8",
          timeout: 10000,
        });
        const success = ["partial", "network"].includes(scenario);
        assert.equal(result.status, success ? 0 : 1, result.stderr);
        assert.equal(Number(readFileSync(path.join(work, "count"), "utf8")), success ? 2 : scenario === "exhausted" ? 3 : 1);
        assert.equal((result.stderr.match(/retrying in/g) ?? []).length, success ? 1 : scenario === "exhausted" ? 2 : 0);
        if (scenario === "digest") assert.match(result.stderr, /bundle digest .* does not match sha256:wrong/);
        if (success && consumer === "receipt") assert.deepEqual(JSON.parse(result.stdout), { run_id: "503" });
        if (success && consumer === "bundle") {
          const fetched = JSON.parse(readFileSync(path.join(work, "fetched/.fetched.json"), "utf8"));
          assert.equal(fetched.runId, "503");
          assert.match(fetched.digest, /^sha256:[a-f0-9]{64}$/);
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  }
}
