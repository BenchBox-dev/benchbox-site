---
blogpost: true
date: [TODO: set on publication]
author: Joe Harris
series: platform-deep-dives
type: benchbox-in-action
tags: polars, dataframe, upgrade, tpc-h, tpc-ds, ssb, clickbench, benchmarking
meta_description: "What changed in Polars 2.x, what porting four benchmark suites cost us, and how its speed and memory use compared with 1.x on TPC-H, SSB, ClickBench and TPC-DS."
---

# Upgrading to Polars 2.x: What Changed, What We Measured

> Polars 2.x runs lazy queries on the streaming engine by default. We ported four benchmark suites to it and ran six releases side by side to see what the upgrade costs and what it returns.

**TL;DR**: Polars 2.0 changes the default engine for lazy queries to streaming, stops guaranteeing row order for joins and group-bys, and removes long-deprecated APIs. Porting BenchBox's four benchmark suites took three small fixes. With default settings, 2.0.0 and 2.1.0 took 36% to 53% less time than 1.44.2 on TPC-H, SSB and ClickBench at scale factor 10, and 2.0.0 finished TPC-DS on a 16 GiB machine where no 1.x default run did. If you already pass `engine="streaming"` on 1.44.2, the step is smaller: 14% to 29% less time. If you stay on the in-memory engine, 2.x was within 8% of 1.44.2. On TPC-DS, 2.1.0 used more memory than 2.0.0 and ran about 12% slower on our machine.

---

## Introduction

Polars 2.0.0 was released on 2026-10-06 and 2.1.0 on 2026-10-25[^1]. If you run Polars 1.x today, two questions decide whether to upgrade: what will the new version change in your code and results, and what do you get back?

The Polars team describes 2.0 as a release about defaults, not features: "We don't aim to make a big feature release of Polars 2.0. In fact we hope it to be a boring experience for you."[^2] The default that matters most is the engine. In 2.x, calling `collect()` on a `LazyFrame` runs the query on the streaming engine. In 1.x it ran on the in-memory engine.

BenchBox runs TPC-H, TPC-DS, SSB and ClickBench as Polars DataFrame queries, so we had to make the same upgrade. This post reports what changed, what the port cost us, and what we measured across six Polars releases from 1.31.0 to 2.1.0: time, memory, and where our evidence stops. Our measurements cover lazy analytical queries over Parquet files on one 16 GiB laptop. They say nothing about eager code, CSV pipelines or cloud storage.

## What changed in 2.0

The migration guide lists every breaking change[^3]. Four groups matter for most code.

**Lazy queries run on the streaming engine.** `collect()` still defaults to `engine="auto"`, and `"auto"` now resolves to streaming for lazy queries[^3]. SQL run through `pl.sql(..., eager=True)` follows the same path. Eager `DataFrame` operations still run in memory, so code that never builds a `LazyFrame` does not get the new default.

**Row order is no longer guaranteed where the operation does not need it.** This is the reason for the major version. The streaming engine does not preserve input order through `join`, `group_by`, `unpivot` and similar operations, and the guide warns: "This change may silently impact the results of your pipelines."[^3] If code relies on the order rows happened to come back in, sort explicitly or pass `maintain_order`:

```python
left.join(right, on="k", how="left", maintain_order="left").collect()
```

**Polars is stricter.** Operations that used to coerce or pad silently now raise. `is_in` no longer casts both sides to a lossy common type, horizontal `concat` requires equal heights, and several casts are gone in favor of dedicated methods: string to date is now `.str.to_date()`[^2].

**Deprecated APIs are removed.** `melt`, `with_row_count`, `LazyFrame.fetch`, `group_by(...).count()` and the reader `rechunk=` argument are among those removed[^3]. Most raise one of two new exceptions, `AttributeRemovedError` or `ArgumentRemovedError`, with a message that names the replacement[^2].

Two more changes affect how queries behave under memory pressure. Polars 2.0.0 turns out-of-core execution on by default, which lets the streaming engine write intermediate data to disk (spill) when memory runs short; the threshold is 80% of available RAM[^4]. And 2.1.0 extends that work, including an out-of-core group-by[^5].

To keep the old engine after upgrading, set it once per process, per query, or in the environment[^3]:

```python
pl.Config.set_engine_affinity("in-memory")   # process-wide
lf.collect(engine="in-memory")               # one query
# or: POLARS_ENGINE_AFFINITY=in-memory
```

## What the port cost us

BenchBox's Polars DataFrame platform runs 181 queries: 22 for TPC-H, 103 for TPC-DS, 13 for SSB and 43 for ClickBench. Running them on 2.0 needed [three fixes](https://github.com/BenchBox-dev/BenchBox/pull/2771), all in shared helper code and none in a query:

1. **Reader `rechunk=`.** Removed from `scan_csv` and `scan_parquet`. Every table load failed until we stopped passing it on 2.x.
2. **A renamed CSV keyword.** `missing_utf8_is_empty_string=` became `empty_string_is_null=`, with the boolean inverted.
3. **String-to-date casts.** Our date helper now calls `str.to_date()` for string input.

BenchBox supports Polars from 1.35.2 upward, so each fix had to work on both major versions. No single CSV keyword exists across that range, and we choose it from the installed function's signature.

After the fixes, all four suites passed our value comparison against DuckDB SQL on every 2.x engine setting we tested, at a small scale factor. That check compares row order only where the SQL has an `ORDER BY`, so it shows our queries did not break. It does not show that code relying on incidental order is safe. We also added a CI job that reruns the four suites at a small scale factor on Polars 2.0.0.

If your code has kept up with deprecation warnings on recent 1.x releases, our experience suggests a short list of mechanical fixes. The row-order change is the one to audit by reading code, because nothing raises.

## What we measured, by situation

We ran each release at scale factor 10 (SF10; for TPC-H, about 10 GB of raw data) under three engine settings: the version's default, in-memory, and streaming. Every figure below is the sum of per-query times for one benchmark, as the median of three rounds; ranges are in the tables that follow.

| Your situation | What we measured |
|---|---|
| Lazy queries with a bare `collect()` | 2.x took 36% to 53% less time than 1.44.2 on TPC-H, SSB and ClickBench |
| Already passing `engine="streaming"` on 1.44.2 | 2.x took 14% to 29% less time on those three; 2.0.0 took 45% less on TPC-DS |
| Keeping the in-memory engine | 2.x was within 8% of 1.44.2, faster on some benchmarks and slower on others |
| Memory-bound on a 16 GiB machine | No 1.x default run finished TPC-DS; 2.0.0 finished every round without swapping or spilling |
| Code that relies on row order | Not measured |

### A bare `collect()`: 36% to 53% less time

This is what you get by upgrading and changing nothing. Times are in seconds, as median (min-max).

| Benchmark | 1.44.2 | 2.0.0 | 2.1.0 | 2.0.0 change | 2.1.0 change |
|---|---|---|---|---|---|
| TPC-H | 11.17 (10.68-12.23) | 6.11 (6.02-6.13) | 5.75 (5.54-6.05) | -45.3% | -48.5% |
| SSB | 5.18 (5.01-6.60) | 3.28 (3.20-3.47) | 3.32 (3.25-3.38) | -36.8% | -36.0% |
| ClickBench | 4.32 (4.29-4.70) | 2.10 (2.10-2.27) | 2.05 (2.03-2.11) | -51.4% | -52.5% |

That is 1.6x to 2.1x faster. In every pair the ranges do not overlap. TPC-DS is covered under [memory](#memory-on-a-16-gib-machine), because 1.44.2 did not finish it on the default engine.

### Already on streaming in 1.x: a smaller step

Most of that gain comes from the engine, and the streaming engine was already available in 1.x. On 1.44.2, passing `engine="streaming"` took 19% to 41% less time than the in-memory default:

| Benchmark | 1.44.2 in-memory | 1.44.2 streaming | Change |
|---|---|---|---|
| TPC-H | 11.17 (10.68-12.23) | 7.75 (7.49-8.16) | -30.7% |
| SSB | 5.18 (5.01-6.60) | 4.19 (4.18-4.47) | -19.1% |
| ClickBench | 4.32 (4.29-4.70) | 2.55 (2.42-2.69) | -41.0% |

Measured this way, the engine switch alone accounts for about half to four-fifths of the default-settings gain: 52% to 80% of the time saved, depending on the benchmark and on whether the target is 2.0.0 or 2.1.0.

So the step from 1.44.2 streaming to 2.x streaming is smaller:

| Benchmark | 1.44.2 streaming | 2.0.0 streaming | 2.1.0 streaming |
|---|---|---|---|
| TPC-H | 7.75 (7.49-8.16) | 6.05 (5.96-6.62), -21.9% | 5.51 (5.43-5.87), -28.8% |
| SSB | 4.19 (4.18-4.47) | 3.35 (3.26-3.50), -20.2% | 3.31 (3.23-3.31), -21.2% |
| ClickBench | 2.55 (2.42-2.69) | 2.19 (2.11-2.23), -14.2% | 2.07 (2.01-2.15), -19.0% |
| TPC-DS | 57.21 (56.48-60.54) | 31.26 (30.40-33.14), -45.4% | not reported |

The streaming engine itself got faster between 1.44.2 and 2.x, most of all on TPC-DS. There is no qualified 2.1.0 figure for TPC-DS; the [memory section](#memory-on-a-16-gib-machine) explains why and gives its run times.

### Staying on the in-memory engine

If you pin `engine="in-memory"` after upgrading, or your code is eager, this is the closest evidence we have. We measured lazy queries with the engine pinned, not the eager API.

| Benchmark | 1.44.2 in-memory | 2.0.0 in-memory | 2.1.0 in-memory |
|---|---|---|---|
| TPC-H | 11.17 (10.68-12.23) | 10.39 (9.78-10.61), -7.0% | 10.85 (9.71-13.36), -2.9% |
| SSB | 5.18 (5.01-6.60) | 5.23 (4.93-5.33), +0.9% | 5.44 (4.96-5.63), +4.9% |
| ClickBench | 4.32 (4.29-4.70) | 4.25 (4.18-4.55), -1.8% | 3.97 (3.80-4.06), -8.1% |

Every difference is under 10%, which is below what three rounds can separate from noise. On the in-memory engine we saw no clear change in speed from upgrading.

### 2.0.0 or 2.1.0

On TPC-H, SSB and ClickBench the two releases are close on every engine setting: 2.1.0's medians run from 8.8% lower to 4.4% higher than 2.0.0's. They differ on TPC-DS, which the next section covers.

## Memory on a 16 GiB machine

The announcement expects "huge improvements in memory usage"[^2] from the streaming default. We saw that in two ways, and one exception.

**Peak memory fell on the default engine.** This table shows peak resident memory in GiB, summed over the process tree, for the largest of three rounds. The machine swapped at most 0.11 GiB during these runs.

| Benchmark | 1.44.2 default | 1.44.2 streaming | 2.0.0 default | 2.1.0 default |
|---|---|---|---|---|
| TPC-H | 5.77 | 3.15 | 4.62 | 4.59 |
| SSB | 5.06 | 2.23 | 2.23 | 1.93 |
| ClickBench | 2.89 | 2.85 | 2.20 | 2.17 |

Treat these as a rough guide. A single peak reading for the same configuration moved by up to 1.9 GiB between two runs of our matrix. The direction was the same both times: on each benchmark, 2.x on its default engine peaked lower than 1.44.2 on its default. As with time, part of that saving was already available on 1.44.2 by choosing the streaming engine. Pinned to the in-memory engine, 2.x peaks were 5.67 to 7.20 GiB on TPC-H and SSB and 2.43 to 3.62 GiB on ClickBench, no clear improvement on 1.44.2.

**TPC-DS finished where it had not.** TPC-DS at SF10 is the heaviest workload we ran. On the default engine, every run on 1.31.0, 1.35.2, 1.40.1 and 1.44.2 was stopped as the machine went into swap; the largest swap growth for each release was 4.6 to 8.8 GiB. On 2.0.0 the default engine finished all three rounds in 30.47 s (29.68-32.83), with no swap growth and nothing spilled to disk. Streaming on 1.44.2 also finished, in 57.21 s (56.48-60.54).

**The exception: 2.1.0 needed more memory than 2.0.0 on TPC-DS.** Its default and streaming runs finished every round with every query successful. But each run spilled 0.47 to 0.49 GiB to disk, and the machine swapped 0.25 to 4.25 GiB while each one ran. In the same matrix, 2.0.0 spilled nothing and the machine swapped at most 0.014 GiB.

| TPC-DS, default engine | Round 1 | Round 2 | Round 3 | Spilled per run | Swap while running |
|---|---|---|---|---|---|
| 2.0.0 | 29.68 s | 30.47 s | 32.83 s | none | none |
| 2.1.0 | 33.69 s | 34.08 s | 35.72 s | 0.47 GiB | 0.25 to 1.31 GiB |

Every 2.1.0 run was slower than every 2.0.0 run, by about 12% at the middle round.

We do not publish a median for a benchmark unless all three rounds stay under 1 GiB of swap, because swapping distorts timings. Four of the six 2.1.0 runs went over, so 2.1.0 has no qualified TPC-DS figure in our tables. Our swap reading covers the whole machine, not only the benchmark. We saw the same pattern in an earlier run while other work was active, and reran the whole matrix with nothing else running to check it. The pattern held. We did not test why; the 2.1.0 release notes list several changes to out-of-core execution[^5].

On a machine with more memory this may not happen at all. On 16 GiB, with a workload near the limit, 2.0.0 was the better release for TPC-DS in our runs.

## What we could not measure: row order

The row-order change is the largest risk in the upgrade and the one our benchmarks say least about. Benchmark queries either end in an `ORDER BY` or have no defined order, and our value checks compare rows as a set when the SQL has no `ORDER BY`. All four suites passed on the streaming engine, which tells you that explicitly ordered analytical queries came through unchanged. It tells you nothing about a pipeline that depends on a join returning rows in left-hand order.

For that, test your own code. Run it on 2.x once with the default engine and once with `engine="in-memory"`, and compare the outputs without sorting them first.

## How we measured

- **Hardware**: Apple M4, 10 cores, 16 GiB RAM, macOS 27.0.1
- **Software**: Python 3.12.15; Polars 1.31.0, 1.35.2, 1.40.1, 1.44.2, 2.0.0 and 2.1.0; BenchBox at commit `82e76af81` for every run
- **Benchmarks**: TPC-H, TPC-DS, SSB and ClickBench at SF10, read from Parquet through BenchBox's `polars-df` platform
- **Configuration**: `POLARS_MAX_THREADS=10`, no tuning
- **Methodology**: one warm-up pass and one measured pass per query; three rounds, 156 runs, with run order shuffled in each round
- **Correctness**: every version and engine setting first passed a value-level check against DuckDB SQL results at a small scale factor; at SF10 each run had to match DuckDB's row count on every query
- **Host**: no other benchmark or agent work was running when the matrix started; we did not monitor the machine for other activity while it ran

A result is reported only when all three rounds finished within our memory rules. Three rounds cannot support a significance test, so we treat a difference as worth following up when the median moves by at least 10% and the two ranges do not overlap. The engine-switch shares, the 2.1.0-against-2.0.0 comparisons and the memory table are computed from the published per-benchmark medians and peaks.

We ran this matrix three times. The figures here are from the third run, made on 2026-11-20 on a quiet machine. The default-settings result for 2.0.0 was within 4 percentage points on every benchmark across all three.

The [findings](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/findings.md) list every result, including the 1.x releases, the runs that did not qualify and a comparison of the three runs. The [methodology](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/methodology.md) gives the rules in full, and the [analysis JSON](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json) holds the numbers.

## Limits

- **One machine, one scale.** A 16 GiB laptop at SF10. With more memory, the in-memory engine may not hit the limits that stopped it here, and 2.1.0 may not swap on TPC-DS.
- **Analytical queries over Parquet.** Lazy scans, joins and aggregations. We did not measure the eager API, CSV input, cloud storage or writes.
- **Small differences are noise.** In an earlier run on a busy machine, 2.0.0 looked up to 16% slower than 1.44.2 on the in-memory engine. That did not repeat on a quiet machine. We would not act on any difference here below 10%.
- **Swap is measured for the whole machine.** Our rule cannot tell the benchmark's swap from another process's. That is why the 2.1.0 TPC-DS result rests on two runs showing the same pattern, not on a direct measurement.
- **Row counts at SF10.** Values were checked at small scale factors only. TPC-DS query 41 returns 10 rows on Polars and 12 on DuckDB on every version.
- **Requested engine.** We recorded the engine each run asked for, not whether streaming operators fell back to in-memory execution.
- **The 5x expectation.** The announcement says: "In aggregate we expect the streaming engine to be easily 5x faster."[^2] Our four benchmarks on one small machine showed 1.6x to 2.1x at default settings. That neither confirms nor contradicts an aggregate over other workloads.

## Try it on your own workload

To see what the engine change alone does to your queries, name the engine on the version you already run:

```python
lf.collect(engine="streaming")
```

Then install 2.x and compare the default against `engine="in-memory"`.

To rerun one of our measurements, install the Polars version you want and run:

```bash
$ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
    --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
    --ignore-memory-warnings --platform-option rechunk=false \
    --execution-engine streaming
```

Change `--execution-engine` to `default` or `in-memory` for the other settings, and `--benchmark` to `tpcds`, `ssb` or `clickbench`.

## Conclusions

- **What changes:** lazy queries move to the streaming engine, row order is no longer guaranteed through joins and group-bys, silent coercions now raise, and long-deprecated APIs are gone.
- **What it cost us:** three mechanical fixes for 181 queries. The row-order change needs a code audit, because it raises no error.
- **What it returned:** with a bare `collect()`, 36% to 53% less time on three benchmarks, lower peak memory, and a TPC-DS run that finishes on 16 GiB.
- **How much depends on where you start:** if you already use the streaming engine on 1.44.2, the gain is 14% to 29% on those benchmarks. If you stay in memory, we saw no clear change.
- **2.0.0 or 2.1.0:** close on three benchmarks. On TPC-DS at the edge of our machine's memory, 2.1.0 spilled, swapped and ran about 12% slower than 2.0.0.

Two things remain open on our side: why 2.1.0 needs more memory than 2.0.0 for TPC-DS, and why 1.31.0 crashes on streaming TPC-DS. If you have measured the upgrade on other hardware or other workloads, we would like to hear what you found.

---

## References

[^1]: [polars release history](https://pypi.org/project/polars/#history) - PyPI, accessed November 2026
[^2]: [Pre-release of Polars 2.0](https://pola.rs/posts/announcing-polars-2/) - Polars, published September 2, 2026, accessed November 2026
[^3]: [Version 2.0 upgrade guide](https://docs.pola.rs/releases/upgrade/2/) - Polars documentation, accessed November 2026
[^4]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741), accessed November 2026
[^5]: [Polars 2.1.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.1.0) - "Streaming OOC group-by with shuffles" (#29911) and "Wait for spills while over the out-of-core memory budget" (#30294), accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
