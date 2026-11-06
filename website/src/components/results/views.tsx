import type { Citation } from "../../lib/results-embed.ts";
import type { EmbedResult } from "@/lib/resultEmbed";
import { resultDetailHref } from "@/lib/resultLinks";
import "../../styles/results-embed.css";

export type LiveCheck = { status: "pending" } | { status: "loading" } | { status: "failed" } | { status: "ready"; results: readonly EmbedResult[] };

const SHORT_SHA_LENGTH = 12;

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function SnapshotIdentity({ sha, label }: { sha: string; label: string }) {
  return (
    <details class="result-embed__snapshot">
      <summary>
        {label} <code>sha256:{shortSha(sha)}</code>
      </summary>
      <code class="result-embed__sha">{sha}</code>
    </details>
  );
}

function Withdrawn({ resultId }: { resultId: string }) {
  return (
    <p class="result-embed__withdrawn" data-state="withdrawn">
      <strong>Withdrawn.</strong> Result <code>{resultId}</code> is no longer published, so its values are not shown.
    </p>
  );
}

function citedStatus(citation: Citation, live: LiveCheck): { text: string; kind: "checking" | "unchanged" | "changed" | "unchecked" } | undefined {
  if (live.status === "pending") return undefined;
  if (live.status === "loading") return { text: "Checking the current snapshot.", kind: "checking" };
  if (live.status === "failed") return { text: "The current snapshot could not be checked. The values shown are the cited ones.", kind: "unchecked" };
  const current = live.results[0];
  if (current?.state !== "published") return undefined;
  if (current.metric.text === citation.value) return { text: "Still published. The current snapshot reports the same value.", kind: "unchanged" };
  return { text: `Still published. The current snapshot reports ${current.metric.text}.`, kind: "changed" };
}

export function CitedResultView({ citation, live }: { citation: Citation; live: LiveCheck }) {
  const current = live.status === "ready" ? live.results[0] : undefined;
  const withdrawn = current?.state === "withdrawn";
  const status = withdrawn ? undefined : citedStatus(citation, live);
  return (
    <figure class="result-embed" data-embed="cited" data-state={withdrawn ? "withdrawn" : "cited"}>
      <figcaption class="result-embed__caption">
        <span class="result-embed__badge">Cited result</span>
        <span>
          Fixed to the snapshot of <time datetime={citation.snapshotDate}>{citation.snapshotDate}</time>
        </span>
      </figcaption>
      {withdrawn ? (
        <Withdrawn resultId={citation.result} />
      ) : (
        <>
          <p class="result-embed__title">
            {citation.platform} · {citation.benchmark} · {citation.scale}
          </p>
          <p class="result-embed__metric">
            <span class="result-embed__value">{citation.value}</span>
            <span class="result-embed__metric-label">
              {citation.metric} ({citation.direction})
            </span>
          </p>
          <p class="result-embed__meta">
            Run on <time datetime={citation.runDate}>{citation.runDate}</time>
          </p>
        </>
      )}
      <SnapshotIdentity sha={citation.snapshot} label="Cited snapshot" />
      {status ? (
        <p class="result-embed__status" role="status" data-status={status.kind}>
          {status.text}
        </p>
      ) : null}
      {withdrawn ? null : (
        <p class="result-embed__link">
          <a href={resultDetailHref(citation.result)}>Open this result in the Results Explorer</a>
        </p>
      )}
    </figure>
  );
}

function CurrentRow({ resultId, result, pending }: { resultId: string; result: EmbedResult | undefined; pending: boolean }) {
  if (result === undefined) {
    return (
      <tr data-state="loading">
        <th scope="row">
          <code>{resultId}</code>
        </th>
        <td colSpan={4}>{pending ? "The current value loads in the browser." : "Loading the current value."}</td>
      </tr>
    );
  }
  if (result.state === "withdrawn") {
    return (
      <tr data-state="withdrawn">
        <th scope="row">
          <code>{resultId}</code>
        </th>
        <td colSpan={4}>
          <strong>Withdrawn.</strong> This result is no longer published, so its values are not shown.
        </td>
      </tr>
    );
  }
  return (
    <tr data-state="published">
      <th scope="row">
        <a href={result.href}>{result.platform}</a>
      </th>
      <td>
        {result.benchmark} {result.scale}
      </td>
      <td>
        <time datetime={result.runDate}>{result.runDate}</time>
      </td>
      <td>
        <span class="result-embed__value">{result.metric.text}</span> <span class="result-embed__metric-label">{result.metric.label}</span>
        {result.displayNote ? <span class="result-embed__note">{result.displayNote}</span> : null}
      </td>
      <td>{result.ranked ? "Ranked" : <span class="result-embed__note">{result.rankingNote}</span>}</td>
    </tr>
  );
}

export function CurrentResultsView({ resultIds, live, liveSnapshot }: { resultIds: readonly string[]; live: LiveCheck; liveSnapshot: string }) {
  const byId = new Map(live.status === "ready" ? live.results.map((result) => [result.resultId, result]) : []);
  return (
    <figure class="result-embed" data-embed="current" data-state={live.status}>
      <figcaption class="result-embed__caption">
        <span class="result-embed__badge result-embed__badge--live">Live</span>
        <span>Reads the current published snapshot and changes when it does.</span>
      </figcaption>
      <div class="result-embed__scroll">
        <table>
          <caption class="sr-only">Current results</caption>
          <thead>
            <tr>
              <th scope="col">Platform</th>
              <th scope="col">Benchmark</th>
              <th scope="col">Run date</th>
              <th scope="col">Primary metric</th>
              <th scope="col">Ranking</th>
            </tr>
          </thead>
          <tbody>
            {resultIds.map((resultId) => (
              <CurrentRow key={resultId} resultId={resultId} result={byId.get(resultId)} pending={live.status === "pending"} />
            ))}
          </tbody>
        </table>
      </div>
      <SnapshotIdentity sha={liveSnapshot} label="Snapshot at site build" />
      {live.status === "failed" ? (
        <p class="result-embed__status" role="status" data-status="failed">
          The current snapshot could not be loaded. Open the Results Explorer for the current values.
        </p>
      ) : null}
    </figure>
  );
}
