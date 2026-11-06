import { useEffect, useState } from "preact/hooks";
import type { EmbedResult } from "@/lib/resultEmbed";
import type { LiveCheck } from "./views.tsx";

export type LoadResults = (resultIds: readonly string[]) => Promise<EmbedResult[]>;

const loadFromExplorer: LoadResults = async (resultIds) => {
  const { loadEmbedResults } = await import("@/lib/resultEmbed");
  return loadEmbedResults(resultIds);
};

export function useLiveResults(resultIds: readonly string[], load: LoadResults = loadFromExplorer): LiveCheck {
  const [live, setLive] = useState<LiveCheck>({ status: "pending" });
  useEffect(() => {
    let cancelled = false;
    setLive({ status: "loading" });
    load(resultIds).then(
      (results) => {
        if (!cancelled) setLive({ status: "ready", results });
      },
      () => {
        if (!cancelled) setLive({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [resultIds.join("\n")]);
  return live;
}
