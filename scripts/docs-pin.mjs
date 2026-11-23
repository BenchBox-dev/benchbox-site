#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { checkAttestations, memberDigest, membersFor, readJson } from "./bundle-lib.mjs";
import { CORE_REPO, certificationErrors, githubJson } from "./bundle-verify.mjs";
import { developProductions, producingRunErrors } from "./bundle-fetch.mjs";
import { downloadArtifact } from "./github-download.mjs";

export const PIN_DIR = path.resolve(import.meta.dirname, "..", "release-pin");
export const PIN_MEMBERS = ["docs-data", "doc-contracts.json", "repo-files.json"];
const PIN_FILES = ["pin.json", "manifest.json"];
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const FETCH_SCRIPT = path.join(import.meta.dirname, "bundle-fetch.mjs");

const versionOf = (tag) => tag.replace(/^v/, "");

function walkFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(root, relative));
    else files.push(relative);
  }
  return files;
}

export function releaseErrors(release, tag) {
  if (!release) return [`release ${tag} not found`];
  const errors = [];
  if (release.draft) errors.push(`release ${tag} is a draft`);
  if (release.prerelease) errors.push(`release ${tag} is a prerelease`);
  return errors;
}

export async function releaseCommit(tag, env = process.env) {
  const errors = [];
  let release = null;
  try {
    release = await githubJson(`repos/${CORE_REPO}/releases/tags/${encodeURIComponent(tag)}`, env);
  } catch (error) {
    errors.push(`release ${tag} not found or unreadable: ${error.message}`);
  }
  if (release) errors.push(...releaseErrors(release, tag));
  if (errors.length) return { errors };
  let commit;
  try {
    commit = (await githubJson(`repos/${CORE_REPO}/commits/${encodeURIComponent(tag)}`, env)).sha;
  } catch (error) {
    return { errors: [`tag ${tag} could not be resolved to a commit: ${error.message}`] };
  }
  if (!/^[0-9a-f]{40}$/.test(String(commit))) return { errors: [`tag ${tag} resolved to an invalid commit ${commit}`] };
  return { errors: [], commit };
}

export function memberErrors(root, manifest) {
  const errors = [];
  for (const member of PIN_MEMBERS) {
    const expected = manifest.members?.[member];
    if (!expected) {
      errors.push(`manifest has no digest for ${member}`);
      continue;
    }
    try {
      if (memberDigest(path.join(root, member)) !== expected) errors.push(`member ${member} does not match the manifest digest`);
    } catch (error) {
      errors.push(`member ${member}: ${error.message}`);
    }
  }
  return errors;
}

export function directoryErrors(root, manifest) {
  const errors = [];
  for (const field of ["core_sha", "parent_core_sha", "corpus_sha", "package_version", "certified_by"]) {
    if (!manifest[field]) errors.push(`manifest field ${field} is missing`);
  }
  for (const field of ["core_sha", "parent_core_sha"]) {
    if (manifest[field] && !/^[0-9a-f]{40}$/.test(manifest[field])) errors.push(`${field} is not a full commit SHA`);
  }
  const expected = membersFor(manifest.schema);
  if (!expected) return [...errors, `schema ${JSON.stringify(manifest.schema)} is not supported`];
  const members = manifest.members ?? {};
  if (JSON.stringify(Object.keys(members).sort()) !== JSON.stringify([...expected].sort())) {
    errors.push(`member set mismatch: ${Object.keys(members).sort().join(", ")}`);
    return errors;
  }
  for (const name of expected.filter((member) => !PIN_MEMBERS.includes(member))) {
    if (!members[name]) {
      errors.push(`empty digest for ${name}`);
      continue;
    }
    try {
      if (memberDigest(path.join(root, name)) !== members[name]) errors.push(`member ${name} does not match the manifest digest`);
    } catch (error) {
      errors.push(`member ${name}: ${error.message}`);
    }
  }
  try {
    errors.push(...checkAttestations(root, manifest));
  } catch (error) {
    errors.push(`attestations: ${error.message}`);
  }
  return errors;
}

export async function certifiedErrors(manifest, env = process.env) {
  if (!/^\d+$/.test(String(manifest.certified_by))) return [`certified_by ${manifest.certified_by} is not a run id`];
  try {
    return certificationErrors(await githubJson(`repos/${CORE_REPO}/actions/runs/${manifest.certified_by}`, env), manifest);
  } catch (error) {
    return [`certification check failed closed: ${error.message}`];
  }
}

const byCreation = (a, b) => a.created_at.localeCompare(b.created_at) || a.workflow_run.id - b.workflow_run.id;

export function earliestProduction(productions) {
  return [...productions].sort(byCreation)[0];
}

export function artifactManifest(production) {
  const work = mkdtempSync(path.join(tmpdir(), "docs-pin-source-"));
  try {
    const download = path.join(work, "download");
    downloadArtifact(CORE_REPO, String(production.workflow_run.id), production.name, download);
    const archive = readdirSync(download).find((name) => name.endsWith(".tar.zst"));
    if (!archive) throw new Error(`run ${production.workflow_run.id} artifact ${production.name} has no .tar.zst archive`);
    const tarball = path.join(work, "bundle.tar");
    writeFileSync(tarball, zstdDecompressSync(readFileSync(path.join(download, archive))));
    execFileSync("tar", ["-xf", tarball, "-C", work, "site-inputs-bundle/manifest.json"]);
    return readFileSync(path.join(work, "site-inputs-bundle", "manifest.json"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function sourceRun(bundle, commit, { expiredRun, env = process.env, readManifest = artifactManifest } = {}) {
  const productions = [...(await developProductions(commit, env))].sort(byCreation);
  if (productions.length) {
    if (expiredRun) throw new Error(`core's bundle of ${commit} has not expired; --expired-run is only for a commit whose bundles have all expired`);
    const local = readFileSync(path.join(bundle, "manifest.json"));
    const match = productions.find((production) => readManifest(production).equals(local));
    if (!match) {
      const runs = productions.map((production) => production.workflow_run.id).join(", ");
      throw new Error(`manifest.json is not byte for byte the manifest of core's bundle of ${commit} from run ${runs}`);
    }
    return String(match.workflow_run.id);
  }
  if (!expiredRun) {
    throw new Error(`core's bundles of ${commit} have expired, so the directory cannot be compared with them; name the site-inputs run it came from with --expired-run <id>`);
  }
  if (!/^\d+$/.test(expiredRun)) throw new Error(`--expired-run ${expiredRun} is not a run id`);
  const run = await githubJson(`repos/${CORE_REPO}/actions/runs/${expiredRun}`, env);
  const errors = producingRunErrors(run).map((error) => `run ${expiredRun}: ${error}`);
  const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${expiredRun}/artifacts`, env);
  if (!artifacts.some((artifact) => artifact.name === `site-inputs-${commit}`)) errors.push(`run ${expiredRun} produced no bundle named site-inputs-${commit}`);
  if (errors.length) throw new Error(errors.join("; "));
  return expiredRun;
}

export async function fetchBundleDir(destination, commit, env = process.env) {
  const production = earliestProduction(await developProductions(commit, env));
  if (!production) throw new Error(`no unexpired develop bundle exists for ${commit}`);
  execFileSync(process.execPath, [FETCH_SCRIPT], {
    stdio: "inherit",
    env: { ...env, SITE_INPUTS: destination, SITE_INPUTS_CORE_SHA: commit, SITE_INPUTS_RUN_ID: String(production.workflow_run.id), SITE_INPUTS_DIGEST: "" },
  });
}

function swapDirectory(staged, target) {
  const backup = `${target}.old-${process.pid}`;
  const hadTarget = existsSync(target);
  if (hadTarget) renameSync(target, backup);
  try {
    renameSync(staged, target);
  } catch (error) {
    if (hadTarget) renameSync(backup, target);
    throw error;
  }
  if (hadTarget) rmSync(backup, { recursive: true, force: true });
}

export async function pinRelease(tag, { from, expiredRun, pinDir = PIN_DIR, env = process.env, fetchBundle = fetchBundleDir, readManifest = artifactManifest } = {}) {
  if (!TAG_PATTERN.test(tag)) throw new Error(`tag ${tag} is not of the form vX.Y.Z`);
  const { errors, commit } = await releaseCommit(tag, env);
  if (errors.length) throw new Error(errors.join("; "));
  const scratch = mkdtempSync(path.join(tmpdir(), "docs-pin-"));
  const parent = path.dirname(pinDir);
  mkdirSync(parent, { recursive: true });
  const staged = mkdtempSync(path.join(parent, ".release-pin-new-"));
  try {
    const bundle = from ? path.resolve(from) : path.join(scratch, "bundle");
    if (!from) await fetchBundle(bundle, commit, env);
    const manifest = readJson(path.join(bundle, "manifest.json"));
    const problems = [];
    if (manifest.core_sha !== commit) problems.push(`manifest core_sha ${manifest.core_sha} is not the ${tag} commit ${commit}`);
    if (manifest.package_version !== versionOf(tag)) problems.push(`manifest package_version ${manifest.package_version} is not ${versionOf(tag)}`);
    problems.push(...memberErrors(bundle, manifest));
    if (from) problems.push(...directoryErrors(bundle, manifest), ...(await certifiedErrors(manifest, env)));
    if (problems.length) throw new Error(problems.join("; "));
    const run = from ? await sourceRun(bundle, commit, { expiredRun, env, readManifest }) : readJson(path.join(bundle, ".fetched.json")).runId;
    const pin = { tag, core_sha: commit, site_inputs_run: run };
    writeFileSync(path.join(staged, "pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
    copyFileSync(path.join(bundle, "manifest.json"), path.join(staged, "manifest.json"));
    for (const member of PIN_MEMBERS) cpSync(path.join(bundle, member), path.join(staged, member), { recursive: true });
    swapDirectory(staged, pinDir);
    return pin;
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function checkPinOffline(pinDir = PIN_DIR) {
  const errors = [];
  for (const name of PIN_FILES) if (!existsSync(path.join(pinDir, name))) errors.push(`${name} is missing`);
  if (errors.length) return { errors };
  const pin = readJson(path.join(pinDir, "pin.json"));
  const manifest = readJson(path.join(pinDir, "manifest.json"));
  if (typeof pin.tag !== "string" || !TAG_PATTERN.test(pin.tag)) errors.push(`pin tag ${pin.tag} is not of the form vX.Y.Z`);
  if (pin.core_sha !== manifest.core_sha) errors.push(`pin core_sha ${pin.core_sha} differs from manifest core_sha ${manifest.core_sha}`);
  if ("site_inputs_run" in pin && !/^\d+$/.test(String(pin.site_inputs_run))) errors.push(`pin site_inputs_run ${pin.site_inputs_run} is not a run id`);
  if (typeof pin.tag === "string" && manifest.package_version !== versionOf(pin.tag)) {
    errors.push(`manifest package_version ${manifest.package_version} is not ${versionOf(pin.tag)}`);
  }
  errors.push(...memberErrors(pinDir, manifest));
  const allowed = new Set(PIN_FILES);
  for (const member of PIN_MEMBERS) allowed.add(member);
  for (const file of walkFiles(pinDir)) {
    if (!allowed.has(file) && !allowed.has(file.split("/")[0])) errors.push(`unexpected file ${file}`);
  }
  return { errors, pin, manifest };
}

export async function checkPin(pinDir = PIN_DIR, { offline = false, env = process.env } = {}) {
  const { errors, pin } = checkPinOffline(pinDir);
  if (offline || !pin?.tag) return errors;
  const { errors: onlineErrors, commit } = await releaseCommit(pin.tag, env);
  errors.push(...onlineErrors);
  if (commit && commit !== pin.core_sha) errors.push(`tag ${pin.tag} is commit ${commit}, pin has ${pin.core_sha}`);
  return errors;
}

const versionParts = (tag) => versionOf(tag).split(".").map(Number);

export function compareTags(left, right) {
  const [a, b] = [versionParts(left), versionParts(right)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function newestRelease(releases) {
  const tags = releases.filter((release) => !release.draft && !release.prerelease && TAG_PATTERN.test(release.tag_name ?? "")).map((release) => release.tag_name);
  return tags.sort(compareTags).at(-1);
}

export async function pendingStatus(pinDir = PIN_DIR, env = process.env) {
  let pin;
  let newest;
  try {
    pin = readJson(path.join(pinDir, "pin.json"));
    if (!TAG_PATTERN.test(pin.tag ?? "")) throw new Error(`pin tag ${pin.tag} is not of the form vX.Y.Z`);
    newest = newestRelease(await githubJson(`repos/${CORE_REPO}/releases?per_page=100`, env));
    if (!newest) throw new Error("no published vX.Y.Z release is listed");
  } catch (error) {
    return { code: 2, message: `could not check for a newer release: ${error.message}` };
  }
  if (compareTags(newest, pin.tag) <= 0) return { code: 0, message: `release pin ${pin.tag} is not behind the newest release ${newest}` };
  return { code: 1, message: `newest release is ${newest}, release pin is ${pin.tag}` };
}

export function pinArguments(argv) {
  const valued = ["--from", "--expired-run"].map((flag) => argv.indexOf(flag));
  const [from, expiredRun] = valued.map((index) => (index === -1 ? undefined : (argv[index + 1] ?? "")));
  const tag = argv.find((arg, index) => !arg.startsWith("--") && !valued.some((flag) => flag !== -1 && index === flag + 1));
  const valid = Boolean(tag) && from !== "" && expiredRun !== "" && (expiredRun === undefined || from !== undefined);
  return { tag, from, expiredRun, valid };
}

async function main(argv) {
  if (argv.includes("--pending")) {
    const { code, message } = await pendingStatus();
    (code === 0 ? console.log : console.error)(code === 0 ? message : `docs:pin: ${message}`);
    return code;
  }
  if (argv.includes("--check")) {
    const offline = argv.includes("--offline");
    const errors = await checkPin(PIN_DIR, { offline });
    for (const error of errors) console.error(`docs:pin: ${error}`);
    if (errors.length) return 1;
    console.log(`docs:pin OK${offline ? " (release not checked)" : ""}`);
    return 0;
  }
  const { tag, from, expiredRun, valid } = pinArguments(argv);
  if (!valid) {
    console.error("docs:pin: usage: docs:pin vX.Y.Z [--from <bundle dir> [--expired-run <run id>]] | --check [--offline] | --pending");
    return 1;
  }
  const pin = await pinRelease(tag, { from, expiredRun });
  console.log(`docs:pin: pinned ${pin.tag} at ${pin.core_sha}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`docs:pin: ${error.message}`);
      process.exit(1);
    },
  );
}
