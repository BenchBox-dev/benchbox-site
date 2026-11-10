import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type PathPrivacyCase = {
  id: string;
  text: string;
  roots?: string[];
  home?: boolean;
  leak: boolean;
};

export type PathPrivacyContract = {
  schema_version: number;
  known_roots: string[];
  drive_letter: {
    separators: string[];
    double_slash_excluded_for_forward: boolean;
  };
  unc: {
    prefixes: string[];
  };
  placeholder_allowlist: string[];
  redacted_placeholder: string;
  home_root: {
    scanned_as_root: boolean;
    synthetic_home: string;
  };
  pattern: {
    source: string;
    flags: number;
  };
  cases: PathPrivacyCase[];
};

export const KNOWN_ROOTS = [
  "/Users",
  "/Volumes",
  "/home",
  "/mnt",
  "/opt",
  "/private",
  "/root",
  "/tmp",
  "/var/folders",
  "/var/run",
  "~",
];

export const NEUTRAL_PLACEHOLDERS = new Set(["/data", "/output"]);
export const REDACTED_PLACEHOLDER = "<redacted>";

const PATH_TAIL = String.raw`[^\s'",;)]*`;
const PATH_BOUNDARY = String.raw`(?=[/\\\s'",;)\]}]|$)`;
const LOCAL_ROOTS = "~|/Users|/home|/root|/private|/var/folders|/var/run|/Volumes|/tmp|/mnt|/opt";

export const PRIVATE_LOCAL_PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9_])(?:(?:${LOCAL_ROOTS})/${PATH_TAIL}|[A-Za-z]:\\${PATH_TAIL}|[A-Za-z]:/(?!/)${PATH_TAIL})` +
    String.raw`|(?<![A-Za-z0-9_\\])\\{2,}[A-Za-z0-9_.$-]+\\+${PATH_TAIL}` +
    String.raw`|(?<![A-Za-z0-9_:/\\])//[A-Za-z0-9_.$-]+/[A-Za-z0-9_.$-]+${PATH_TAIL}`,
  "gi",
);

export function loadPathPrivacyContract(inputsDir?: string): PathPrivacyContract {
  const dir = inputsDir ?? process.env.SITE_INPUTS ?? path.join(import.meta.dirname, "..", "..", ".site-inputs");
  const contractPath = path.join(dir, "doc-contracts.json");
  if (!existsSync(contractPath)) {
    throw new Error(`Path privacy contract is missing at ${contractPath}`);
  }
  const parsed = JSON.parse(readFileSync(contractPath, "utf8")) as { path_privacy?: PathPrivacyContract };
  if (!parsed.path_privacy) {
    throw new Error(`doc-contracts.json at ${contractPath} does not define path_privacy`);
  }
  return parsed.path_privacy;
}

export function tryLoadPathPrivacyContract(inputsDir?: string): PathPrivacyContract | null {
  try {
    return loadPathPrivacyContract(inputsDir);
  } catch {
    return null;
  }
}

export function pathPrivacyDrift(contract: PathPrivacyContract): string[] {
  const drift: string[] = [];
  const expectedRoots = [...contract.known_roots].sort();
  const actualRoots = [...KNOWN_ROOTS].sort();
  if (JSON.stringify(actualRoots) !== JSON.stringify(expectedRoots)) {
    drift.push(`known_roots drift: contract has [${expectedRoots.join(", ")}], live gate has [${actualRoots.join(", ")}]`);
  }
  const expectedPlaceholders = [...contract.placeholder_allowlist].sort();
  const actualPlaceholders = [...NEUTRAL_PLACEHOLDERS].sort();
  if (JSON.stringify(actualPlaceholders) !== JSON.stringify(expectedPlaceholders)) {
    drift.push(`placeholder_allowlist drift: contract has [${expectedPlaceholders.join(", ")}], live gate has [${actualPlaceholders.join(", ")}]`);
  }
  if (contract.redacted_placeholder !== REDACTED_PLACEHOLDER) {
    drift.push(`redacted_placeholder drift: contract has '${contract.redacted_placeholder}', live gate has '${REDACTED_PLACEHOLDER}'`);
  }
  for (const c of contract.cases ?? []) {
    const roots = [...(c.roots ?? [])];
    if (c.home && contract.home_root?.synthetic_home) roots.push(contract.home_root.synthetic_home);
    const matcher = localPathMatcher(roots);
    const verdict = matcher(c.text);
    if (verdict !== c.leak) {
      drift.push(`case drift on '${c.id}': expected leak=${c.leak}, got ${verdict} for '${c.text}'`);
    }
  }
  return drift;
}

export function assertNoPathPrivacyDrift(contract?: PathPrivacyContract): void {
  const c = contract ?? loadPathPrivacyContract();
  const drift = pathPrivacyDrift(c);
  if (drift.length > 0) {
    throw new Error(`Path privacy gate drifted from doc-contracts.json:\n  ${drift.join("\n  ")}`);
  }
}
export function isNeutralPlaceholder(text: string): boolean {
  return NEUTRAL_PLACEHOLDERS.has(text.replace(/[/\\]+$/, ""));
}

function isAbsoluteRoot(text: string): boolean {
  return text.startsWith("/") || text.startsWith("\\") || text.slice(1, 3) === ":\\" || text.slice(1, 3) === ":/";
}

function rootVariants(root: string): Set<string> {
  let text = root.replace(/[/\\]+$/, "");
  if (!text) return new Set();
  if (!isAbsoluteRoot(text)) text = path.resolve(text).replace(/[/\\]+$/, "");
  if (text.length <= 1 || !isAbsoluteRoot(text) || isNeutralPlaceholder(text)) return new Set();
  const variants = new Set([text, text.replaceAll("\\", "/")]);
  if (existsSync(text)) {
    const resolved = realpathSync(text).replace(/[/\\]+$/, "");
    variants.add(resolved);
    variants.add(resolved.replaceAll("\\", "/"));
  }
  return new Set([...variants].filter((variant) => variant.length > 1 && !isNeutralPlaceholder(variant)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rootAlternatives(variants: Iterable<string>): string[] {
  const alternatives: string[] = [];
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    alternatives.push(String.raw`(?<![A-Za-z0-9_])${escapeRegExp(variant)}`);
    if (variant.startsWith("/") && variant.replace(/^\/+|\/+$/g, "").split("/").length >= 2) {
      alternatives.push(String.raw`(?<![A-Za-z0-9_/.])${escapeRegExp(variant.slice(1))}`);
    }
  }
  return alternatives;
}

export function localPathMatcher(roots: Iterable<string> = []): (text: string) => boolean {
  const variants = new Set<string>();
  for (const root of roots) for (const variant of rootVariants(root)) variants.add(variant);
  const configured = variants.size > 0 ? new RegExp(`(?:${rootAlternatives(variants).join("|")})${PATH_BOUNDARY}`, "i") : null;
  return (text) => {
    if (configured?.test(text)) return true;
    return [...text.matchAll(PRIVATE_LOCAL_PATH)].some((match) => !isNeutralPlaceholder(match[0]));
  };
}

export function findPathLeaks(value: unknown, roots: Iterable<string> = []): string[] {
  const contains = localPathMatcher(roots);
  const leaks = new Set<string>();
  const visit = (node: unknown, trail: string[]): void => {
    if (typeof node === "string") {
      if (contains(node)) leaks.add(trail.join(".") || "<root>");
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, [...trail, String(index)]));
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        let label = key;
        if (contains(key)) {
          label = "<key>";
          leaks.add([...trail, label].join("."));
        }
        visit(child, [...trail, label]);
      }
    }
  };
  visit(value, []);
  return [...leaks];
}
