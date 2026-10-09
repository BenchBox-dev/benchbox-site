import { isLastKnownGood, type Receipt } from "./receipt.ts";

export type RollbackDecision = { dispatch: false; reason: string } | { dispatch: true; targetRunId: string; reason: string };

export function automaticRollback(input: {
  mode: Receipt["mode"];
  probesOk: boolean;
  lastKnownGood: Receipt | null;
  currentRunId: string;
}): RollbackDecision {
  if (input.probesOk) return { dispatch: false, reason: "probes passed" };
  if (input.mode === "rollback") return { dispatch: false, reason: "a failing rollback never triggers another rollback" };
  if (!input.lastKnownGood || !isLastKnownGood(input.lastKnownGood)) {
    return { dispatch: false, reason: "no receipt with green gates and probes exists to roll back to" };
  }
  if (input.lastKnownGood.run_id === input.currentRunId) {
    return { dispatch: false, reason: "the last known good receipt is this run" };
  }
  return { dispatch: true, targetRunId: input.lastKnownGood.run_id, reason: `rolling back to run ${input.lastKnownGood.run_id}` };
}

export function rollbackTargetErrors(target: Receipt | null, requestedRunId: string): string[] {
  if (!target) return [`no receipt of run ${requestedRunId} is recorded on a github-pages deployment`];
  if (target.run_id !== requestedRunId) return [`receipt run ${target.run_id} does not match the requested run ${requestedRunId}`];
  if (!isLastKnownGood(target)) return [`receipt of run ${requestedRunId} is not last known good (gates and probes must both have passed)`];
  return [];
}
