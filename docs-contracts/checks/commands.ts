import { bashBlocks, section, shellWords } from "../lib/markdown.ts";
import { optionResolver } from "./options.ts";
import { page, type Context, type Contracts, type Violation } from "../lib/types.ts";

const COMMAND_PAGES = ["usage/getting-started.md", "platforms/singlestore.md", "usage/cli-quick-start.md"];
const PLACEHOLDER_VALUE = /^[A-Z][A-Z0-9_]*$|\$/;

type Command = Contracts["cli"]["commands"][number];

export function invocations(text: string): string[][] {
  const found: string[][] = [];
  for (const block of bashBlocks(text)) {
    for (const raw of block.replace(/\\\n/g, " ").split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const parts = shellWords(line);
      const index = parts.indexOf("benchbox");
      if (index < 0) continue;
      if (!(index === 0 || parts[index - 1] === "--")) continue;
      const rest = parts.slice(index + 1);
      if (rest.some((part) => part.includes("<") || part.includes(">"))) continue;
      if (rest.length > 0) found.push(rest);
    }
  }
  return found;
}

type PlatformCheck = (value: string) => boolean;

function valueProblem(node: Command, option: Command["options"][number], value: string, knownPlatform: PlatformCheck | undefined): string | null {
  if (PLACEHOLDER_VALUE.test(value)) return null;
  if (option.choices !== null && option.choices.length > 0) {
    return option.choices.includes(value) ? null : `${option.names[0]} value '${value}' is not one of ${option.choices.join(", ")} for ${node.path}`;
  }
  if (option.names.includes("--platform") && knownPlatform !== undefined && !knownPlatform(value)) return `--platform value '${value}' is not a known platform`;
  return null;
}

export function resolveInvocation(commands: Map<string, Command>, argv: string[], knownPlatform?: PlatformCheck): string | null {
  let node = commands.get("benchbox");
  if (node === undefined) return "the command tree has no benchbox root";
  let pending: { node: Command; option: Command["options"][number] } | null = null;
  for (const token of argv) {
    if (pending !== null) {
      const problem = valueProblem(pending.node, pending.option, token, knownPlatform);
      pending = null;
      if (problem !== null) return problem;
      continue;
    }
    if (token === "--") continue;
    if (token.startsWith("-")) {
      const name = token.split("=")[0];
      if (name === "--help") continue;
      const option = node.options.find((candidate) => candidate.names.includes(name));
      if (option === undefined) return `option ${name} is not an option of ${node.path}`;
      if (!option.is_flag) {
        if (token.includes("=")) {
          const problem = valueProblem(node, option, token.slice(token.indexOf("=") + 1), knownPlatform);
          if (problem !== null) return problem;
        } else pending = { node, option };
      }
      continue;
    }
    const child = commands.get(`${node.path} ${token}`);
    if (child !== undefined) node = child;
    else if (node.is_group) return `${node.path} has no command ${token}`;
  }
  return null;
}

export function commandViolations(ctx: Context): Violation[] {
  const found: Violation[] = [];
  const commands = new Map(ctx.contracts.cli.commands.map((command) => [command.path, command]));
  const { split } = optionResolver(ctx.contracts);
  const knownPlatform: PlatformCheck = (value) => split(value)[0] in ctx.contracts.platforms.entries;
  for (const path of COMMAND_PAGES) {
    const entry = page(ctx, path);
    if (entry === undefined) {
      found.push({ check: "page-present", page: path, invariant: "page named by a contract check is not published" });
      continue;
    }
    const examples = invocations(entry.text);
    if (path === COMMAND_PAGES[0] && examples.length === 0) found.push({ check: "quickstart-commands", page: path, invariant: "no benchbox command found in the quickstart fences" });
    for (const argv of examples) {
      const problem = resolveInvocation(commands, argv, knownPlatform);
      if (problem !== null) found.push({ check: "quickstart-commands", page: path, invariant: `benchbox ${argv.join(" ")}: ${problem}` });
    }
  }
  const quickstart = page(ctx, COMMAND_PAGES[0]);
  if (quickstart !== undefined) {
    const stepOne = section(quickstart.text, "## Step 1", "## Step 2");
    const extras = ctx.contracts.package.optional_extras;
    if (stepOne === null) found.push({ check: "quickstart-extras", page: COMMAND_PAGES[0], invariant: "Step 1 section is missing" });
    else {
      const named = [...stepOne.matchAll(/--extra\s+([A-Za-z0-9_-]+)|benchbox\[([A-Za-z0-9_,-]+)\]/g)].flatMap((match) => (match[1] ?? match[2]).split(","));
      if (!named.includes("duckdb")) found.push({ check: "quickstart-extras", page: COMMAND_PAGES[0], invariant: "Step 1 does not pin the duckdb extra" });
      for (const extra of named) {
        if (!extras.includes(extra)) found.push({ check: "quickstart-extras", page: COMMAND_PAGES[0], invariant: `extra ${extra} is not in package.optional_extras` });
      }
    }
  }
  return found;
}

const MCP_PAGE = "reference/mcp.md";

function normalizeDefault(value: string): unknown {
  const cleaned = value.trim();
  if (cleaned === "-") return null;
  const bare = cleaned.replace(/^`|`$/g, "");
  if (bare === "null") return null;
  if (bare === '""') return "";
  if (bare === "false") return false;
  if (bare === "true") return true;
  if (/^[+-]?\d+$/.test(bare)) return Number(bare);
  if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(bare)) return Number(bare);
  return bare;
}

function paramsTable(markdown: string): Record<string, { type: string; required: boolean; default: unknown }> {
  const params: Record<string, { type: string; required: boolean; default: unknown }> = {};
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const columns = line.replace(/^\||\|$/g, "").split("|").map((column) => column.trim());
    params[columns[0].replace(/`/g, "")] = { type: columns[1], required: columns[2].startsWith("Yes"), default: normalizeDefault(columns[3] ?? "-") };
  }
  return params;
}

function toolSection(text: string, tool: string): string | null {
  const heading = new RegExp(`^#### \`${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`\\s*$`, "m").exec(text);
  if (heading === null) return null;
  const rest = text.slice(heading.index + heading[0].length);
  const next = /^(##|###|####) /m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

function inventory(block: string | null): Set<string> {
  return new Set([...(block ?? "").matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]));
}

export function mcpViolations(ctx: Context): Violation[] {
  const entry = page(ctx, MCP_PAGE);
  if (entry === undefined) return [{ check: "page-present", page: MCP_PAGE, invariant: "page named by a contract check is not published" }];
  const found: Violation[] = [];
  const fail = (check: string, invariant: string): void => {
    found.push({ check, page: MCP_PAGE, invariant });
  };
  const { mcp } = ctx.contracts;
  const text = entry.text;
  const local = section(text, "### Actual Tool Inventory", "### Run Surface Contract");
  const documentedLocal = inventory(local === null ? null : local.split("Authenticated remote mode additionally registers:")[0]);
  const documentedRemote = inventory(section(text, "Authenticated remote mode additionally registers:", "### Run Surface Contract"));
  if (local === null) fail("mcp-tool-inventory", "tool inventory section is missing");
  for (const tool of Object.keys(mcp.tools)) if (!documentedLocal.has(tool)) fail("mcp-tool-inventory", `registered tool ${tool} is not in the documented inventory`);
  for (const tool of documentedLocal) if (!(tool in mcp.tools)) fail("mcp-tool-inventory", `documented tool ${tool} is not registered`);
  for (const tool of mcp.remote_only_tools) if (!documentedRemote.has(tool)) fail("mcp-tool-inventory", `remote-only tool ${tool} is not in the documented remote inventory`);
  for (const tool of documentedRemote) if (!mcp.remote_only_tools.includes(tool)) fail("mcp-tool-inventory", `documented remote tool ${tool} is not registered as remote-only`);
  for (const [tool, definition] of Object.entries(mcp.tools)) {
    const markdown = tool === "run_benchmark" ? section(text, "**MCP run parameter schema:**", "**Behavior:**") : toolSection(text, tool);
    if (markdown === null) {
      fail("mcp-tool-params", `no parameter table for ${tool}`);
      continue;
    }
    const documented = paramsTable(markdown);
    for (const [name, expected] of Object.entries(definition.params)) {
      const actual = documented[name];
      if (actual === undefined) fail("mcp-tool-params", `${tool}.${name} is not documented`);
      else if (actual.type !== expected.type || actual.required !== expected.required || actual.default !== expected.default) {
        fail("mcp-tool-params", `${tool}.${name} documents type=${actual.type} required=${actual.required} default=${JSON.stringify(actual.default)}, contracts give type=${expected.type} required=${expected.required} default=${JSON.stringify(expected.default)}`);
      }
    }
    for (const name of Object.keys(documented)) if (!(name in definition.params)) fail("mcp-tool-params", `${tool}.${name} is documented but not a parameter`);
  }
  return found;
}
