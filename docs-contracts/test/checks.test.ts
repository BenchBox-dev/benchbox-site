import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { claimPresent } from "../checks/counts.ts";
import { pythonPatternToJs } from "../checks/pages.ts";
import { resolveInvocation } from "../checks/commands.ts";
import { runChecks, type Mode } from "../lib/run.ts";
import type { Contracts } from "../lib/types.ts";
import { ROOTS, RELEASE_PATTERN, VERSION, buildContracts, buildPages, exclusionFile, writeBundle } from "./fixture.ts";

const CLI = path.resolve(import.meta.dirname, "..", "cli.ts");

type Seed = { name: string; check: string; page: string; contracts?: (contracts: Contracts) => void; pages?: (pages: Record<string, string>) => void };

function run(seed: { contracts?: (contracts: Contracts) => void; pages?: (pages: Record<string, string>) => void }, mode: Mode = "block", schema = 4) {
  const contracts = buildContracts();
  const pages = buildPages();
  seed.contracts?.(contracts);
  seed.pages?.(pages);
  const inputs = writeBundle({ schema, contracts, pages });
  return runChecks({ inputs, mode, allowSchema3: false });
}

function replace(pages: Record<string, string>, name: string, from: string, to: string): void {
  assert.ok(pages[name].includes(from), `${name} does not contain ${from}`);
  pages[name] = pages[name].replace(from, to);
}

const SEEDS: Seed[] = [
  { name: "platform registry count marker", check: "platform-counts", page: "platforms/comparison-matrix.md", pages: (p) => replace(p, "platforms/comparison-matrix.md", "**2** metadata entries", "**3** metadata entries") },
  { name: "support status snapshot row", check: "platform-status-snapshot", page: "platforms/support-status.md", pages: (p) => replace(p, "platforms/support-status.md", "| `stable` | 1 | 1 | 1 |", "| `stable` | 2 | 1 | 1 |") },
  { name: "registry counts comment", check: "platform-counts", page: "platforms/support-status.md", pages: (p) => replace(p, "platforms/support-status.md", "beta=1", "beta=9") },
  { name: "benchmark API snapshot marker", check: "benchmark-api-surface", page: "reference/public-contracts.md", pages: (p) => replace(p, "reference/public-contracts.md", "**2** public discovery entries", "**9** public discovery entries") },
  { name: "benchmark API surface row", check: "benchmark-api-surface", page: "reference/public-contracts.md", contracts: (c) => (c.benchmarks.api_surfaces.loader = "public") },
  { name: "public-contract source claim", check: "public-contract-claims", page: "reference/public-contracts.md", pages: (p) => replace(p, "reference/public-contracts.md", "Current result schema version: `1.0`", "Current result schema version: `0.9`") },
  { name: "benchmark count claim", check: "benchmark-count-claims", page: "usage/faq.md", pages: (p) => replace(p, "usage/faq.md", "**2**", "**22**") },
  { name: "benchmark status matrix query count", check: "benchmark-status-matrix", page: "benchmarks/support-status.md", pages: (p) => replace(p, "benchmarks/support-status.md", "22-query", "21-query") },
  { name: "benchmark status matrix DataFrame claim", check: "benchmark-status-matrix", page: "benchmarks/support-status.md", pages: (p) => replace(p, "benchmarks/support-status.md", "99-query suite; not DataFrame-capable", "99-query suite; DataFrame-capable") },
  { name: "public API symbol without heading", check: "api-symbols", page: "reference/python-api/", pages: (p) => (p["reference/python-api/index.md"] = "# API\n\n## Other\n") },
  { name: "platform option value rejected", check: "platform-option-examples", page: "usage/options.md", pages: (p) => replace(p, "usage/options.md", "threads=4", "threads=many") },
  { name: "platform option choice rejected", check: "platform-option-examples", page: "usage/options.md", pages: (p) => replace(p, "usage/options.md", "mode=fast", "mode=slow") },
  { name: "platform option boolean rejected", check: "platform-option-examples", page: "usage/options.md", pages: (p) => replace(p, "usage/options.md", "read_only=true", "read_only=maybe") },
  { name: "unknown platform option", check: "platform-option-examples", page: "usage/options.md", pages: (p) => replace(p, "usage/options.md", "threads=4", "thread_count=4") },
  { name: "deprecated platform option spelling", check: "platform-option-examples", page: "platforms/snowflake.md", pages: (p) => replace(p, "platforms/snowflake.md", "warehouse=WH", "old_mode=x") },
  { name: "deployment option replaced by selector", check: "platform-option-examples", page: "platforms/snowflake.md", contracts: (c) => (c.platform_options.platforms.snowflake.deployment_mode = { value_kind: "string", choices: null, default: null, aliases: [] }), pages: (p) => replace(p, "platforms/snowflake.md", "warehouse=WH", "deployment_mode=x") },
  { name: "option that no platform accepts", check: "platform-option-examples", page: "usage/options.md", pages: (p) => replace(p, "usage/options.md", "`--platform-option memory_limit=2GB`", "`--platform-option vanished_option=2GB`") },
  { name: "help catalog example rejected", check: "platform-option-examples", page: "cli help catalog run/examples", contracts: (c) => (c.cli.help_catalog.command_examples.run.examples = ["benchbox run --platform duckdb --platform-option threads=lots"]) },
  { name: "quickstart unknown command", check: "quickstart-commands", page: "usage/getting-started.md", pages: (p) => replace(p, "usage/getting-started.md", "benchbox profile", "benchbox profiles") },
  { name: "quickstart unknown option", check: "quickstart-commands", page: "usage/getting-started.md", pages: (p) => replace(p, "usage/getting-started.md", "--benchmark tpch", "--bench tpch") },
  { name: "quickstart unknown extra", check: "quickstart-extras", page: "usage/getting-started.md", pages: (p) => replace(p, "usage/getting-started.md", "--extra duckdb", "--extra missing-extra") },
  { name: "setup command removed", check: "quickstart-commands", page: "platforms/singlestore.md", contracts: (c) => (c.cli.commands = c.cli.commands.filter((command) => command.path !== "benchbox setup")) },
  { name: "SF1 calibrated size drift", check: "sf1-sizes", page: "benchmarks/sf1-calibrated-sizes.md", pages: (p) => replace(p, "benchmarks/sf1-calibrated-sizes.md", "| ssb | 510 |", "| ssb | 900 |") },
  { name: "SF1 benchmark missing from table", check: "sf1-sizes", page: "benchmarks/sf1-calibrated-sizes.md", pages: (p) => replace(p, "benchmarks/sf1-calibrated-sizes.md", "| ssb | 510 |\n", "") },
  { name: "sketch storage claim outside bound", check: "sketch-bounds", page: "benchmarks/write-primitives-sketch-functions.md", pages: (p) => replace(p, "benchmarks/write-primitives-sketch-functions.md", "4314 bytes", "9999 bytes") },
  { name: "MCP tool missing from inventory", check: "mcp-tool-inventory", page: "reference/mcp.md", pages: (p) => replace(p, "reference/mcp.md", "| `run_benchmark` | run |\n", "") },
  { name: "MCP remote tool missing", check: "mcp-tool-inventory", page: "reference/mcp.md", pages: (p) => replace(p, "reference/mcp.md", "| `admin_reset` | reset |", "") },
  { name: "MCP parameter default drift", check: "mcp-tool-params", page: "reference/mcp.md", pages: (p) => replace(p, "reference/mcp.md", "| `scale_factor` | number | No | 1 |", "| `scale_factor` | number | No | 2 |") },
  { name: "MCP parameter required drift", check: "mcp-tool-params", page: "reference/mcp.md", contracts: (c) => (c.mcp.tools.run_benchmark.params.benchmark.required = false) },
  { name: "execution engine missing from guide", check: "execution-vocabulary", page: "platforms/velox.md", pages: (p) => (p["platforms/velox.md"] = "Engines: `alpha`.\n") },
  { name: "compute option not accepted", check: "compute-resource-guides", page: "platforms/redshift.md", contracts: (c) => delete c.platform_options.platforms.redshift.compute_size, pages: (p) => (p["platforms/redshift.md"] = "`--platform-option compute_size=small`\n") },
  { name: "release marker version drift", check: "version-token", page: "README.md", pages: (p) => replace(p, "README.md", `v${VERSION}`, "v1.2.2") },
  { name: "install page claims DuckDB default", check: "install-surface", page: "usage/faq.md", pages: (p) => (p["usage/faq.md"] += "DuckDB is included with BenchBox by default.\n") },
  { name: "required page not published", check: "page-present", page: "design/architecture.md", pages: (p) => delete p["design/architecture.md"] },
];

describe("seeded documentation drift fails with the page and the violated invariant", () => {
  for (const seed of SEEDS) {
    it(seed.name, () => {
      const outcome = run(seed);
      const hit = outcome.blocking.find((violation) => violation.check === seed.check && violation.page === seed.page);
      assert.ok(hit, `expected ${seed.check} on ${seed.page}, got ${JSON.stringify(outcome.blocking, null, 1)}`);
      assert.notEqual(hit.invariant, "");
    });
  }

  it("leaves a clean fixture with no violation", () => {
    assert.deepEqual(run({}), { blocking: [], reported: [], notes: [] });
  });
});

describe("contract-internal consistency", () => {
  const CASES: [string, string, (contracts: Contracts) => void][] = [
    ["package version differing from the manifest", "package-version", (c) => (c.package.version = "9.9.9")],
    ["platform count summary not matching entries", "platform-counts", (c) => (c.platforms.count_summary.sql_capable = 5)],
    ["platform status snapshot not matching entries", "platform-status-snapshot", (c) => (c.platforms.support_status_snapshot.beta.entries = 4)],
    ["platform manifest key missing", "platform-manifest", (c) => c.platform_manifest.entries.pop()],
    ["benchmark registry summary not matching ids", "benchmark-counts", (c) => (c.benchmarks.registry_summary.total = 9)],
    ["spec id that is not public", "benchmark-ids", (c) => c.benchmarks.spec_ids.push("hidden")],
    ["allowlisted page that is also excluded", "publication-lists", (c) => c.publication.exclusions.push("development/open.md")],
    ["gated page neither published nor excluded", "publication-lists", (c) => c.publication.gated_pages.push("development/orphan.md")],
    ["ownership count not matching the list", "ownership", (c) => (c.ownership.counts["site-owned"] = 5)],
    ["SF1 sizes not matching measurable ids", "sf1-sizes", (c) => delete c.sf1_calibrated_sizes.sizes.ssb],
    ["duplicate public symbol", "public-symbols", (c) => c.public_symbols.symbols.push(c.public_symbols.symbols[0])],
    ["command without a parent group", "cli-commands", (c) => c.cli.commands.push({ path: "benchbox ghost child", is_group: false, options: [] })],
    ["tuning verification flag contradicting its inputs", "tuning-support", (c) => (c.tuning.platforms.duckdb.can_reach_applied_verified = false)],
    ["tool both local and remote-only", "mcp-tools", (c) => c.mcp.remote_only_tools.push("list_available")],
  ];
  for (const [name, check, mutate] of CASES) {
    it(`flags ${name}`, () => {
      for (const mode of ["block", "report"] as const) {
        const outcome = run({ contracts: mutate }, mode);
        assert.ok(
          outcome.blocking.some((violation) => violation.check === check && violation.page === "doc-contracts.json"),
          `${mode}: ${JSON.stringify(outcome.blocking)}`,
        );
      }
    });
  }
});

describe("publication boundary", () => {
  it("fails when core stops excluding a maintainer-only directory", () => {
    const pages = buildPages();
    const inputs = writeBundle({ schema: 4, pages, exclusions: exclusionFile(["_project", "internal"], ["development/closed.md"]) });
    const outcome = runChecks({ inputs, mode: "block", allowSchema3: false });
    const paths = outcome.blocking.filter((violation) => violation.check === "publication-boundary").map((violation) => violation.page);
    assert.deepEqual(paths, ["agent/notes.md", "agent/notes.md"]);
  });

  it("fails when a gated page is published without an allowlist entry", () => {
    const pages = buildPages();
    const inputs = writeBundle({ schema: 4, pages, exclusions: exclusionFile(ROOTS), allowlist: "development/open.md\ndevelopment/closed.md\ndevelopment/result-integrity-validation.md\n" });
    const outcome = runChecks({ inputs, mode: "block", allowSchema3: false });
    assert.ok(outcome.blocking.some((violation) => violation.page === "development/closed.md" && violation.check === "publication-boundary"));
  });

  it("fails when the exported lists and the published pages disagree about the allowlist", () => {
    const outcome = run({ contracts: (c) => c.publication.allowlist.push("development/ghost.md") });
    assert.ok(outcome.blocking.some((violation) => violation.page === "development/ghost.md"));
  });
});

describe("modes and bundle schemas", () => {
  it("reports documentation drift without blocking in report mode", () => {
    const outcome = run({ pages: (p) => replace(p, "usage/faq.md", "**2**", "**22**") }, "report");
    assert.deepEqual(outcome.blocking, []);
    assert.ok(outcome.reported.some((violation) => violation.check === "benchmark-count-claims"));
  });

  it("skips contract checks on a schema 3 bundle only when schema 3 is allowed", () => {
    const inputs = writeBundle({ schema: 3, contracts: null, pages: buildPages() });
    const allowed = runChecks({ inputs, mode: "block", allowSchema3: true });
    assert.deepEqual(allowed.blocking, []);
    assert.match(allowed.notes.join("\n"), /schema 3 bundle carries no doc-contracts\.json/);
    const strict = runChecks({ inputs, mode: "block", allowSchema3: false });
    assert.deepEqual(strict.blocking.map((violation) => violation.check), ["contracts-present"]);
  });

  it("still enforces the negative ownership guard on a schema 3 bundle", () => {
    const inputs = writeBundle({ schema: 3, contracts: null, pages: buildPages(), exclusions: exclusionFile(["_project", "internal"], ["development/closed.md"]) });
    const blocking = runChecks({ inputs, mode: "block", allowSchema3: true });
    assert.deepEqual(blocking.blocking.map((violation) => violation.page), ["agent/notes.md"]);
    const reported = runChecks({ inputs, mode: "report", allowSchema3: true });
    assert.deepEqual(reported.blocking, []);
    assert.deepEqual(reported.reported.map((violation) => violation.page), ["agent/notes.md"]);
  });

  it("fails a schema 4 bundle without doc-contracts.json even when schema 3 is allowed", () => {
    const inputs = writeBundle({ schema: 4, contracts: null, pages: buildPages() });
    const outcome = runChecks({ inputs, mode: "report", allowSchema3: true });
    assert.deepEqual(outcome.blocking.map((violation) => violation.check), ["contracts-present"]);
  });

  it("fails when there is no documentation tree to check", () => {
    const inputs = writeBundle({ schema: 4, pages: buildPages() });
    const outcome = runChecks({ inputs, docs: path.join(inputs, "missing"), mode: "block", allowSchema3: false });
    assert.deepEqual(outcome.blocking.map((violation) => violation.check), ["docs-present"]);
  });

  it("checks a documentation tree passed by path instead of the bundle docs", () => {
    const inputs = writeBundle({ schema: 5, pages: { "README.md": "# Empty\n" } });
    const docs = writeBundle({ schema: 4, pages: buildPages() });
    const outcome = runChecks({ inputs, docs: path.join(docs, "docs"), mode: "block", allowSchema3: false });
    assert.equal(outcome.blocking.length, 0, JSON.stringify(outcome.blocking));
  });

  it("reports an unreadable check as a violation instead of crashing", () => {
    const outcome = run({ contracts: (c) => ((c as unknown as Record<string, unknown>).cli = null) });
    assert.ok(outcome.blocking.some((violation) => violation.invariant.includes("could not run")));
  });

  it("fails a release marker the checker cannot translate", () => {
    const outcome = run({ contracts: (c) => (c.package.release_marker.flags = 8) });
    assert.ok(outcome.blocking.some((violation) => violation.invariant.includes("cannot translate")));
  });
});

describe("helpers", () => {
  it("translates the exported Python release marker", () => {
    const marker = pythonPatternToJs({ pattern: RELEASE_PATTERN, flags: 34, version_group: "version" });
    const match = [..."Current release: `v0.5.0rc1`.".matchAll(marker)][0];
    assert.equal(match.groups?.version, "0.5.0rc1");
    assert.equal([..."current RELEASE v1.2.3".matchAll(marker)].length, 1);
  });

  it("matches count claims only on numeric boundaries", () => {
    assert.ok(claimPresent("Explore 22 benchmarks (TPC-H)", "22 benchmarks (TPC"));
    assert.ok(!claimPresent("Explore 122 benchmarks (TPC-H)", "22 benchmarks (TPC"));
    assert.ok(!claimPresent("Specs cover 120 of 22 benchmarks", "20 of 22 benchmarks"));
  });

  it("resolves benchbox invocations against the exported command tree", () => {
    const commands = new Map(buildContracts().cli.commands.map((command) => [command.path, command]));
    assert.equal(resolveInvocation(commands, ["run", "--platform", "duckdb", "--force"]), null);
    assert.equal(resolveInvocation(commands, ["--version"]), null);
    assert.equal(resolveInvocation(commands, ["run", "--help"]), null);
    assert.match(resolveInvocation(commands, ["nope"]) ?? "", /no command nope/);
    assert.match(resolveInvocation(commands, ["run", "--missing"]) ?? "", /not an option/);
  });
});

describe("command line", () => {
  const invoke = (args: string[]) =>
    spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", CLI, ...args], { encoding: "utf-8" });

  it("exits 0 for a clean bundle and 1 for blocking drift", () => {
    const clean = writeBundle({ schema: 4, pages: buildPages() });
    assert.equal(invoke(["--inputs", clean]).status, 0);
    const pages = buildPages();
    replace(pages, "usage/faq.md", "**2**", "**22**");
    const drifted = writeBundle({ schema: 4, pages });
    const blocked = invoke(["--inputs", drifted]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /\[benchmark-count-claims\] usage\/faq\.md: registry-derived claim is missing or stale/);
    const reported = invoke(["--inputs", drifted, "--docs-mode", "report"]);
    assert.equal(reported.status, 0);
    assert.match(reported.stderr, /report-only \[benchmark-count-claims\]/);
  });

  it("exits 0 for a schema 3 bundle with --allow-schema3 and 1 without it", () => {
    const inputs = writeBundle({ schema: 3, contracts: null, pages: buildPages() });
    assert.equal(invoke(["--inputs", inputs, "--allow-schema3"]).status, 0);
    assert.equal(invoke(["--inputs", inputs]).status, 1);
  });

  it("exits 2 for a missing bundle or a bad mode", () => {
    assert.equal(invoke(["--inputs", path.join(writeBundle({ schema: 4, pages: {} }), "nope")]).status, 2);
    assert.equal(invoke(["--docs-mode", "maybe"]).status, 2);
  });
});

describe("a real schema 4 bundle", { skip: !existsSync(process.env.DOC_CONTRACTS_SCHEMA4_BUNDLE ?? "/nonexistent") }, () => {
  it("passes every check", () => {
    const outcome = runChecks({ inputs: process.env.DOC_CONTRACTS_SCHEMA4_BUNDLE as string, mode: "block", allowSchema3: false });
    assert.deepEqual(outcome.blocking, []);
    assert.deepEqual(outcome.reported, []);
  });
});
