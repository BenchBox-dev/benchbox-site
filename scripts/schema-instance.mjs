import { readFileSync } from "node:fs";

const STRING_CANDIDATES = ["x", "0.0.0", "benchbox"];

function resolve(root, node) {
  if (!node.$ref) return node;
  const target = node.$ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((current, part) => current[part], root);
  return resolve(root, target);
}

function stringFor(node) {
  const candidates = node.minLength ? STRING_CANDIDATES.map((value) => value.padEnd(node.minLength, "x")) : STRING_CANDIDATES;
  const match = candidates.find((value) => !node.pattern || new RegExp(node.pattern).test(value));
  if (match === undefined) throw new Error(`no string satisfies ${node.pattern}`);
  return match;
}

function build(root, raw, depth = 0) {
  if (depth > 40) throw new Error("schema nesting too deep");
  const node = resolve(root, raw);
  if ("const" in node) return node.const;
  if (node.enum) return node.enum[0];
  if (node.oneOf) return build(root, node.oneOf[0], depth + 1);
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === "object") {
    const value = {};
    for (const key of node.required ?? []) value[key] = build(root, node.properties?.[key] ?? node.additionalProperties, depth + 1);
    if (node.minProperties && Object.keys(value).length < node.minProperties) {
      value.x = build(root, node.additionalProperties, depth + 1);
    }
    return value;
  }
  if (type === "array") return Array.from({ length: node.minItems ?? 0 }, () => build(root, node.items ?? {}, depth + 1));
  if (type === "string") return stringFor(node);
  if (type === "integer" || type === "number") return node.exclusiveMinimum === undefined ? (node.minimum ?? 0) : node.exclusiveMinimum + 1;
  if (type === "boolean") return false;
  if (type === "null") return null;
  throw new Error(`unsupported schema node ${JSON.stringify(node).slice(0, 80)}`);
}

export function minimalInstance(schemaFile) {
  return build(JSON.parse(readFileSync(schemaFile, "utf8")), JSON.parse(readFileSync(schemaFile, "utf8")));
}
