---
tags: [concept, intermediate, validation]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Benchmark Methodology

How to run a sound benchmark with BenchBox, and what a result at a given scale factor and iteration count supports.

This page gathers policy that is already written down elsewhere in the documentation, the decision records and the validator rules. It adds no rule of its own. Every statement that says what to do or what not to do links to the page that sets it, and a question that no source answers is left out. It is not legal advice.

## What a scale factor supports

Each benchmark has a short set of standard scale factors, typically 0.01, 0.1, 1 and 10, and `benchbox run` rejects a scale factor outside the benchmark's list ([Benchmarks overview](../benchmarks/index.md)).

| Purpose | What the existing guidance says | Source |
|---|---|---|
| Smoke | Scale factor 0.01 is the smallest size and is the one the benchmark pages recommend for development, unit tests and quick smoke runs. | [TPC-H](../benchmarks/tpc-h.md), [Vector search](../benchmarks/vector-search.md) |
| Regression | Use a small scale factor, for example TPC-H at a small scale, so runs are fast. | [Benchmarks overview](../benchmarks/index.md) |
| Comparison | Compare results only at the same scale factor, and only when the other facts listed under [When two results are comparable](#when-two-results-are-comparable) match. | [Understanding results](../tutorials/understanding-results.md), [Comparing platforms](../tutorials/comparing-platforms.md) |
| Publication | Only results with `compliance_class=official` can be submitted; the unofficial classes are refused. | [Contributing results](../contributing-results.md) |

TPC-H and TPC-DS runs below scale factor 1 are recorded as `unofficial_subscale`, and runs that are not standard are recorded as `unofficial_nonstandard` ([Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md)). The `official` class marks BenchBox's scale-factor and seed gate; it is not a TPC audit, certification or compliance claim ([Contributing results](../contributing-results.md)).

Observed with BenchBox 0.5.0: a TPC-H run at `--scale 0.01` records `compliance_class=unofficial_subscale`, and `benchbox submit` refuses it with "Only results with compliance_class=official may be submitted."

The benchmark pages carry their own size tables for each benchmark; use the page for the benchmark you run.

## Iterations and warm-up

A power run measures three iterations by default and runs one warm-up iteration first. `--iterations` sets the number of measured iterations and applies to the power phase only; the default is stated in the help text of `benchbox run` ([Comparing platforms](../tutorials/comparing-platforms.md), `benchbox run --help-topic all`).

Observed with BenchBox 0.5.0: a default `benchbox run --platform duckdb --benchmark tpch --scale 0.01` records one warm-up pass (iteration 0) and three measurement iterations (1, 2 and 3); adding `--iterations 2` records iterations 1 and 2.

- Power@Size is computed from the final iteration's query times ([Understanding results](../tutorials/understanding-results.md)).
- Every power-run iteration, warm-up and measured, runs the same query permutation with the same substitution parameters, so iterations are repeats of one workload ([Power run guide](../advanced/power-run-concurrent-queries.md)).
- A failed per-query validation, including one in a warm-up query, prevents a clean pass ([Public contracts](../reference/public-contracts.md)).

## Seed

`--seed` sets the random seed that generates query parameters for the power and throughput tests ([CLI reference: run](../reference/cli/run.md)). Without a seed, power runs use the `qgen -d` default substitution parameters; with a seed, they use `qgen -r (seed + 1000 * stream_id)`, and the result records which convention was used in `config.query_parameters` ([Public contracts](../reference/public-contracts.md)).

Observed with BenchBox 0.5.0: a default run records `config.query_parameters` as `qgen -d (TPC-H default substitution parameters)` and no seed; a run with `--seed 7` records `config.seed` as 7 and `qgen -r (7 + 1000 * stream_id)`.

Hold the seed constant across runs whose query-plan fingerprints you compare, because fingerprints from different seeds produce false differences ([CLI reference: run](../reference/cli/run.md)).

## Validation modes and the integrity validator

`--validation` takes `exact` (the default), `loose`, `range`, `disabled` or `full`; `full` turns on all validation checks ([CLI reference: run](../reference/cli/run.md)).

A validation status is a correctness signal, not a run-success flag. `summary.validation=passed` is reserved for runs with evidence that validation ran, and the statuses `not_run`, `not_validated`, `unknown` and `uncertain` are not clean for publication or ranking even when every query succeeded ([Result integrity validation](../development/result-integrity-validation.md), [Public contracts](../reference/public-contracts.md)).

The integrity validator reads a result file and reports structural, completeness and believability checks without raising on a failure ([Result integrity validation](../development/result-integrity-validation.md)). A community submission must include a manifest, execute at least one query and report `summary.validation=passed` with no failed measurement evidence ([Contributing results](../contributing-results.md)).

Submissions also run timing-plausibility checks (`timing-plateau`, `small-scale-floor`, `scale-invariant` and the informational `floor-outlier`). The first three block community publication until a committed override covers them, and sub-millisecond rows are excluded from that evidence as timer noise ([Contributing results](../contributing-results.md)).

## When two results are comparable

Comparisons are meaningful only when the workload, scale, phase, configuration, tuning, hardware and evidence are compatible; a shared benchmark name alone is not enough ([README](../../README.md)). The existing sources name these facts:

| Fact | Rule | Source |
|---|---|---|
| Benchmark and scale factor | Compare at the same scale factor. | [Understanding results](../tutorials/understanding-results.md), [Comparing platforms](../tutorials/comparing-platforms.md) |
| Phase | Rankings are kept per benchmark, scale factor and phase. | [Result summary pages](../design/adr-results-summary-pages.md) |
| Tuning mode | `tuning_mode` is the comparability facet and matches exactly; an unrecorded tuning mode never matches `notuning`. | [Tuning mode vocabulary](../development/tuning-adr-002-mode-vocabulary-fallback-facets.md) |
| Execution mode | Exact timing values must not be compared across SQL and DataFrame modes. | [Public contracts](../reference/public-contracts.md) |
| Execution variant | Comparison refuses incomparable deployment, requested engine and gateway combinations and names the parts that differ. | [Execution variants](../development/adr/adr-core-execution-variants.md) |
| Timing mode | Runs are compared and ranked within one timing method. | [Client link locality disclosure](../development/adr/adr-client-link-locality-disclosure.md) |
| Hardware and environment | Compare results with matching `environment` values. | [Data model](data-model.md) |
| Subscale TPC runs | Power@Size for a run below scale factor 1 is for comparison within its subscale cohort only and is not a TPC result. | [Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md) |
| TPC-derived results | They must not be compared with official TPC results. | [TPC trademarks](../benchmarks/tpc-trademarks.md) |

## Tuning disclosure

`--tuning` defaults to `notuning`; use `tuned`, `auto` or a YAML path only for intentionally tuned submissions ([CLI reference: run](../reference/cli/run.md), [Contributing results](../contributing-results.md)). The configuration a run requested and the ledger of what it applied are recorded in the result under `platform.tuning` ([Contributing results](../contributing-results.md)).

- `notuning` means platform defaults plus engine-mandatory schema choices only ([Tuning baseline and single renderer](../development/tuning-adr-003-baseline-and-single-renderer.md)).
- A result's `tuning_mode` must never claim tuning without a `platform.tuning` section ([Tuning baseline and single renderer](../development/tuning-adr-003-baseline-and-single-renderer.md)).
- A missing `tuning_mode` is recorded as "not recorded" and is never turned into `notuning` ([Tuning mode vocabulary](../development/tuning-adr-002-mode-vocabulary-fallback-facets.md)).
- Treat `tuned` as a request for a logical profile, not as proof of an identical storage layout ([TPC tuning profiles](../usage/tpc-tuning-profiles.md)).
- Unless you are specifically benchmarking a tuned configuration, use the defaults ([Contributing results](../contributing-results.md)).

Observed with BenchBox 0.5.0: a default run records `execution.tuning_mode` as `notuning`.

## Host noise

Run on a dedicated machine or instance, not a shared laptop under load ([Contributing results](../contributing-results.md)). Disable unnecessary background processes, use a dedicated system and keep thermal conditions consistent; high variability is a reason to check for system interference or thermal throttling ([Power run guide](../advanced/power-run-concurrent-queries.md)). Investigate queries with more than three times the variance from the baseline ([Data model](data-model.md)). Don't hand-optimize queries or cherry-pick favorable runs ([Contributing results](../contributing-results.md)).

## Publication limits

**TPC-derived results.** BenchBox results for TPC-H and TPC-DS are derived results. A BenchBox run is not an official TPC result: official results require a run that follows the full specification, an independent audit and a published full disclosure report ([TPC trademarks](../benchmarks/tpc-trademarks.md)). When you publish numbers, describe them as derived from the benchmark, for example "TPC-H-derived" or "based on TPC-DS", and do not compare them with official TPC results as if they were equivalent ([TPC trademarks](../benchmarks/tpc-trademarks.md)). BenchBox labels such results with this sentence ([TPC-H](../benchmarks/tpc-h.md)):

> Derived from TPC-H. These results do not comply with the TPC-H Specification and must not be compared with official TPC-H results.

**Official and unofficial.** `--official` marks the run metadata; it is not a claim of TPC compliance ([TPC-H official guide](../guides/tpc/tpc-h-official-guide.md)). Results below scale factor 1 are unofficial subscale results; `benchbox submit` and `benchbox publish` refuse them, so no official TPC metric can be produced from a subscale bundle ([Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md)).

**Licence terms.** TPC query templates and source specifications are subject to the TPC End User License Agreement, and complete copies accompany the bundled tool sources under `_sources/` in the BenchBox repository. Review the TPC's terms and policies before you publish results commercially ([TPC trademarks](../benchmarks/tpc-trademarks.md)). The agreement's public-disclosure clause reads, in part: "any other use of the Software, provided that any performance results must be clearly identified as not being comparable to TPC Benchmark Results unless specifically authorized by TPC" ([TPC-H EULA](../../_sources/tpc-h/EULA.txt)). BenchBox is an independent, beta project ([Disclaimer](../../DISCLAIMER.md)); nothing on this page is a legal opinion.

**Subscale labels travel with the number.** A screenshot or a quoted number can lose its label, so the subscale label is shown on every surface that shows a subscale result: "Subscale · Unofficial" ([Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md)).

## How to cite a published result

Cite a result by its `public_result_id`, the only identifier that is stable across all phases and safe to use in external links ([Hosted results contract](../reference/hosted-results-contract.md)). A `public_result_id` is permanent for a given set of published bytes once those bytes are part of a public Explorer corpus ([Public result id permanence](../development/adr/adr-public-result-id-permanence.md)).

A cited result is fixed to a named snapshot and carries the snapshot's SHA-256 and date, so analysis does not change after publication. Do not type the values by hand: print the block with `npm run results:cite -w website -- <result id>` in the site repository ([Results embeds](../design/results-embeds.md)). A result withdrawn from the snapshot cannot be cited ([Results embeds](../design/results-embeds.md)).

## Subscale ranking decision

TPC-H and TPC-DS runs below scale factor 1 are recorded as `unofficial_subscale` results and stay ranked by Power@Size, in their own cohort. Only non-standard runs are excluded from ranking: non-standard runs at scale factor 1 and above remain unranked ([Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md), decisions 1 and 7).

## Open questions

Some questions have no written policy yet, so this page does not answer them. Vendor terms on publishing benchmark results are one of them: the page asserts nothing about what any vendor's terms allow.
