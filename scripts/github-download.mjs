import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

export const DOWNLOAD_RETRY_INTERVALS_MS = [5000, 15000];

export function isRetryableDownloadError(error) {
  const message = `${error instanceof Error ? error.message : String(error)} ${error?.stderr ?? ""}`;
  if (/digest|mismatch|gate fail/i.test(message)) return false;
  const statuses = [...message.matchAll(/\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/gi)].map((match) => Number(match[1]));
  if (statuses.some((status) => status >= 400 && status < 500)) return false;
  if (statuses.length) return statuses.every((status) => status >= 500 && status < 600);
  return /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|network error|fetch failed|socket hang up|TLS handshake timeout|connection reset by peer|i\/o timeout|temporary failure in name resolution|no such host/i.test(message);
}

export function downloadWithRetry(runner, { sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), log = console.warn } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return runner();
    } catch (error) {
      if (attempt === DOWNLOAD_RETRY_INTERVALS_MS.length || !isRetryableDownloadError(error)) throw error;
      const delay = DOWNLOAD_RETRY_INTERVALS_MS[attempt];
      log(`artifact download failed (attempt ${attempt + 1}/3), retrying in ${delay / 1000}s: ${error.message}`);
      sleep(delay);
    }
  }
}

export function downloadArtifact(repo, runId, name, directory, options = {}) {
  downloadWithRetry(() => {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    execFileSync("gh", ["run", "download", runId, "-R", repo, "-n", name, "-D", directory], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, options);
}
