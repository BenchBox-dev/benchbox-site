# Deployment probe evidence

The post-deploy probe compares served bytes with the checksum manifest of the
built site. A persistent mismatch fails the probe; recording more detail does
not change the required paths, retry window, or rollback decision.

New receipts include `probes.mismatch_details`. Each entry records the URL,
`expected_sha256` from the manifest, `served_sha256` from the response body, and
available cache headers: `age`, `cache-control`, `date`, `etag`, `last-modified`,
`via`, `x-cache`, `x-cache-hits`, `x-served-by`, and `x-proxy-cache`. Other response
headers, including cookies, are not stored. Older receipts without this field
remain readable and retain their original digest.

Compare the served hash with the previous and candidate generations before
attributing a mismatch to stale caches or generated content. Cache headers alone
do not establish the cause. A re-probe after a later deployment cannot prove
which bytes a historical deployment served.

Run `npm run test:deploy` to check mismatch evidence, receipt serialization, and
rollback behavior. `npm run deploy -- probe` writes `deploy-work/probe.json`;
`npm run deploy -- receipt` includes that evidence in the deployment receipt.

## Holding a rollback

A rollback restores an older generation but does not stop later runs. A
`core-bundle` dispatch or a push to `main` that resolves, builds and passes
every gate deploys a newer generation over it. The hold is to unset the
repository variable `SITE_DEPLOY_TARGET`. Only the owner changes repository
variables.

1. Dispatch the rollback while the variable still matches the target of the
   receipt: `gh workflow run deploy.yml -R BenchBox-dev/benchbox-site --ref
   main -f mode=rollback -f receipt_run_id=<receipt run>`. The run looks the
   receipt up among those recorded for the current `SITE_DEPLOY_TARGET`, so a
   receipt recorded for another target is refused, and only the `deploy`
   job, which needs `rehearsal` or `production`, publishes it. The lookup
   loads that run's receipt and reads only the deployment named by its
   `deployment_id`, which must be a github-pages deployment with a success
   status recording the run and the receipt hash.
2. Wait for the rollback run to finish and its probes to pass.
3. Unset `SITE_DEPLOY_TARGET`. Later runs, including `core-bundle`
   dispatches, still resolve, build and gate, then stop before the `deploy`
   job and write a summary saying nothing was deployed.
4. To resume, set the variable back to the recorded target and dispatch
   `mode=deploy` or wait for the next bundle. A candidate bundle must not be
   older than or diverged from the deployed core commit; see "Bundles behind
   the deployed one".

Unsetting the variable before step 2 completes leaves the rollback run
without a `deploy` job, so nothing is restored.

## Deployed-generation lookup

`resolve`, `recheck` and the visual workflow find the deployed generation by
reading deployments newest first and stopping at the newest success status
recorded for the current `SITE_DEPLOY_TARGET`. A status without a target is
resolved by loading its receipt, only when it is reached before a match. The
scan stops after three pages of 100 deployments; a miss inside that bound
fails with `ReceiptLookupBoundError` instead of reporting nothing deployed.
Each lookup logs `deploy lookup: <n> REST calls, <n> receipt loads`. API
failures log the route, status, rate-limit headers and the first 200 characters
of the message, and GET requests retry network errors twice.

## Bundles behind the deployed one

Core's site-inputs runs finish in the order Trunk finishes, not in commit
order, so a `deploy` run can resolve a bundle whose core commit is an ancestor
of the deployed one. `resolve` compares the deployed receipt's `core_sha` with
the candidate's and acts on the result:

- `ahead` or `identical`: the candidate deploys.
- `behind` and the deployed receipt's `site_sha` equals this run's commit:
  the run is superseded. It logs a notice naming both core commits, sets the
  build output `superseded=true`, skips the docs check, build, gates, artifact
  uploads and the `deploy` job, and concludes success. It opens no
  site-deploy-failed comment and neither opens nor closes a core
  site-bundle-undeployed issue.
- `behind` and this run's commit is not the deployed one: the run deploys
  this site commit with the deployed core bundle. It fetches the bundle by the
  receipt's `core_sha` and fails closed unless its digest equals the
  receipt's `bundle_digest`. The notice names both core commits.
- `diverged`, an unknown status or a failed compare: the run fails and is
  reported. A diverged candidate has its own failure class, `diverged-bundle`.

A `rollback` run does not compare and behaves as before.

## Redeploy

`mode=redeploy` builds this site commit with the core bundle that is live. It
reads the deployed receipt for the current `SITE_DEPLOY_TARGET`, fetches the
bundle by the receipt's `core_sha` and fails closed unless the fetched bundle
carries that `core_sha` and its digest equals the receipt's `bundle_digest`.
It never picks the newest bundle and runs no freshness compare. With no
receipt deployed for the target it fails with "redeploy needs a deployed
receipt".
