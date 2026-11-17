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

export function redeployErrors(deployed: Deployed, target: string): string[] {
  if (deployed) return [];
  return [`redeploy needs a deployed receipt for target ${target || "any"} and found none; it ships the bundle that is live`];
}

export function deployedBundleErrors(receipt: { core_sha: string; bundle_digest: string }, fetched: { core_sha: string; digest: string }): string[] {
  const errors: string[] = [];
  if (fetched.core_sha !== receipt.core_sha) {
    errors.push(`the bundle fetched for the deployed core_sha ${receipt.core_sha} carries core_sha ${fetched.core_sha}`);
  }
  if (fetched.digest !== receipt.bundle_digest) {
    errors.push(`the deployed core bundle digest ${fetched.digest} does not match the receipt's bundle_digest ${receipt.bundle_digest}`);
  }
  return errors;
}

export type CompareResult = { status: number; body?: { status?: CompareStatus } };

export type ParityAncestry = { baseToDeployed?: CompareResult; deployedToCandidate?: CompareResult };

export function parityNeedsAncestry(deployed: Deployed, candidate: Candidate): boolean {
  const base = candidate.validator_parity?.base;
  return Boolean(deployed && deployed.corpus_sha !== candidate.corpus_sha && base && base !== deployed.core_sha);
}

function ancestryReadError(result: CompareResult | undefined, label: string): string | null {
  if (!result || result.status !== 200 || !result.body?.status) {
    return `the ${label} comparison could not be read (${result ? `HTTP ${result.status}` : "not performed"}); refusing to accept the validator_parity range`;
  }
  return null;
}

export function chainErrors(deployed: Deployed, candidate: Candidate, ancestry: ParityAncestry = {}): string[] {
  if (!deployed || deployed.corpus_sha === candidate.corpus_sha) return [];
  const parity = candidate.validator_parity;
  if (!parity) return ["corpus changed but the bundle has no validator_parity attestation"];
  if (parity.base === deployed.core_sha) return [];
  const recovery = `dispatch core site-inputs.yml with parent_core_sha=${deployed.core_sha}`;
  const range = `${parity.base ?? "no base"}..${candidate.core_sha}`;
  if (!parity.base) return [`corpus changed but validator_parity covers ${range}, not the deployed ${deployed.core_sha}; ${recovery}`];
  const unreadable = [ancestryReadError(ancestry.baseToDeployed, "validator_parity base to deployed core_sha")];
  if (candidate.core_sha !== deployed.core_sha) {
    unreadable.push(ancestryReadError(ancestry.deployedToCandidate, "deployed core_sha to bundle core_sha"));
  }
  const unread = unreadable.filter((error): error is string => error !== null);
  if (unread.length > 0) return unread.map((error) => `${error}; ${recovery}`);
  if (ancestry.baseToDeployed?.body?.status !== "ahead") {
    return [`corpus changed but validator_parity covers ${range}, and its base is not an ancestor of the deployed ${deployed.core_sha}; ${recovery}`];
  }
  if (candidate.core_sha !== deployed.core_sha) {
    const forward = ancestry.deployedToCandidate?.body?.status;
    if (forward !== "ahead" && forward !== "identical") {
      return [`corpus changed but the bundle core_sha ${candidate.core_sha} is not a descendant of the deployed ${deployed.core_sha}; refusing the validator_parity range ${range}`];
    }
  }
  return [];
}
