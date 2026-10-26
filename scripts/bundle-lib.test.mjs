import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEMA_DIR, SUPPORTED_SCHEMAS, memberDigest, membersFor, verifyBundle } from "./bundle-lib.mjs";
import { certificationErrors } from "./bundle-verify.mjs";
import { fixtureBundle, FIXTURE_CORE as CORE, FIXTURE_PARENT as PARENT } from "./fixture-bundle.mjs";

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

test("schemas 4 and 5 verify and retired or unknown schemas fail", () => {
  assert.deepEqual(SUPPORTED_SCHEMAS, [4, 5]);
  for (const schema of SUPPORTED_SCHEMAS) assert.deepEqual(verifyBundle(fixtureBundle({ schema })).errors, []);
  for (const schema of [1, 2, 3, 6]) {
    assert.ok(verifyBundle(fixtureBundle({ schema })).errors.some((error) => error.startsWith(`schema ${schema}`)));
  }
});

test("a changed member fails its digest", () => {
  assert.ok(verifyBundle(fixtureBundle({ tamper: true })).errors.includes("digest mismatch: docs"));
});

test("a consumer that supports one schema rejects the other", () => {
  for (const [schema, supported] of [[4, 5], [5, 4]]) {
    const result = verifyBundle(fixtureBundle({ schema }), { supportedSchemas: [supported] });
    assert.ok(result.errors.some((error) => error.startsWith(`schema ${schema} is not supported (supported: ${supported})`)));
  }
});

function rewriteManifest(dir, change) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  change(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return dir;
}

function rewriteMember(dir, name, body) {
  write(path.join(dir, name), body);
  return rewriteManifest(dir, (manifest) => {
    manifest.members[name] = memberDigest(path.join(dir, name));
  });
}

test("member sets are exact for each schema", () => {
  assert.ok(!membersFor(5).includes("docs") && !membersFor(5).includes("downloads"));
  assert.ok(membersFor(4).includes("docs") && membersFor(4).includes("docs-data"));
  assert.equal(membersFor(3), undefined);
  const schema3Members = rewriteManifest(fixtureBundle({ schema: 4 }), (manifest) => {
    manifest.schema = 3;
    delete manifest.members["docs-data"];
    delete manifest.members["doc-contracts.json"];
  });
  assert.ok(verifyBundle(schema3Members).errors.includes("schema 3 is not supported (supported: 4, 5)"));
  const schema5WithDownloads = rewriteManifest(fixtureBundle({ schema: 5 }), (manifest) => {
    manifest.members.downloads = "0".repeat(64);
  });
  assert.ok(verifyBundle(schema5WithDownloads).errors.some((error) => error.startsWith("member set mismatch")));
  const schema4WithoutDocs = rewriteManifest(fixtureBundle({ schema: 4 }), (manifest) => {
    delete manifest.members.docs;
  });
  assert.ok(verifyBundle(schema4WithoutDocs).errors.some((error) => error.startsWith("member set mismatch")));
  const schema4WithoutDocsData = rewriteManifest(fixtureBundle({ schema: 4 }), (manifest) => {
    delete manifest.members["docs-data"];
  });
  assert.ok(verifyBundle(schema4WithoutDocsData).errors.some((error) => error.startsWith("member set mismatch")));
  const schema5WithDocs = rewriteManifest(fixtureBundle({ schema: 5 }), (manifest) => {
    manifest.members.docs = "0".repeat(64);
  });
  assert.ok(verifyBundle(schema5WithDocs).errors.some((error) => error.startsWith("member set mismatch")));
  const schema4WithoutContracts = rewriteManifest(fixtureBundle({ schema: 4 }), (manifest) => {
    delete manifest.members["doc-contracts.json"];
  });
  assert.ok(verifyBundle(schema4WithoutContracts).errors.some((error) => error.startsWith("member set mismatch")));
});

test("schema 4 accepts the candidate certifier or a run id and schema 5 only the candidate certifier", () => {
  for (const certifiedBy of ["candidate", "1", "40239821240"]) {
    assert.deepEqual(verifyBundle(fixtureBundle({ schema: 4, certifiedBy })).errors, [], certifiedBy);
  }
  for (const certifiedBy of ["local", "dispatch", "12abc", " 1", "1.5", "-1", "0x1"]) {
    const errors = verifyBundle(fixtureBundle({ schema: 4, certifiedBy })).errors;
    assert.ok(errors.some((error) => error.startsWith("schema 4 requires certified_by candidate or a run id")), certifiedBy);
  }
  const numeric = rewriteManifest(fixtureBundle({ schema: 4 }), (manifest) => {
    manifest.certified_by = 7;
  });
  assert.ok(verifyBundle(numeric).errors.some((error) => error.startsWith("schema 4 requires certified_by")));
  for (const certifiedBy of ["1", "local", "dispatch"]) {
    const errors = verifyBundle(fixtureBundle({ schema: 5, certifiedBy })).errors;
    assert.ok(errors.some((error) => error.startsWith("schema 5 requires certified_by candidate, got")), certifiedBy);
  }
  assert.deepEqual(verifyBundle(fixtureBundle({ schema: 5 })).errors, []);
});

test("a certified schema 4 bundle fails closed on member set, tampering and invalid contracts", () => {
  const certified = () => fixtureBundle({ schema: 4, certifiedBy: "40239821240" });
  assert.deepEqual(verifyBundle(certified()).errors, []);

  const missing = rewriteManifest(certified(), (manifest) => {
    delete manifest.members["doc-contracts.json"];
  });
  assert.ok(verifyBundle(missing).errors.some((error) => error.startsWith("member set mismatch")));

  const missingDocsData = rewriteManifest(certified(), (manifest) => {
    delete manifest.members["docs-data"];
  });
  assert.ok(verifyBundle(missingDocsData).errors.some((error) => error.startsWith("member set mismatch")));

  const extra = rewriteManifest(certified(), (manifest) => {
    manifest.members["unexpected"] = "0".repeat(64);
  });
  assert.ok(verifyBundle(extra).errors.some((error) => error.startsWith("member set mismatch")));

  const tampered = certified();
  write(path.join(tampered, "doc-contracts.json"), "{}\n");
  assert.deepEqual(verifyBundle(tampered).errors, ["digest mismatch: doc-contracts.json"]);

  const contracts = JSON.parse(readFileSync(path.join(certified(), "doc-contracts.json"), "utf8"));
  const rewritten = rewriteMember(certified(), "doc-contracts.json", JSON.stringify({ ...contracts, schema_version: 2 }));
  assert.ok(verifyBundle(rewritten).errors.some((error) => error.startsWith("doc-contracts /schema_version")));

  const docs = rewriteMember(certified(), "docs-data/docs-data.json", "{}\n");
  rewriteManifest(docs, (manifest) => {
    delete manifest.members["docs-data/docs-data.json"];
    manifest.members["docs-data"] = memberDigest(path.join(docs, "docs-data"));
  });
  assert.ok(verifyBundle(docs).errors.some((error) => error.startsWith("docs-data <root>")));

  const asSchema3 = rewriteManifest(certified(), (manifest) => {
    manifest.schema = 3;
  });
  assert.ok(verifyBundle(asSchema3).errors.includes("schema 3 is not supported (supported: 4, 5)"));
});

test("docs-data holds exactly docs-data.json and validates against its schema", () => {
  const extra = fixtureBundle({ schema: 4 });
  write(path.join(extra, "docs-data/other.json"), "{}\n");
  rewriteManifest(extra, (manifest) => {
    manifest.members["docs-data"] = memberDigest(path.join(extra, "docs-data"));
  });
  assert.ok(verifyBundle(extra).errors.some((error) => error.startsWith("docs-data must hold exactly docs-data.json")));

  const wrongVersion = rewriteMember(fixtureBundle({ schema: 5 }), "docs-data/docs-data.json", "{}\n");
  rewriteManifest(wrongVersion, (manifest) => {
    delete manifest.members["docs-data/docs-data.json"];
    manifest.members["docs-data"] = memberDigest(path.join(wrongVersion, "docs-data"));
  });
  assert.ok(verifyBundle(wrongVersion).errors.some((error) => error.startsWith("docs-data <root>: must have required property")));

  const notJson = fixtureBundle({ schema: 4 });
  write(path.join(notJson, "docs-data/docs-data.json"), "not json");
  rewriteManifest(notJson, (manifest) => {
    manifest.members["docs-data"] = memberDigest(path.join(notJson, "docs-data"));
  });
  assert.ok(verifyBundle(notJson).errors.some((error) => error.startsWith("docs-data is not readable JSON")));
});

test("doc-contracts validate against their schema and fail closed on a changed contract version", () => {
  const contracts = JSON.parse(readFileSync(path.join(fixtureBundle({ schema: 4 }), "doc-contracts.json"), "utf8"));
  const bumped = rewriteMember(fixtureBundle({ schema: 4 }), "doc-contracts.json", JSON.stringify({ ...contracts, schema_version: 2 }));
  assert.ok(verifyBundle(bumped).errors.some((error) => error.startsWith("doc-contracts /schema_version")));
  const unknownKey = rewriteMember(fixtureBundle({ schema: 5 }), "doc-contracts.json", JSON.stringify({ ...contracts, surprise: 1 }));
  assert.ok(verifyBundle(unknownKey).errors.some((error) => error.startsWith("doc-contracts <root>")));
  const missing = rewriteMember(fixtureBundle({ schema: 5 }), "doc-contracts.json", "[]\n");
  assert.ok(verifyBundle(missing).errors.length > 0);
});

test("a digest mismatch in a candidate member is reported before its contents are trusted", () => {
  const dir = fixtureBundle({ schema: 4 });
  write(path.join(dir, "doc-contracts.json"), "{}\n");
  assert.deepEqual(verifyBundle(dir).errors, ["digest mismatch: doc-contracts.json"]);
});

const GENUINE = process.env.SITE_CANDIDATE_BUNDLES;
const CORE_TREE = process.env.CORE_TREE;

test("genuine core candidate bundles verify and are rejected by a consumer of the other schema", { skip: !GENUINE }, () => {
  for (const schema of [4, 5]) {
    const dir = path.join(GENUINE, `candidate${schema}`);
    assert.ok(existsSync(dir), `${dir} is missing`);
    const result = verifyBundle(dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.manifest.schema, schema);
    assert.equal(result.manifest.certified_by, "candidate");
    const old = verifyBundle(dir, { supportedSchemas: [schema === 4 ? 5 : 4] });
    assert.ok(old.errors.some((error) => error.startsWith(`schema ${schema} is not supported`)));
  }
});

test("genuine candidate bundles fail on a tampered contract", { skip: !GENUINE }, () => {
  const source = path.join(GENUINE, "candidate4");
  const copy = mkdtempSync(path.join(tmpdir(), "candidate-copy-"));
  try {
    cpSync(source, copy, { recursive: true });
    const contracts = JSON.parse(readFileSync(path.join(copy, "doc-contracts.json"), "utf8"));
    delete contracts.cli;
    rewriteMember(copy, "doc-contracts.json", JSON.stringify(contracts));
    assert.ok(verifyBundle(copy).errors.some((error) => error.startsWith("doc-contracts <root>")));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("vendored schemas equal core's schemas", { skip: !CORE_TREE }, () => {
  for (const name of ["docs-data", "doc-contracts"]) {
    const vendored = readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8");
    assert.equal(vendored, readFileSync(path.join(CORE_TREE, "quality", `${name}.schema.json`), "utf8"));
  }
});

test("a failed or skipped required attestation fails", () => {
  assert.ok(verifyBundle(fixtureBundle({ attestationResult: "fail" })).errors.includes("attestation privacy failed"));
  assert.ok(
    verifyBundle(fixtureBundle({ attestationResult: "skip" })).errors.includes("required attestation privacy was skipped"),
  );
});

test("directory digests sort by path parts like the core producer", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "digest-order-"));
  write(path.join(dir, "a-b"), "1\n");
  write(path.join(dir, "a/b"), "2\n");
  const first = memberDigest(dir);
  assert.equal(memberDigest(dir), first);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("certification requires a successful trunk push run on the bundle commit", () => {
  const good = { path: ".github/workflows/trunk.yml", event: "push", head_branch: "develop", conclusion: "success", head_sha: CORE };
  assert.deepEqual(certificationErrors(good, { core_sha: CORE }), []);
  assert.equal(certificationErrors({ ...good, event: "workflow_dispatch" }, { core_sha: CORE }).length, 1);
  assert.equal(certificationErrors({ ...good, head_sha: PARENT }, { core_sha: CORE }).length, 1);
  assert.deepEqual(certificationErrors(null, { core_sha: CORE }), ["certifying trunk run not found"]);
});
