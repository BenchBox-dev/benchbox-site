// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import CitedResult from "../src/components/results/CitedResult.tsx";
import CurrentResults from "../src/components/results/CurrentResults.tsx";
import type { LoadResults } from "../src/components/results/useLiveResults.ts";
import type { Citation } from "../src/lib/results-embed.ts";
import type { EmbedResult, PublishedEmbedResult } from "@/lib/resultEmbed";

afterEach(cleanup);

const CITATION: Citation = {
  result: "tpch-duckdb-sf1.0-20261007-83a01707",
  snapshot: "0e189624e6712c0e96cac56022b6530ec99648e2a1ffa0aade638652490822ea",
  snapshotDate: "2026-11-06",
  platform: "DuckDB",
  benchmark: "TPC-H",
  scale: "SF 1",
  runDate: "2026-10-07",
  metric: "Geomean query time",
  direction: "lower is better",
  value: "29.4 ms",
};

function published(overrides: Partial<PublishedEmbedResult> = {}): PublishedEmbedResult {
  return {
    state: "published",
    resultId: CITATION.result,
    platform: "DuckDB",
    benchmark: "TPC-H",
    scale: "SF 1",
    runDate: "2026-10-07",
    trust: "Maintainer run",
    metric: { id: "display_geomean_ms", label: "Geomean query time", direction: "lower is better", text: "29.4 ms" },
    ranked: true,
    rankingNote: null,
    displayNote: null,
    href: `/results/r/${CITATION.result}`,
    ...overrides,
  };
}

function withdrawn(resultId: string): EmbedResult {
  return { state: "withdrawn", resultId, cause: "absent" };
}

const never: LoadResults = () => new Promise(() => undefined);
const resolvesTo = (...results: EmbedResult[]): LoadResults => () => Promise.resolve(results);

function cited(load: LoadResults) {
  return render(h(CitedResult, { citation: CITATION, load }));
}

function current(ids: string[], load: LoadResults) {
  return render(h(CurrentResults, { results: ids, load, liveSnapshot: CITATION.snapshot }));
}

describe("cited result", () => {
  it("shows the cited values with the snapshot identity and date before anything is loaded", () => {
    const { container } = cited(never);
    const figure = container.querySelector("figure")!;
    expect(within(figure).getByText("Cited result")).toBeTruthy();
    expect(figure.textContent).toContain("sha256:0e189624e671");
    expect(figure.textContent).toContain(CITATION.snapshot);
    expect(figure.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-06");
    expect(figure.textContent).toContain("29.4 ms");
    expect(figure.getAttribute("data-state")).toBe("cited");
    expect(within(figure).getByRole("link").getAttribute("href")).toBe(`/results/r/${CITATION.result}`);
  });

  it("keeps the cited value and says so when the current value is the same", async () => {
    const { container } = cited(resolvesTo(published()));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("same value"));
    expect(container.querySelector("figure")!.textContent).toContain("29.4 ms");
  });

  it("keeps the cited value and reports a different current value instead of replacing it", async () => {
    const { container } = cited(resolvesTo(published({ metric: { id: "display_geomean_ms", label: "Geomean query time", direction: "lower is better", text: "31.0 ms" } })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("reports 31.0 ms"));
    expect(container.querySelector("figure")!.textContent).toContain("29.4 ms");
  });

  it("renders a withdrawn result as withdrawn, without its values, and keeps the snapshot identity", async () => {
    const { container } = cited(resolvesTo(withdrawn(CITATION.result)));
    await waitFor(() => expect(container.querySelector("figure")!.getAttribute("data-state")).toBe("withdrawn"));
    const figure = container.querySelector("figure")!;
    expect(figure.textContent).toContain("Withdrawn");
    expect(figure.textContent).not.toContain("29.4 ms");
    expect(figure.textContent).not.toContain("DuckDB");
    expect(figure.textContent).toContain("sha256:0e189624e671");
    expect(figure.querySelector("a")).toBeNull();
  });

  it("keeps the cited values when the current snapshot cannot be read", async () => {
    const { container } = cited(() => Promise.reject(new Error("offline")));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("could not be checked"));
    expect(container.querySelector("figure")!.textContent).toContain("29.4 ms");
  });
});

describe("current results", () => {
  const ids = [CITATION.result, "tpch-spark-sf1.0-20261007-9c57f2ae", "tpch-duckdb-sf1.0-20200101-00000000"];

  it("is labelled live and lists every requested result in order before the snapshot is read", () => {
    const { container } = current(ids, never);
    expect(within(container.querySelector("figure")!).getByText("Live")).toBeTruthy();
    expect([...container.querySelectorAll("tbody tr th")].map((cell) => cell.textContent)).toEqual(ids);
  });

  it("shows published rows from the snapshot and withdrawn rows for results it no longer has", async () => {
    const { container } = current(
      ids,
      resolvesTo(published(), published({ resultId: ids[1]!, platform: "Spark", ranked: false, rankingNote: "Not ranked here.", href: `/results/r/${ids[1]}` }), withdrawn(ids[2]!)),
    );
    await waitFor(() => expect(container.querySelectorAll("tbody tr[data-state=published]")).toHaveLength(2));
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["published", "published", "withdrawn"]);
    expect(rows[0]!.textContent).toContain("29.4 ms");
    expect(rows[1]!.textContent).toContain("Not ranked here.");
    expect(rows[2]!.textContent).toContain("Withdrawn");
    expect(rows[2]!.textContent).not.toContain("ms");
  });

  it("reports that the snapshot could not be loaded instead of showing stale rows", async () => {
    const load = vi.fn<LoadResults>(() => Promise.reject(new Error("offline")));
    current(ids, load);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("could not be loaded"));
  });
});
