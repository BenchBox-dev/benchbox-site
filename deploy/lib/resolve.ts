export type CompareStatus = "ahead" | "identical" | "behind" | "diverged";

export type Deployed = { core_sha: string; corpus_sha: string } | null;

export type Candidate = {
  core_sha: string;
  corpus_sha: string;
  validator_parity: { result: string; base?: string } | undefined;
};

export function freshnessErrors(deployed: Deployed, compare: { status: number; body?: { status?: CompareStatus } }): string[] {
  if (!deployed) return [];
  if (compare.status !== 200) return [`comparing the deployed core_sha with the candidate failed closed (HTTP ${compare.status})`];
  const status = compare.body?.status;
  if (status === "ahead" || status === "identical") return [];
  return [`candidate core_sha is ${status ?? "unknown"} relative to the deployed core_sha ${deployed.core_sha}; refusing an older or diverged bundle`];
}

export function chainErrors(deployed: Deployed, candidate: Candidate): string[] {
  if (!deployed || deployed.corpus_sha === candidate.corpus_sha) return [];
  const parity = candidate.validator_parity;
  if (!parity) return ["corpus changed but the bundle has no validator_parity attestation"];
  if (parity.base !== deployed.core_sha) {
    return [
      `corpus changed but validator_parity covers ${parity.base ?? "no base"}..${candidate.core_sha}, not the deployed ${deployed.core_sha}; ` +
        `dispatch core site-inputs.yml with parent_core_sha=${deployed.core_sha}`,
    ];
  }
  return [];
}
