import { parse as parseYaml } from "yaml";

const PLAIN_TAG = /^[A-Za-z][A-Za-z0-9 ._/+-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|y|n)$/i;

function yamlTag(tag: string): string {
  return PLAIN_TAG.test(tag) && !RESERVED.test(tag) ? tag : JSON.stringify(tag);
}

function dropKeys(front: readonly string[], keys: readonly string[]): string[] {
  const kept: string[] = [];
  let skipping = false;
  for (const line of front) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line);
    if (key) skipping = keys.includes(key[1]);
    if (!skipping) kept.push(line);
  }
  return kept;
}

export function mergeFrontMatter(file: string, front: readonly string[] | undefined, tags: readonly string[]): { front: string[]; definitionLists: boolean } {
  const existing = front ?? [];
  const parsed = (parseYaml(existing.join("\n")) ?? {}) as Record<string, unknown>;
  const extensions = (parsed.myst as { enable_extensions?: unknown } | undefined)?.enable_extensions;
  const definitionLists = Array.isArray(extensions) && extensions.map(String).includes("deflist");
  if (tags.length > 0 && parsed.tags !== undefined) throw new Error(`${file}: has both front matter tags and a tags directive`);
  const kept = dropKeys(existing, ["myst", "orphan"]);
  const merged = tags.length > 0 ? [...kept, `tags: [${tags.map(yamlTag).join(", ")}]`] : kept;
  if (tags.length > 0) {
    const check = parseYaml(merged.join("\n")) as { tags: unknown[] };
    if (JSON.stringify(check.tags) !== JSON.stringify(tags)) throw new Error(`${file}: tags do not round-trip through YAML`);
  }
  return { front: merged, definitionLists };
}
