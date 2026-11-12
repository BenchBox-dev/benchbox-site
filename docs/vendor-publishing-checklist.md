# Vendor publishing checklist

Result bundles are public downloads, so a cloud platform's terms apply to
publishing them. The terms were read for each platform and are recorded in the
[Terms check](development/adr/adr-client-link-locality-disclosure.md#terms-check)
of the client-link locality ADR. This page turns each condition in that table
into one of two things: an automated check, or a manual step you perform
before you publish a cloud result.

Work through the section for your platform before you open a results pull
request. The conditions are the ADR's; this page adds none.

## How the automated checks work

`benchbox submit` writes five vendor fields into the submission manifest. The
bundle validator reads the same fields when your pull request is validated
(see [Contributing Benchmark Results](contributing-results.md)), and
`benchbox submit` runs the same evaluation before it packages anything.

| Manifest field | `benchbox submit` option | What it records |
| --- | --- | --- |
| `plan_tier` | `--plan-tier paid\|free\|trial\|unspecified` | The plan tier the run used. A `funding` of `free-trial` counts as `trial`. |
| `preview_features` | `--preview-feature <name>` (repeatable) | Each Beta, Preview or early-access feature the run used. |
| `vendor_permission` | `--vendor-permission <reference>` | Your reference to the vendor's written permission. |
| `vendor_notice` | `--vendor-notice-date YYYY-MM-DD` and `--vendor-notice-ref <reference>` | The date and a reference (message id, ticket or link) for what you sent the vendor. |
| `self_run` | `--self-run` | An attestation that you ran the benchmark yourself. |

Three outcomes matter:

- **Refusal.** A `free` or `trial` `plan_tier`, or any entry in
  `preview_features`, with no `vendor_permission`, is an error: `benchbox
  submit` exits without writing a package and the validator rejects the
  bundle. `self_run: false` on BigQuery is also an error, as is a malformed
  `vendor_notice` (it needs a `sent_on` date in `YYYY-MM-DD` form and a
  non-empty `reference`) or a `plan_tier` outside the four values above.
- **Warning.** A missing `vendor_notice` on a platform that needs one, a
  missing `self_run` attestation on BigQuery, and a missing `plan_tier` on a
  platform with tier or preview conditions are warnings. They do not block the
  package, but they mean the condition is not recorded, so treat each as a
  step you still owe.
- **Not checked.** The checks read only what you record. A run on a free
  tier that you declare as `paid`, or a Preview feature you leave out of
  `preview_features`, passes. The checks cannot see which plan or features a
  run used, so declare them honestly and review the plan and features by hand.

The checks match platform variants. For example, Databricks DataFrame and
Athena Spark follow the Databricks and Athena rows.

Replication information: BenchBox result bundles already carry the
configuration and query text needed to replicate a run. That meets every
"disclosure includes what is needed to replicate" condition below, so those
conditions need no step beyond publishing the bundle.

## BigQuery

Terms: Google Cloud Service Specific Terms, General Service Terms section 7.

| Condition | Met by |
| --- | --- |
| Tests you run yourself. Not on behalf of a hyperscale cloud provider without consent. | Automated: `self_run`, set with `--self-run`. `self_run: false` refuses; a missing value warns. |
| The disclosure includes what is needed to replicate the tests. | The bundle's recorded configuration and query text. |
| Reciprocity: Google may benchmark the customer's public products in return. | Manual step: no check exists. By publishing under these terms you accept that Google may do the same to your public products. |
| Consent when running on behalf of a hyperscale cloud provider. | Manual step: obtain Google's consent before running. `--self-run` is true only when you ran the test yourself, so do not set it for a run done for a hyperscale provider without that consent. |

## Redshift and Athena

Terms: AWS Service Terms sections 1.8, 2.3 and 2.5. The same rows apply to
Athena Spark.

| Condition | Met by |
| --- | --- |
| Replication information goes in the disclosure. | The bundle's recorded configuration and query text. |
| Replication information goes to AWS. | Manual step: send it to AWS, then record `vendor_notice` with `--vendor-notice-date` and `--vendor-notice-ref`. A missing `vendor_notice` warns. |
| Reciprocity. | Manual step: no check exists. Publishing under these terms accepts that AWS may do the same. |
| Performance observations of Beta or Preview services are AWS Confidential Information. | Automated: list each such feature with `--preview-feature` and give `--vendor-permission`. Preview features without permission refuse. Manual step: obtain AWS's permission first, because the check only looks for a recorded reference. |

## Snowflake

Terms: Acceptable Use Policy section IV.

| Condition | Met by |
| --- | --- |
| Results are shared with Snowflake reasonably in advance of publishing. | Manual step: send the results to Snowflake before you open the pull request, then record `vendor_notice`. The check confirms that a dated reference is recorded; a missing one warns. It does not judge whether the notice came reasonably in advance, so check that the `sent_on` date leaves enough time. |
| The disclosure includes what is needed to replicate the test. | The bundle's recorded configuration and query text. |
| Preview results need Snowflake's written approval. | Automated: `preview_features` with `vendor_permission`. Preview features without permission refuse. Manual step: obtain the written approval first. |

## Databricks

Terms: Acceptable Use Policy and the Free Edition Acceptable Use Policy.

| Condition | Met by |
| --- | --- |
| Replication information in the disclosure. | The bundle's recorded configuration and query text. |
| Reciprocity. | Manual step: no check exists. Publishing under these terms accepts that Databricks may do the same. |
| Beta services are excluded. | Manual step: do not publish Beta results. Permission does not lift this exclusion, though the check lets a result with a recorded `vendor_permission` through. Declare any Beta or Preview feature with `--preview-feature` so that the refusal stops a result with no permission recorded. |
| Free Edition results need Databricks' express permission. | Automated: `plan_tier` of `free` with `vendor_permission`. A free tier without permission refuses. Manual step: obtain the express permission first. |

Accepted risk: AUP item 7(b) restricts bulk export of metadata that Databricks
generates. The project owner accepted this for the platform timings in public
bundles, as recorded in the ADR. It needs no publisher step.

## ClickHouse Cloud

Terms: Acceptable Use Policy section 2.

| Condition | Met by |
| --- | --- |
| Replication information goes in the disclosure. | The bundle's recorded configuration and query text. |
| Replication information goes to ClickHouse. | Manual step: send it to ClickHouse, then record `vendor_notice`. A missing `vendor_notice` warns. |
| Reciprocity. | Manual step: no check exists. Publishing under these terms accepts that ClickHouse may do the same. |
| Beta, preview and early-access results are confidential. | Automated: `preview_features` with `vendor_permission`. Preview features without permission refuse. Manual step: obtain ClickHouse's permission first. |

## MotherDuck

Terms: Master Subscription Agreement sections 1.5, 13.1 and 15.

| Condition | Met by |
| --- | --- |
| All data, code and information needed to replicate goes in the disclosure. | The bundle's recorded configuration and query text. Manual step: add anything the bundle does not carry, such as data you loaded yourself. |
| The same information goes to MotherDuck. | Manual step: send it to MotherDuck, then record `vendor_notice`. A missing `vendor_notice` warns. |
| Reciprocity. | Manual step: no check exists. Publishing under these terms accepts that MotherDuck may do the same. |
| Performance information from free, trial and beta use is confidential. | Automated: `plan_tier` of `free` or `trial` and `preview_features`, each with `vendor_permission`. Without permission they refuse. Manual step: obtain MotherDuck's permission first. |

Accepted risk: section 13.1 treats technical or performance information about
the services as MotherDuck's Confidential Information. The project owner
accepted this for public bundles, as recorded in the ADR. It needs no
publisher step.

## Starburst Galaxy

The Galaxy Terms of Service have no benchmark clause, so there is no condition
to meet and nothing to record. No telemetry clause was found either.

## Before you publish

1. Find your platform above and complete each manual step.
2. Run `benchbox submit` with the options in the table at the top. Read every
   warning it prints: each one is a condition not yet recorded.
3. Keep the vendor's reply or permission reference. The manifest holds a
   reference to it, not the message itself.
4. Open the pull request as described in
   [Contributing Benchmark Results](contributing-results.md).
