import { readdirSync } from "node:fs";
import path from "node:path";

export function filesUnder(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...filesUnder(root, relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}
