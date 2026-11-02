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

## Gates on a rollback

A rollback re-runs only the gates that read the restored bytes themselves:
privacy, Explorer compatibility and the origin check. It skips the links and
snapshot digest gates, which compare the artifact with current repository
inventory and the deployed snapshot, because a restored artifact passed them
when it was first deployed. The links allowance file is not read.

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

## Choosing the core bundle

Core's site-inputs runs are created in the order Trunk finishes, not in commit
order, so run creation time does not say which bundle is newest. `bundle:fetch`
looks at the ten most recent successful `develop` site-inputs runs that still
have an unexpired bundle and takes the bundle whose `core_sha` is newest by
commit order, found with the core compare API (at most nine compares, 20 API
calls in all). If two candidates have diverged, or a compare fails or returns an
unknown status, the run fails; divergence is class `diverged-bundle`.

A `core-bundle` dispatch names a run. If a recent bundle is a descendant of the
dispatched `core_sha`, the run deploys the newest descendant instead, which
also covers a newer dispatch that the `pages-deploy` concurrency group
replaced. The notice names both core commits. The dispatch's digest belongs to
the replaced bundle, so it is not compared; the replacement still passes the
bundle schema, digest and certification verification. Descendants that have
diverged from each other fail the run.

When a dispatch or a pinned core commit names a producing run, `bundle:fetch`
waits, up to ten minutes, only for that run's `build bundle` job and never for
the run's other jobs. It proceeds once that job has succeeded and the run lists
an unexpired bundle artifact, and fails if the job failed or was cancelled, is
absent from a completed run, or the artifact is missing.

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

## Snapshot digest

While the corpus is unchanged, the deploy compares the candidate
`results.duckdb` with the deployed one by a canonical digest
(`deploy/lib/canonical-digest.ts`), because two builds of the same data differ
byte for byte. The invariant: the digest changes if and only if what a reader
of the snapshot sees changes.

Covered:

- every table and view in the `main` schema, by name
- every column's name and type, in declared order, so a schema change changes
  the digest
- every row of every column, including a column named `generated_at` if one
  ever appears; nothing is excluded
- view and index definitions (the SQL text)

Ignored:

- row order: rows are sorted by every column before hashing, because storage
  order is a build accident
- floating-point digits beyond the ninth significant digit: `DOUBLE`, `FLOAT`
  and `REAL` values are rounded to nine significant digits, which absorbs
  build-to-build noise without hiding a real change
- file layout, block sizes, statistics and anything else that is not content

Changing what the digest covers changes the digest of an unchanged corpus. The
next deploy after such a change fails the snapshot gate once, printing the
`old->new` pair. The owner reviews it and sets `SITE_SNAPSHOT_APPROVED_CHANGE`
to that pair and `SITE_SNAPSHOT_APPROVAL_REASON` to the reason.

## Artifact download 503s

Two deploy runs on 2026-10-30 failed with `HTTP 503: 503 Egress is over the
account limit.` while downloading `site-deploy-receipt-*` artifacts of about 830
bytes each: run 41061585379 (five responses, 13:29 to 13:30 UTC) and run
41087113431 (four responses, 17:59 to 18:00 UTC). Both exhausted the
`scripts/github-download.mjs` retries.

### Which limit it is

GitHub does not publish a per-organization, per-user or per-token artifact
egress limit, window or size. Checked and found silent on it: the Actions limits
reference on docs.github.com, the community threads below and the REST responses for this repository (`gh api -i` returns
only the `X-RateLimit-*` API limits, 5000 per hour for the token's user, which
never produce this message).

What the evidence says instead:

- The failing download URLs are `*.blob.core.windows.net/actions-results/...`,
  Azure Blob Storage accounts that GitHub owns and that serve artifacts for
  every customer.
- `Egress is over the account limit.` is the `ServerBusy` message of Azure
  Storage. Azure documents the quantity as a per-storage-account bandwidth
  target, not a quota with a billing window: a default maximum egress of 200
  gigabits per second for general-purpose v2 and Blob Storage accounts in the
  listed regions (including US regions) and 50 gigabits per second elsewhere
  (<https://learn.microsoft.com/en-us/azure/storage/common/scalability-targets-standard-account>).
- GitHub Support answered the same message on release downloads in December
  2021 by citing that Azure page, calling the error "pretty uncommon and usually
  transient" and later reporting the underlying issue resolved on its side
  (<https://github.com/lovell/sharp-libvips/issues/121>,
  <https://github.com/orgs/community/discussions/8535>).
- Both failures hit 830-byte receipts, and run 41061585379 was making roughly
  160 receipt downloads in a burst, so the failures cannot come from this
  repository's bytes. The 17:59 UTC failures fall inside the GitHub incident
  "Incident with Actions, Pages, and Webhooks" (17:50 to 19:23 UTC on
  2026-10-30, <https://www.githubstatus.com/>). The 13:29 UTC failures precede
  the 14:21 to 14:30 UTC burst of errors in the incident "Disruption with
  GitHub services" and match no posted incident.

So the "account" is GitHub's Azure storage account, shared with other
customers, and the limit is a shared bandwidth ceiling that this repository
cannot see or budget. The conclusion that it is not a quota on this
organization is an inference from the sources above; GitHub has not stated it
for artifacts.

### Download volume after the bounded resolver

Measured from PR #95's merge (2026-10-31T19:33Z) to 2026-11-02T01:50Z, a
little over 30 hours. Artifact sizes come from the run's artifacts API, and the
downloads per run from the workflows: a deploy run downloads the previous
receipt, the core bundle (about 1.7 MB), then its own site artifact (about
114 MB) and `deploy-work` in the `deploy` job; a visual run downloads the
receipt, the core bundle and the deployed run's site artifact (about 114 MB); a
CI run downloads the core bundle and two copies of the `site-inputs` artifact
(about 4 MB each). The `actions/deploy-pages` fetch of the Pages artifact
happens inside GitHub and is not measured.

| UTC day | deploy.yml runs and downloaded bytes | visual.yml runs and downloaded bytes | ci.yml | all |
| --- | --- | --- | --- | --- |
| 2026-10-31 (from 19:33) | 7 runs, 578.6 MB | 3 runs, 347.2 MB | 7 runs, 61.0 MB | 986.8 MB |
| 2026-11-01 | 15 runs, 1736.0 MB | 5 runs, 462.9 MB | 7 runs, 59.3 MB | 2258.3 MB |
| 2026-11-02 (to 01:50) | 1 run, 115.7 MB | none | 4 runs, 39.5 MB | 155.3 MB |
| Total | 2430.3 MB | 810.1 MB | 159.9 MB | 3400.4 MB |

Each deploy run that reached the `deploy` job and each visual run that finished
its download cost about 115.7 MB. Of the 3.4 GB, 3.19 GB (94%) is the site
artifact, downloaded 21 times by deploys and 7 times by visual runs. Runs, by
id:

- deploy.yml, 2026-10-31: 41234796636, 41234985080, 41236451245, 41241858304,
  41246532522 (115.7 MB each); 41236234670 was cancelled and 41250152375 failed
  waiting for a queued core run, before any download.
- deploy.yml, 2026-11-01: 41255737038, 41260766942, 41266033325, 41267558177,
  41268048597, 41268718722, 41269493289, 41273369086, 41308974234,
  41323370065, 41327620999, 41329424874, 41330361106, 41340742871,
  41356213545 (115.7 MB each).
- deploy.yml, 2026-11-02: 41364826047 (115.7 MB).
- visual.yml, 2026-10-31: 41234921529, 41236302717, 41239648221.
- visual.yml, 2026-11-01: 41266924328, 41268204879, 41269286687, 41307878521
  (115.7 MB each); 41269261702 was cancelled in its download step and is
  counted as zero, up to 114 MB.

No run in the window logged `Egress is over`, any `HTTP 5xx` or a download
retry: the logs of every deploy.yml, visual.yml and ci.yml run in the window
were searched. The only failed deploy run, 41250152375, failed in
`bundle:fetch` waiting for a producing core run that was still queued.

### Comparison and decision

The limit has no published size, so no usage fraction can be computed. Against
the Azure target, the busiest day (2.26 GB) is 0.09 seconds of a 200
gigabit-per-second account, and the 30 hours of the window would project to about 19 GB over seven
days, so this repository's downloads are not a plausible driver of a shared
ceiling. With no 503 in the window, no download-reducing change was made. If
503s recur, the first reduction is visual.yml: it downloads the 114 MB site
artifact on every pull request push, and comparing against the deployed
generation needs only the pages it captures.

The seven-day window ends 2026-11-07T19:33Z. To close it, list the runs of
deploy.yml, visual.yml and ci.yml created after 2026-10-31T19:33Z with
`gh run list -w <workflow> --json databaseId,createdAt,conclusion`, sum the
artifact bytes above per run from `gh api repos/BenchBox-dev/benchbox-site/actions/runs/<id>/artifacts`,
and search each run's `gh run view <id> --log` for `Egress is over`.
