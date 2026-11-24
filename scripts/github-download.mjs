import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

export const RETRY_INTERVALS_MS = [5000, 15000];

export function isRetryableDownloadError(error) {
  const message = `${error instanceof Error ? error.message : String(error)} ${error?.stderr ?? ""}`;
  if (/digest|mismatch|gate fail/i.test(message)) return false;
  const statuses = [...message.matchAll(/\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/gi)].map((match) => Number(match[1]));
  if (statuses.some((status) => status >= 400 && status < 500)) return false;
  if (statuses.length) return statuses.every((status) => status >= 500 && status < 600);
  return /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|network error|fetch failed|socket hang up|TLS handshake timeout|connection reset by peer|i\/o timeout|temporary failure in name resolution|no such host/i.test(message);
}

export function isRetryableGhError(error) {
  const stderr = String(error?.stderr ?? "");
  return /Something went wrong while executing your query/i.test(stderr) || isRetryableDownloadError(stderr);
}

export function withRetry(runner, { what = "artifact download", retryable = isRetryableDownloadError, sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }, log = console.warn } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return runner();
    } catch (error) {
      if (attempt === RETRY_INTERVALS_MS.length || !retryable(error)) throw error;
      const delay = RETRY_INTERVALS_MS[attempt];
      log(`${what} failed (attempt ${attempt + 1}/${RETRY_INTERVALS_MS.length + 1}), retrying in ${delay / 1000}s: ${error.message}`);
      sleep(delay);
    }
  }
}

export function downloadArtifact(repo, runId, name, directory, options = {}) {
  withRetry(() => {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    execFileSync("gh", ["run", "download", runId, "-R", repo, "-n", name, "-D", directory], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, options);
}
