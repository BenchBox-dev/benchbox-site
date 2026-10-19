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
