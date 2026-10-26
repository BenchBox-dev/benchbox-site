import { fencedBlocks, shellWords, stripFences } from "../lib/markdown.ts";
import type { Context, Contracts, Violation } from "../lib/types.ts";

const INLINE = /`([^`\n]*--platform-option[^`\n]*)`/g;
const PLACEHOLDER = /[<>{}]|\.\.\./;
const PLACEHOLDER_KEY = /^[A-Z_]+$/;
const SHELL_SAMPLES = ["1", "true", "1.0"];
const EXCLUDED_PAGES = ["blog/"];
const DEPRECATION_NOTES = new Set(["platforms/clickhouse-migration.md\0deployment_mode"]);

type Example = { path: string; platform: string | null; pairs: [string, string][] };
type Spec = Contracts["platform_options"]["platforms"][string][string];

function alternatives(assignment: string): [string, string][] {
  const split = assignment.indexOf("=");
  const key = assignment.slice(0, split);
  const value = assignment.slice(split + 1);
  if (!value.includes("|")) return [[key, value]];
  return value.replace(/^[[\]]+|[[\]]+$/g, "").split("|").map((choice): [string, string] => [key, choice]);
}

function exampleFor(path: string, command: string): Example | null {
  const tokens = shellWords(command);
  let platform: string | null = null;
  let pairs: [string, string][] = [];
  tokens.forEach((token, index) => {
    const following = tokens[index + 1] ?? "";
    if (token === "--platform") platform = following;
    else if (token.startsWith("--platform=")) platform = token.slice("--platform=".length);
    else if (token === "--platform-option" && following.includes("=")) pairs = pairs.concat(alternatives(following));
    else if (token.startsWith("--platform-option=") && token.split("=").length >= 3) pairs = pairs.concat(alternatives(token.slice("--platform-option=".length)));
  });
  pairs = pairs.filter(([key, value]) => !(PLACEHOLDER_KEY.test(key) || PLACEHOLDER.test(key + value)));
  if (platform !== null && PLACEHOLDER.test(platform)) platform = null;
  return pairs.length === 0 ? null : { path, platform, pairs };
}

function blockCommands(block: string): string[] {
  return block.replace(/\\\n/g, " ").split("\n").filter((line) => line.includes("--platform-option"));
}

function pageCommands(text: string): string[] {
  const commands = fencedBlocks(text).flatMap(blockCommands);
  for (const match of stripFences(text).matchAll(INLINE)) commands.push(match[1]);
  return commands;
}

export function collectExamples(ctx: Context): Example[] {
  const examples: Example[] = [];
  for (const entry of ctx.pages) {
    if (EXCLUDED_PAGES.some((prefix) => entry.path.startsWith(prefix))) continue;
    for (const command of pageCommands(entry.text)) {
      const example = exampleFor(entry.path, command);
      if (example !== null) examples.push(example);
    }
  }
  for (const [command, sections] of Object.entries(ctx.contracts.cli.help_catalog.command_examples)) {
    for (const [name, lines] of Object.entries(sections)) {
      for (const line of blockCommands(lines.join("\n"))) {
        const example = exampleFor(`cli help catalog ${command}/${name}`, line);
        if (example !== null) examples.push(example);
      }
    }
  }
  return examples;
}

function parsesAs(spec: Spec, raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const text = raw.trim();
  let value: unknown = raw;
  switch (spec.value_kind) {
    case "boolean": {
      const lowered = text.toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(lowered)) value = true;
      else if (["false", "0", "no", "n", "off"].includes(lowered)) value = false;
      else return { ok: false, message: `Invalid boolean value '${raw}'` };
      break;
    }
    case "integer":
    case "port": {
      if (!/^[+-]?\d+(_\d+)*$/.test(text)) return { ok: false, message: `Invalid integer value '${raw}'` };
      value = Number(text.replace(/_/g, ""));
      if (spec.value_kind === "port" && ((value as number) < 1 || (value as number) > 65535)) return { ok: false, message: `Invalid port '${raw}'` };
      break;
    }
    case "number": {
      if (typeof spec.default !== "number") break;
      if (!/^[+-]?(\d+(_\d+)*\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i.test(text)) return { ok: false, message: `Invalid number '${raw}'` };
      value = Number(text.replace(/_/g, ""));
      break;
    }
    default:
      break;
  }
  if (spec.choices !== null && spec.choices.length > 0) {
    const shown = String(value);
    if (!spec.choices.includes(shown) && !spec.choices.some((choice) => choice.toLowerCase() === shown.toLowerCase())) {
      return { ok: false, message: `Invalid value '${raw}'. Allowed values: ${spec.choices.join(", ")}` };
    }
  }
  return { ok: true, value };
}

export function optionResolver(contracts: Contracts) {
  const manifestAliases = contracts.platform_manifest.aliases;
  const normalize = (name: string): string => {
    const lowered = name.toLowerCase();
    return manifestAliases[lowered] ?? lowered;
  };
  const split = (raw: string): [string, string | null] => {
    const key = normalize(raw);
    if (!key.includes(":")) return [key, null];
    const [base, ...rest] = key.split(":");
    const resolved = normalize(base);
    if (resolved in contracts.execution.deployment_alias_keys) return [resolved, rest.join(":")];
    return [key, null];
  };

  const check = (platformRaw: string, pairs: [string, string][], path: string): string | null => {
    const [platform] = split(platformRaw);
    const specs = contracts.platform_options.platforms[platform];
    if (specs === undefined || Object.keys(specs).length === 0) return `platform '${platform}' does not accept platform-specific options`;
    const aliasIndex = contracts.platform_options.alias_index[platform] ?? {};
    const deployment = contracts.execution.deployment_alias_keys[platform] ?? [];
    const legacy = contracts.execution.deprecated_option_aliases.filter((entry) => entry.platform === platform).map((entry) => entry.key);
    const compute = contracts.execution.compute[platform];
    const computeAliases = new Set([...(compute?.resource_aliases ?? []), ...(compute?.size_aliases ?? [])]);
    const seen = new Map<string, unknown>();
    for (const [typed, rawValue] of pairs) {
      const lowered = typed.toLowerCase();
      const canonical = lowered in specs ? lowered : (aliasIndex[lowered] ?? lowered);
      if (!(canonical in specs)) return `unknown platform option '${typed}' for platform '${platform}'. Available: ${Object.keys(specs).sort().join(", ")}`;
      let value = rawValue;
      if (value.includes("$")) {
        const sample = SHELL_SAMPLES.find((candidate) => parsesAs(specs[canonical], candidate).ok);
        if (sample !== undefined) value = sample;
      }
      const parsed = parsesAs(specs[canonical], value);
      if (!parsed.ok) return `${parsed.message} for option '${canonical}'`;
      if (seen.has(canonical) && seen.get(canonical) !== parsed.value) return `conflicting values for platform option '${canonical}'`;
      seen.set(canonical, parsed.value);
      if (DEPRECATION_NOTES.has(`${path}\0${typed}`)) continue;
      const nonCanonical = lowered !== canonical;
      if (deployment.includes(lowered) || deployment.includes(canonical) || legacy.includes(lowered) || (nonCanonical && computeAliases.has(lowered))) {
        return `'${typed}' is a deprecated spelling or deployment option`;
      }
    }
    return null;
  };
  return { check, split };
}

export function optionViolations(ctx: Context): Violation[] {
  const found: Violation[] = [];
  const { check } = optionResolver(ctx.contracts);
  const platforms = Object.keys(ctx.contracts.platform_options.platforms).sort();
  for (const example of collectExamples(ctx)) {
    const exempt = (key: string): boolean => DEPRECATION_NOTES.has(`${example.path}\0${key}`);
    if (example.platform !== null) {
      const pairs = example.pairs.filter(([key]) => !exempt(key));
      if (pairs.length === 0) continue;
      const problem = check(example.platform, pairs, example.path);
      if (problem !== null) {
        found.push({ check: "platform-option-examples", page: example.path, invariant: `--platform ${example.platform} ${pairs.map(([key, value]) => `${key}=${value}`).join(" ")}: ${problem}` });
      }
      continue;
    }
    for (const pair of example.pairs) {
      if (exempt(pair[0])) continue;
      if (!platforms.some((platform) => check(platform, [pair], example.path) === null)) {
        found.push({ check: "platform-option-examples", page: example.path, invariant: `--platform-option ${pair[0]}=${pair[1]} is accepted by no platform without a deprecation` });
      }
    }
  }
  return found;
}
