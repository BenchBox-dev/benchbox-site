export type CompareStatus = "ahead" | "identical" | "behind" | "diverged";

export type Deployed = { core_sha: string; corpus_sha: string; site_sha: string } | null;

export type Candidate = {
  core_sha: string;
  corpus_sha: string;
  validator_parity: { result: string; base?: string } | undefined;
};

export type Freshness =
  | { action: "fresh" }
  | { action: "superseded"; notice: string }
  | { action: "use-deployed-bundle"; notice: string }
  | { action: "refuse"; errors: string[] };

export function freshness(
  deployed: Deployed,
  candidateCoreSha: string,
  siteSha: string,
  compare: { status: number; body?: { status?: CompareStatus } },
): Freshness {
  if (!deployed) return { action: "fresh" };
  if (compare.status !== 200) {
    return { action: "refuse", errors: [`comparing the deployed core_sha with the candidate failed closed (HTTP ${compare.status})`] };
  }
  const status = compare.body?.status;
  if (status === "ahead" || status === "identical") return { action: "fresh" };
  if (status === "behind") {
    const names = `candidate core_sha ${candidateCoreSha} is behind the deployed core_sha ${deployed.core_sha}`;
    if (deployed.site_sha === siteSha) {
      return { action: "superseded", notice: `${names}, and site commit ${siteSha} is already deployed; nothing to deploy` };
    }
    return {
      action: "use-deployed-bundle",
      notice: `${names}; deploying site commit ${siteSha} with the deployed core bundle ${deployed.core_sha} instead`,
    };
  }
  if (status === "diverged") {
    return {
      action: "refuse",
      errors: [`candidate core_sha ${candidateCoreSha} has diverged from the deployed core_sha ${deployed.core_sha}; refusing a diverged bundle (diverged-bundle)`],
    };
  }
  return {
    action: "refuse",
    errors: [`candidate core_sha is ${status ?? "unknown"} relative to the deployed core_sha ${deployed.core_sha}; refusing an unknown comparison`],
  };
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
