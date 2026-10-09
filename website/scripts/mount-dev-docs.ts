import path from "node:path";
import { mountDevDocs } from "../src/lib/dev-docs.ts";
import { siteOrigin } from "../src/lib/site-origin.ts";

const siteDir = path.resolve(process.argv[2] ?? "dist");
const changed = mountDevDocs(siteDir, siteOrigin());
process.stdout.write(`mounted the docs at /docs/dev/ and rebased links in ${changed} pages\n`);
