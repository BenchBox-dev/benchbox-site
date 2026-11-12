import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDocsPages, inGeneratedScope } from "../src/lib/docs-generators/generate.ts";
import { loadDocsData } from "../src/lib/docs-generators/docs-data.ts";
import { assembleAuthoredDocs, DocsAssemblyError, docsInputsRoot, LANDING_VERSION_TOKEN, REPO_ROOT, requireDocsInputs } from "../src/lib/site-inputs.ts";

const workDir = mkdtempSync(path.join(os.tmpdir(), "site-inputs-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function authoredTree(name: string, files: Record<string, string>): string {
  const root = path.join(workDir, name);
  for (const [relative, content] of Object.entries({ "README.md": `Current release: \`v${LANDING_VERSION_TOKEN}\`.\n`, ...files })) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  return root;
}

const pin = path.join(REPO_ROOT, "release-pin");
const inputs = docsInputsRoot({});
const pinVersion = (JSON.parse(readFileSync(path.join(pin, "manifest.json"), "utf-8")) as { package_version: string }).package_version;

describe("resolving the docs inputs", () => {
  it("defaults to the release pin whatever SITE_INPUTS says", () => {
    expect(docsInputsRoot({})).toBe(pin);
    expect(docsInputsRoot({ SITE_INPUTS: path.join(workDir, "develop") })).toBe(pin);
  });

  it("treats an empty DOCS_INPUTS as unset", () => {
    expect(docsInputsRoot({ DOCS_INPUTS: "" })).toBe(pin);
  });

  it("honours DOCS_INPUTS", () => {
    expect(docsInputsRoot({ DOCS_INPUTS: path.join(workDir, "other") })).toBe(path.join(workDir, "other"));
  });

  it("names the path and npm run docs:pin when the inputs are missing", () => {
    const missing = path.join(workDir, "nowhere");
    expect(() => requireDocsInputs({ DOCS_INPUTS: missing })).toThrow(missing);
    expect(() => requireDocsInputs({ DOCS_INPUTS: missing })).toThrow("npm run docs:pin");
  });

  it("accepts a directory that holds a manifest", () => {
    expect(requireDocsInputs({})).toBe(pin);
  });
});

describe("the landing page version", () => {
  const previous = { siteInputs: process.env.SITE_INPUTS, docsInputs: process.env.DOCS_INPUTS };
  afterAll(() => {
    for (const [name, value] of [["SITE_INPUTS", previous.siteInputs], ["DOCS_INPUTS", previous.docsInputs]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function develop(): string {
    const root = path.join(workDir, "develop");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ package_version: "99.0.0" }));
    return root;
  }

  it("comes from the pin when SITE_INPUTS holds a newer bundle", () => {
    process.env.SITE_INPUTS = develop();
    delete process.env.DOCS_INPUTS;
    const docsRoot = assembleAuthoredDocs(path.join(workDir, "pin-version"), undefined, authoredTree("pin-version-source", {}));
    expect(readFileSync(path.join(docsRoot, "README.md"), "utf-8")).toBe(`Current release: \`v${pinVersion}\`.\n`);
  });

  it("comes from the pin when DOCS_INPUTS is empty", () => {
    process.env.SITE_INPUTS = develop();
    process.env.DOCS_INPUTS = "";
    const docsRoot = assembleAuthoredDocs(path.join(workDir, "empty-version"), undefined, authoredTree("empty-version-source", {}));
    expect(readFileSync(path.join(docsRoot, "README.md"), "utf-8")).toBe(`Current release: \`v${pinVersion}\`.\n`);
  });

  it("comes from DOCS_INPUTS when set", () => {
    const other = path.join(workDir, "other-inputs");
    cpSync(pin, other, { recursive: true });
    writeFileSync(path.join(other, "manifest.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(pin, "manifest.json"), "utf-8")), package_version: "7.7.7" }));
    process.env.DOCS_INPUTS = other;
    const docsRoot = assembleAuthoredDocs(path.join(workDir, "other-version"), undefined, authoredTree("other-version-source", {}));
    expect(readFileSync(path.join(docsRoot, "README.md"), "utf-8")).toBe("Current release: `v7.7.7`.\n");
  });

  it("fails naming the path and npm run docs:pin when the inputs are missing", () => {
    const missing = path.join(workDir, "absent");
    process.env.DOCS_INPUTS = missing;
    expect(() => assembleAuthoredDocs(path.join(workDir, "absent-out"), undefined, authoredTree("absent-source", {}))).toThrow(new RegExp(`${missing}.*npm run docs:pin`));
  });
});

describe("assembling the authored documentation", () => {
  it("combines the site's pages, the generated pages and the versioned landing page", () => {
    const destination = path.join(workDir, "assembled");
    const docsRoot = assembleAuthoredDocs(destination, inputs, authoredTree("ok", { "usage/page.md": "# Page\n" }));
    expect(readFileSync(path.join(docsRoot, "README.md"), "utf-8")).toBe(`Current release: \`v${pinVersion}\`.\n`);
    expect(readFileSync(path.join(docsRoot, "usage", "page.md"), "utf-8")).toBe("# Page\n");
    const generated = generateDocsPages(loadDocsData(path.join(inputs, "docs-data", "docs-data.json")));
    expect(generated.size).toBeGreaterThan(0);
    for (const [relative, content] of generated) expect(readFileSync(path.join(docsRoot, relative), "utf-8")).toBe(content);
    expect([...generated.keys()].every(inGeneratedScope)).toBe(true);
  });

  it("starts from a clean destination", () => {
    const destination = path.join(workDir, "clean");
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, "stale.txt"), "stale");
    assembleAuthoredDocs(destination, inputs, authoredTree("clean-source", {}));
    expect(existsSync(path.join(destination, "stale.txt"))).toBe(false);
  });

  it.each(["benchmarks/queries/tpch/q1.md", "compat/capability-matrix.md", "reference/tuning-platform-support.md"])("refuses an authored page in the generated scope: %s", (relative) => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "collide"), inputs, authoredTree(`collide-${relative.replaceAll("/", "-")}`, { [relative]: "# Mine\n" }))).toThrow(DocsAssemblyError);
  });

  it("leaves authored pages next to the generated directories alone", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-near"), inputs, authoredTree("near", { "benchmarks/tpc-h.md": "# H\n", "reference/tuning.md": "# T\n" }))).not.toThrow();
  });

  it("refuses an authored blog directory", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-blog"), inputs, authoredTree("blog", { "blog/post.md": "# Post\n" }))).toThrow(DocsAssemblyError);
  });

  it("refuses core-only content", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-core"), inputs, authoredTree("core", { "agent/notes.md": "# Notes\n" }))).toThrow("core-only");
  });

  it("refuses a landing page without the release token", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-untagged"), inputs, authoredTree("untagged", { "README.md": "Current release: `v1.0.0`.\n" }))).toThrow(DocsAssemblyError);
  });
});
