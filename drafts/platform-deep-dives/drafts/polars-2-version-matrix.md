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

**TL;DR**: Polars 2.0 changes the default engine for lazy queries to streaming, stops guaranteeing row order for joins and group-bys, and removes long-deprecated APIs. Porting BenchBox's four benchmark suites took three small fixes. With default settings, 2.0.0 and 2.1.0 took 36% to 53% less time than 1.44.2 on TPC-H, SSB and ClickBench at scale factor 10, and 2.0.0 finished TPC-DS on a 16 GiB machine where no 1.x default run did. If you already pass `engine="streaming"` on 1.44.2, the step is smaller: 8% to 28% less time. If you stay on the in-memory engine, 2.0.0 was no faster.

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
| Already passing `engine="streaming"` on 1.44.2 | 2.x took 8% to 28% less time on those three; 2.0.0 took 41% less on TPC-DS |
| Keeping the in-memory engine | 2.0.0 was 4% to 16% slower with overlapping ranges; 2.1.0 ranged from 2% slower to 13% faster |
| Memory-bound on a 16 GiB machine | No 1.x default run finished TPC-DS; 2.0.0 finished every round without spilling |
| Code that relies on row order | Not measured |

### A bare `collect()`: 36% to 53% less time

This is what you get by upgrading and changing nothing. Times are in seconds, as median (min-max).

| Benchmark | 1.44.2 | 2.0.0 | 2.1.0 | 2.0.0 change | 2.1.0 change |
|---|---|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 6.53 (6.06-7.59) | 6.16 (6.04-6.73) | -41.7% | -45.0% |
| SSB | 5.61 (5.15-7.07) | 3.58 (3.30-4.08) | 3.31 (3.31-3.94) | -36.2% | -41.0% |
| ClickBench | 4.58 (4.34-4.67) | 2.31 (2.17-2.33) | 2.16 (2.02-2.37) | -49.6% | -52.8% |

That is 1.6x to 2.1x faster. In every pair the ranges do not overlap. TPC-DS is covered under [memory](#memory-on-a-16-gib-machine), because 1.44.2 did not finish it on the default engine.

### Already on streaming in 1.x: a smaller step

Most of that gain comes from the engine, and the streaming engine was already available in 1.x. On 1.44.2, passing `engine="streaming"` took 27% to 42% less time than the in-memory default:

| Benchmark | 1.44.2 in-memory | 1.44.2 streaming | Change |
|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 8.06 (8.02-8.28) | -28.1% |
| SSB | 5.61 (5.15-7.07) | 4.11 (4.05-4.69) | -26.8% |
| ClickBench | 4.58 (4.34-4.67) | 2.64 (2.57-3.09) | -42.4% |

Measured this way, the engine switch alone accounts for about two-thirds to most of the default-settings gain: 62% to 86% of the time saved, depending on the benchmark and on whether the target is 2.0.0 or 2.1.0.

So the step from 1.44.2 streaming to 2.x streaming is smaller:

| Benchmark | 1.44.2 streaming | 2.0.0 streaming | 2.1.0 streaming |
|---|---|---|---|
| TPC-H | 8.06 (8.02-8.28) | 6.32 (6.12-7.61), -21.5% | 5.83 (5.75-6.55), -27.7% |
| SSB | 4.11 (4.05-4.69) | 3.79 (3.31-4.02), -7.8% | 3.45 (3.45-3.93), -15.9% |
| ClickBench | 2.64 (2.57-3.09) | 2.21 (2.20-2.44), -16.1% | 2.30 (2.12-2.39), -12.6% |
| TPC-DS | 62.27 (59.91-66.54) | 36.53 (33.85-44.86), -41.4% | not reported |

The streaming engine itself got faster between 1.44.2 and 2.x, most of all on TPC-DS. There is no 2.1.0 figure for TPC-DS; the [memory section](#memory-on-a-16-gib-machine) explains why.

### Staying on the in-memory engine

If you pin `engine="in-memory"` after upgrading, or your code is eager, this is the closest evidence we have. We measured lazy queries with the engine pinned, not the eager API.

| Benchmark | 1.44.2 in-memory | 2.0.0 in-memory | 2.1.0 in-memory |
|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 12.94 (11.47-13.28), +15.5% | 10.58 (10.21-12.71), -5.6% |
| SSB | 5.61 (5.15-7.07) | 5.97 (5.56-7.60), +6.3% | 5.73 (5.18-6.90), +2.2% |
| ClickBench | 4.58 (4.34-4.67) | 4.77 (4.54-4.99), +4.2% | 3.99 (3.90-4.30), -12.9% |

On 2.0.0 the medians are 4% to 16% higher than on 1.44.2, with overlapping ranges, so we cannot call it slower or faster. On 2.1.0 the in-memory engine is within 6% on TPC-H and SSB and 12.9% faster on ClickBench, where the ranges do not overlap.

### 2.0.0 or 2.1.0

On the default and streaming engines the two releases are close: 2.1.0's medians run from 8.8% lower to 4.1% higher than 2.0.0's, and every pair of ranges overlaps. In memory, 2.1.0 is faster on all three benchmarks, by 3.9% to 18.3%.

## Memory on a 16 GiB machine

The announcement expects "huge improvements in memory usage"[^2] from the streaming default. We saw that in two ways.

**Peak memory fell on the default engine.** This table shows peak resident memory in GiB, summed over the process tree, for the largest of three rounds. Host swap growth during these runs was at most 0.22 GiB, so the readings are comparable.

| Benchmark | 1.44.2 default | 1.44.2 streaming | 2.0.0 default | 2.1.0 default |
|---|---|---|---|---|
| TPC-H | 6.73 | 5.00 | 5.45 | 3.20 |
| SSB | 5.36 | 2.28 | 2.33 | 2.17 |
| ClickBench | 2.86 | 2.84 | 2.36 | 1.94 |

As with time, part of the saving was already available on 1.44.2 by choosing the streaming engine: all of it on SSB, none of it on ClickBench. Pinned to the in-memory engine, 2.x peaks stayed near 1.x levels: 5.23 and 6.01 GiB on TPC-H for 2.0.0 and 2.1.0, 5.71 and 6.08 GiB on SSB, and 3.12 and 3.04 GiB on ClickBench.

**TPC-DS finished where it had not.** TPC-DS at SF10 is the heaviest workload we ran. On the default engine, every run on 1.31.0, 1.35.2, 1.40.1 and 1.44.2 was stopped as the machine went into swap; the largest swap growth for each release was 6.8 to 7.9 GiB. On 2.0.0 the default engine finished all three rounds in 34.13 s (30.91-36.43), with at most 0.09 GiB of host swap growth and nothing spilled to disk. Streaming on 1.44.2 also finished, in 62.27 s (59.91-66.54).

**We cannot report 2.1.0 on TPC-DS.** Its default and streaming runs finished every round with every query successful, in 34.67 to 42.13 s and 36.26 to 40.74 s per run, and each spilled about 0.5 GiB to disk. The machine also swapped 1.0 to 5.9 GiB while they ran. Our rule discards any run during which the host swaps more than 1 GiB, and it counts swap for the whole machine, on which other work was running. We do not know whether 2.1.0 caused that swap, so we draw no conclusion about its TPC-DS speed or memory use.

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

A result is reported only when all three rounds finished within our memory rules. Three rounds cannot support a significance test, so we treat a difference as worth following up when the median moves by at least 10% and the two ranges do not overlap. The engine-switch shares, the 2.1.0-against-2.0.0 comparisons and the memory table are computed from the published per-benchmark medians and peaks.

The [findings](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/findings.md) list every result, including the 1.x releases and the runs that did not qualify. The [methodology](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/methodology.md) gives the rules in full, and the [analysis JSON](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json) holds the numbers.

## Limits

- **One machine, one scale.** A 16 GiB laptop at SF10. With more memory, the in-memory engine may not hit the limits that stopped it here.
- **Analytical queries over Parquet.** Lazy scans, joins and aggregations. We did not measure the eager API, CSV input, cloud storage or writes.
- **A busy host.** Other work ran on the machine. The 1-minute load average before each run was 10.8 to 43.1 (median 16.8). The 2.0.0 default-settings results matched a run we made a month earlier to within 2.1 percentage points.
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
- **How much depends on where you start:** if you already use the streaming engine on 1.44.2, the gain is 8% to 28% on those benchmarks. If you stay in memory, 2.0.0 was no faster and 2.1.0 was faster on one benchmark of three.

Two things remain open on our side: whether 2.1.0 or the rest of our machine caused the swap in its TPC-DS runs, and why 1.31.0 crashes on streaming TPC-DS. If you have measured the upgrade on other hardware or other workloads, we would like to hear what you found.

---

## References

[^1]: [polars release history](https://pypi.org/project/polars/#history) - PyPI, accessed November 2026
[^2]: [Pre-release of Polars 2.0](https://pola.rs/posts/announcing-polars-2/) - Polars, published September 2, 2026, accessed November 2026
[^3]: [Version 2.0 upgrade guide](https://docs.pola.rs/releases/upgrade/2/) - Polars documentation, accessed November 2026
[^4]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741), accessed November 2026
[^5]: [Polars 2.1.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.1.0) - "Streaming OOC group-by with shuffles" (#29911), accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
