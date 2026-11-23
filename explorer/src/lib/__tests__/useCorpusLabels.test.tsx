import { renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/corpusLabelQueries", () => ({
  loadCorpusLabels: vi.fn(),
}));

import { loadCorpusLabels } from "@/lib/corpusLabelQueries";
import { useCorpusLabels } from "@/lib/useCorpusLabels";

const mockedLoad = vi.mocked(loadCorpusLabels);

beforeEach(() => {
  mockedLoad.mockReset();
});

describe("useCorpusLabels", () => {
  it("loads the snapshot labels when enabled", async () => {
    mockedLoad.mockResolvedValue(new Map());
    const { result } = renderHook(() => useCorpusLabels());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it("never reads the public snapshot for a local preview", async () => {
    const { result } = renderHook(() => useCorpusLabels(false));
    expect(result.current.status).toBe("ready");
    expect(result.current.labels.size).toBe(0);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("reports a failed read", async () => {
    mockedLoad.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCorpusLabels());
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });
});
