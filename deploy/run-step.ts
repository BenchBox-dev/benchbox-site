import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classifyFailure } from "./lib/relay.ts";

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
let tail = "";
for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
  source.on("data", (chunk: Buffer) => {
    target.write(chunk);
    tail = (tail + chunk.toString()).slice(-65536);
  });
}
child.on("error", (error) => {
  console.error(error.message);
});
child.on("close", (code) => {
  if (code !== 0 && process.env.GITHUB_OUTPUT) {
    const failures = tail.split("\n").filter((line) => !/^(pass|skip)\s/.test(line)).join("\n");
    appendFileSync(process.env.GITHUB_OUTPUT, `failure_class=${classifyFailure(failures)}\n`);
  }
  process.exit(code ?? 1);
});
