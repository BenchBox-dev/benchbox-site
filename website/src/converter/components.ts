import type { ComponentName } from "./types.ts";

export const COMPONENT_MODULES: Readonly<Record<ComponentName, string>> = {
  Callout: "src/components/docs/Callout.astro",
  Mermaid: "src/components/docs/Mermaid.astro",
  CitedResult: "src/components/results/CitedResult.tsx",
  CurrentResults: "src/components/results/CurrentResults.tsx",
};
