---
tags: [concept, intermediate, validation]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Benchmark Methodology

How to run a sound benchmark with BenchBox, and what a result at a given scale factor and iteration count supports.

This page gathers policy that is already written down elsewhere in the documentation, the decision records and the validator rules. Every statement that says what to do or what not to do links to the page that sets it, except the rules under [Provisional policy](#provisional-policy), which are the project's amendable provisional answers and name their source. It is not legal advice.

## What a scale factor supports

BenchBox accepts scale factors from 0.01 to 100000 (to 3000 for TPC-DS and TPC-DS-OBT), and each benchmark has a short set of standard scale factors, typically 0.01, 0.1, 1 and 10. A scale factor outside the benchmark's standard set runs with a one-line note that its results are not comparable with published results ([Benchmarks overview](../benchmarks/index.md)).

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
| Timing mode | Runs are compared and ranked within one timing method; maintenance timings from different methods are not comparable. | [Client link locality disclosure](../development/adr/adr-client-link-locality-disclosure.md), [Maintenance phase guide](../guides/tpc/maintenance-phase-guide.md) |
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

Third parties cite a result in this form:

```text
BenchBox <version>, result <public_result_id>, <permalink>, accessed <date>. Not an official TPC result.
```

The version is the BenchBox release that produced the result when the bundle records it. When the bundle does not, the version is inferred as the latest release published on or before the run date, and the line reads `BenchBox <version> (inferred from run date)`. The id is the `public_result_id`, the permalink is the result's page URL, and the date is the day the citing party read the result. The subscale or derived label travels with the number, as [Publication limits](#publication-limits) describes. Every result page and result summary page prints this line for each result, with the date the page was built; replace it with the day you read the result.

## Hardware class

Every published result carries a hardware class, so a ranking can be filtered to results from comparable hardware. The class never changes a result's rank: the default ranking stays hardware-agnostic, and the Explorer offers the class as a filter only where it has at least three ranked platforms in the cohort, so a filtered ranking keeps the three-identity minimum.

The class comes from a pinned, versioned CPU class table (table version `2026-11-17.1`). A result's score is the table's per-thread factor for its CPU model times the logical CPUs the run could see, in BenchBox CPU units relative to one AMD EPYC 7763 SMT thread. A CPU quota or CPU set below that count is not read, so a limited container is scored on the CPUs it can see. The unit is BenchBox's own and is never a SPEC metric. Tiers are bands four times wide with edges at 2.5, 10, 40, 160 and 640 units: T0 is below 2.5, T1 from 2.5 to 10, T2 from 10 to 40, T3 from 40 to 160, T4 from 160 to 640 and T5 from 640 up.

A result whose CPU model is known but whose core count is missing gets a tier only when every core count that model ships with lands in one tier; its score stays empty. A container takes the host model when the launcher records it. With a host vendor of Apple and no model, the Apple M4 factor times the visible CPU count is used and the basis says so. A bundle with no CPU model takes one only from a maintainer's attestation, and the basis says the model was attested. Anything else is `unclassified` and is never guessed. A managed service is one `managed` class that is never CPU-tiered; its server-side size is shown as an attribute. A run against a server whose host was not observed is `unclassified`, because the recorded CPU is the client's.

| CPU | Per-thread factor | Stand-in | Estimated |
|---|---|---|---|
| AMD EPYC 7763 | 1.00 | None | No |
| Intel Xeon Platinum 8370C | 1.08 | Intel Xeon Platinum 8380 | Yes |
| AMD EPYC 9V74 | 1.31 | AMD EPYC 9654 and 9634 | Yes |
| Intel Xeon Platinum 8573C | 1.33 | Intel Xeon Platinum 8580 | Yes |
| Intel Xeon 6973P-C | 1.64 | Intel Xeon 6972P | Yes |
| AMD EPYC 9V45 | 1.68 | AMD EPYC 9655 | Yes |
| Apple M4 | 2.27 | None | Yes |

The x86 factors are the median SPECrate2017_int_base result per copy from SMT-enabled published results, divided by 3.20, the EPYC 7763 median. A row marked estimated uses a retail sibling as a stand-in because the cloud-only part has no published result. The Apple M4 factor is a bridge from Blender Open Data Cycles runs to the EPYC 7763 per thread. Every factor was retrieved on 2026-11-17.

> [!NOTE]
> SPEC and SPECrate are registered trademarks of the Standard Performance Evaluation Corporation. BenchBox CPU units are derived values computed by BenchBox from published SPEC CPU2017 results. They are not SPEC metrics and are not comparable with any SPEC result. SPEC CPU2017 retires on 2026-11-17, and the table is not rebased to SPEC CPU2026 until that suite covers the same processors; results of the two suites must not be mixed.
>
> Apple Silicon factors use Blender Open Data, released under CC0 ([Blender Open Data](https://opendata.blender.org)).

A change to a factor makes a new table version, and moving a CPU across a tier edge is a reviewed change listed in the changelog. The class, score, basis and table version of every result are recorded in the Explorer snapshot's read model 20.

## Subscale ranking decision

TPC-H and TPC-DS runs below scale factor 1 are recorded as `unofficial_subscale` results and stay ranked by Power@Size, in their own cohort. Only non-standard runs are excluded from ranking: non-standard runs at scale factor 1 and above remain unranked ([Subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md), decisions 1 and 7).

## Provisional policy

The rules in this section are the project's provisional answers to questions that no earlier page settled. Each is derived from how the project already runs its own nightly gates and its result checks, and each was recorded in the core repository's decision record "Provisional benchmark methodology policy" ([source](https://github.com/BenchBox-dev/benchbox/blob/develop/docs/internal/adr/adr-benchmark-methodology-provisional-policy.md)). The project owner may amend any of them, and an amendment changes the record and this page together. "Enforced" says whether BenchBox code or CI applies the rule today; a rule marked not enforced is guidance, and no tool rejects a result for breaking it.

| Question | Provisional rule | Enforced | Derived from |
|---|---|---|---|
| Minimum iterations | A result presented as a measurement has one warm-up and at least three measured iterations, which is the default. A run with fewer measured iterations is exploratory and is described that way. Baselines for regression gates are built from at least five separate runs. | No | The `benchbox run` default; the nightly perf gate (three measured iterations after one warm-up); the baseline builder's five-run minimum |
| Aggregating repeated runs | Across separate runs, take the median of each query. Report the minimum and maximum alongside it and publish every run; do not pick the fastest. Within one run, Power@Size keeps using the final iteration. | Final iteration only | The baseline builder; the [cross-benchmark score decision](../development/adr/adr-cross-benchmark-power-throughput-scores.md) |
| Noise thresholds | Measure the noise floor instead of assuming it: 1.25 times the largest spread of a query across at least five runs on one runner class, rounded up to a whole millisecond, recomputed whenever the baseline is refreshed. There is no maximum host load, coefficient of variation or confidence interval. `environment.host_load` records load at the start and end of a run for review. | The nightly gate floors only | The nightly performance gate |
| Cold against warm | Published and ranked results are warm-state results: measured iterations follow a warm-up pass, with the platform's result cache disabled. No result is called cold unless a platform has a replayable, verified cold-start procedure. | Result-cache disabling at submission | [Contributing results](../contributing-results.md); the cache-state rule in the cross-benchmark score decision |
| Seed | A seedless run (`qgen -d`) and a seeded run (`qgen -r`) use different parameter conventions, and different seeds are different workloads, so compare and rank only runs with the same recorded convention and seed. Non-official runs need no seed; official mode requires one. | Official mode only | [CLI reference: run](../reference/cli/run.md); [Public contracts](../reference/public-contracts.md) |
| Hardware and tuning | `tuning_mode` must match exactly. Hardware is an optional filter on a ranking, not a cohort key: the default ranking stays hardware-agnostic, every result discloses its environment, and the [hardware class](#hardware-class) filters a ranking where the class has at least three ranked platforms in the cohort. A comparison across different hardware says so. A regression or throughput gate compares only runs from the same runner class. | Tuning mode, the hardware class filter, and the per-class gates | [Tuning mode vocabulary](../development/tuning-adr-002-mode-vocabulary-fallback-facets.md); [Result summary pages](../design/adr-results-summary-pages.md); the nightly gates |
| Non-standard scale, non-TPC benchmarks | A scale outside the benchmark's standard set is labelled not comparable with published results, is not submitted for ranking and is compared only with runs at the identical scale factor. | Scale range only | [Benchmarks overview](../benchmarks/index.md); the exclusion of non-standard TPC runs in the [subscale ranking policy](../development/adr/adr-subscale-tpc-ranking-policy.md) |
| Scale factor by purpose | Smoke: 0.01. Regression: 0.01 for the nightly gate, otherwise the one scale the baseline was built at. Comparison: the identical scale factor; at scale factor 1 or above a TPC-H or TPC-DS run avoids the subscale cohort. Publication: an `official` TPC run at scale factor 1 or above, or another benchmark's standard scale with its label. Where a benchmark page's size table differs, the page's accepted scales decide what is allowed and this row decides the purpose. | Compliance gate for TPC | The benchmark pages; the nightly gate; [Contributing results](../contributing-results.md) |
| Regression thresholds | A regression is a slowdown of more than 10% and also more than the measured absolute floor above. The throughput gate fails below 80% of the median of the latest 10 records from the same runner class, and only reports until it has five. New gates use these values unless their measurements show otherwise. | The two nightly gates | The nightly performance and throughput gates |

One question is open and is the project owner's to decide; this page asserts nothing for it: whether the "Derived from" wording satisfies clause 4c(3) of the TPC End User License Agreement, which asks that results be "clearly identified as not being comparable to TPC Benchmark Results". [Publication limits](#publication-limits) shows the wording BenchBox uses today.

Vendor terms on publishing benchmark results are recorded separately and the page asserts nothing about what any vendor's terms allow. For the conditions that `benchbox submit` records and enforces today, see the [vendor publishing checklist](../vendor-publishing-checklist.md).
