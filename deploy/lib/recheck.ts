export function recheckErrors(resolvedDeployedSha: string | null, currentDeployedSha: string | null): string[] {
  if (resolvedDeployedSha === currentDeployedSha) return [];
  return [
    `the deployed receipt changed from ${resolvedDeployedSha ?? "none"} to ${currentDeployedSha ?? "none"} after this run resolved; ` +
      "refusing to deploy over a newer generation (re-run to resolve again)",
  ];
}
