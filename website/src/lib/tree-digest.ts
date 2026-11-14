import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type TreeDigest = { sha256: string; totalBytes: number; totalFiles: number };

function directories(root: string, skip: ReadonlySet<string>, relative = ""): string[] {
  const found = [path.join(root, relative)];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`symlink in digested tree: ${path.join(root, child)}`);
    if (entry.isDirectory() && !skip.has(child)) found.push(...directories(root, skip, child));
  }
  return found;
}

export function treeDigest(root: string, skippedDirectories: readonly string[] = []): TreeDigest {
  const skip = new Set(skippedDirectories);
  const hash = createHash("sha256");
  let totalBytes = 0;
  let totalFiles = 0;
  for (const directory of directories(root, skip).sort()) {
    const files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isSymbolicLink()) throw new Error(`symlink in digested tree: ${path.join(directory, entry.name)}`);
        return !entry.isDirectory();
      })
      .map((entry) => entry.name)
      .sort();
    for (const name of files) {
      const full = path.join(directory, name);
      const content = readFileSync(full);
      const relative = path.relative(root, full).split(path.sep).join("/");
      hash.update(`${relative}:${createHash("sha256").update(content).digest("hex")}:${statSync(full).size}\n`);
      totalBytes += content.length;
      totalFiles += 1;
    }
  }
  return { sha256: hash.digest("hex"), totalBytes, totalFiles };
}
