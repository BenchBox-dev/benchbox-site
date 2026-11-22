---
blogpost: true
date: [TODO: set on publication]
author: Joe Harris
series: platform-deep-dives
type: benchbox-in-action
tags: polars, dataframe, upgrade, tpc-h, tpc-ds, ssb, clickbench, benchmarking
meta_description: "Is Polars 2.x worth the upgrade? We ported 181 benchmark queries and measured speed and memory against 1.44: up to 2x faster, with two things to check first."
---

# Polars 2.x is up to 2x faster. Should you upgrade?

> You will get the most lift from Polars 2.x if you currently rely on defaults. 2.x now uses `streaming` by default instead of `in-memory`, and that change significantly improves performance in our tests.

**TL;DR**: With default settings, Polars 2.x took 36% to 53% less time than 1.44 on three benchmarks, and porting our 181 queries took three small fixes. Much of the gain comes from the new default engine, so it is smaller if you already use the streaming engine, and we measured none on the in-memory engine. Before you upgrade, check any code that relies on row order, and test large group-bys on 2.1 if you run close to your memory limit.

---

## Introduction

Polars 2.0 came out on 2026-10-06 and 2.1 on 2026-10-25[^1]. The Polars team calls it a release about defaults: "We don't aim to make a big feature release of Polars 2.0. In fact we hope it to be a boring experience for you."[^2]

The default that matters most is the engine. A lazy query is one you build with `scan_*` or `.lazy()` and run with `collect()`. In 1.x, `collect()` ran it on the in-memory engine. In 2.x it runs on the streaming engine, which processes data in batches.

BenchBox runs four benchmark suites as Polars queries, so we made the upgrade ourselves and measured it. Every figure here comes from lazy queries over Parquet files on one 16 GiB laptop.

## Upgrade or wait

- **Lazy queries on default settings:** the largest gain. Our runs took 36% to 53% less time. Check any code that relies on row order first.
- **Already passing `engine="streaming"`:** a smaller gain, 14% to 29%.
- **Eager code, or the in-memory engine:** we measured no change in speed.
- **Large group-bys close to your memory limit:** test on 2.1 before you move. One of our queries needed far more memory on 2.1 than on 2.0.

## Breaking changes in 2.0

The migration guide lists every change[^3]. Four groups affect most code.

**Lazy queries run on the streaming engine.** So does SQL run through `pl.sql(..., eager=True)`. Eager `DataFrame` operations still run in memory[^3].

**Row order is no longer guaranteed through `join`, `group_by` and `unpivot`.** The guide warns: "This change may silently impact the results of your pipelines."[^3] Where order matters, sort explicitly or pass `maintain_order`:

```python
left.join(right, on="k", how="left", maintain_order="left").collect()
```

**Silent conversions now raise.** `is_in` no longer casts both sides to a common type, and horizontal `concat` requires equal heights. Casting a string to a date is replaced by `.str.to_date()`[^2].

**Deprecated APIs are gone.** Examples are `melt`, `with_row_count`, `LazyFrame.fetch` and the reader argument `rechunk=`[^3]. The error names the replacement[^2].

Polars 2.0 also writes intermediate data to disk when memory runs short, and does so by default[^4].

To keep the old engine after upgrading[^3]:

```python
pl.Config.set_engine_affinity("in-memory")   # whole process
lf.collect(engine="in-memory")               # one query
```

## Porting 181 queries: three fixes

Our four suites hold 181 queries. Running them on 2.0 took [three fixes](https://github.com/BenchBox-dev/BenchBox/pull/2771), all in shared helper code:

1. **Reader `rechunk=`** was removed from `scan_csv` and `scan_parquet`.
2. **A CSV keyword was renamed** from `missing_utf8_is_empty_string=` to `empty_string_is_null=`, with its meaning inverted.
3. **String-to-date casts** became `str.to_date()`.

No query changed. Afterwards every suite passed our comparison against DuckDB results on both 2.x releases.

## Speed by starting point

Each figure is the total time in seconds for one suite's queries at scale factor 10 (about 10 GB of raw data for TPC-H). It is the median of three runs.

| Benchmark | 1.44 default | 1.44 streaming | 2.0 default | 2.1 default |
|---|---|---|---|---|
| TPC-H | 11.17 | 7.75 | 6.11 | 5.75 |
| SSB | 5.18 | 4.19 | 3.28 | 3.32 |
| ClickBench | 4.32 | 2.55 | 2.10 | 2.05 |

**Default settings.** Moving from 1.44 to 2.x roughly halved the time on TPC-H and ClickBench and cut SSB by over a third. That is 1.6x to 2.1x faster.

**Already on streaming.** Much of that gain was available in 1.44. Passing `engine="streaming"` there took 19% to 41% less time than its default. From 1.44 streaming to 2.x streaming, the further saving was 14% to 29%.

**Staying in memory.** With `engine="in-memory"`, 2.0 and 2.1 were within about 8% of 1.44 on every suite. Three runs cannot separate a difference that small from noise. We timed lazy queries with the engine set, not eager code.

2.0 and 2.1 were within 9% of each other on these three suites.

## Memory on a 16 GiB machine

Peak memory on default settings was lower on 2.x in all three suites above. On SSB it fell from 5.1 GiB on 1.44 to 2.2 GiB on 2.0. Single readings moved by up to 1.9 GiB between repeat runs, so read this as a direction.

TPC-DS is the heaviest suite, and it shows the difference best:

| TPC-DS at scale factor 10 | Result |
|---|---|
| 1.44 default | Did not finish: stopped once the machine was several GiB into swap |
| 1.44 streaming | 57.21 s |
| 2.0 default | 30.47 s, nothing written to disk |
| 2.1 default | 34.08 s, 0.47 GiB written to disk |

Swap is the operating system moving memory to disk when RAM runs out.

### One query explains the 2.1 result

2.1 took about 12% longer than 2.0 on TPC-DS, and the machine swapped during its runs. One query accounts for the difference:

| Default engine, median of three runs | 2.0 | 2.1 |
|---|---|---|
| Query 4 | 4.67 s | 10.28 s |
| The other 102 queries | 25.80 s | 23.80 s |

Query 4 totals each customer's yearly spending across three sales channels. It unions three large group-by results, then reads that union six times.

Run on its own, query 4 finished in 7 s on 2.0 with nothing written to disk. On 2.1 it used 7.6 GiB before a memory guard on our machine stopped it. That was with Polars' own memory budget set to 4 GB.

Polars 2.1 rewrote the streaming group-by[^5]. Two open Polars reports describe higher memory use on 2.1 for the two patterns in this query: unions[^6] and results read by several consumers[^7]. Both match the query's shape. We did not trace the query inside Polars. More work on group-by memory has merged since 2.1 and is not yet in a release[^8].

On the other 102 queries, 2.1 took 8% less time than 2.0.

## Row order: test your own code

Our benchmarks say little about the row-order change. A benchmark query either sorts its output or has no defined order, and our checks compare unsorted results as sets.

Nothing raises when order changes, so read your code for places that depend on it. Then run the pipeline on 2.x twice, once on the default engine and once with `engine="in-memory"`, and compare the outputs without sorting them.

## Test setup

- **Hardware**: Apple M4, 10 cores, 16 GiB RAM, macOS 27.0.1
- **Software**: Python 3.12.15; Polars 1.44.2, 2.0.0 and 2.1.0; BenchBox at commit `82e76af81`
- **Benchmarks**: TPC-H, TPC-DS, SSB and ClickBench at scale factor 10, read from Parquet
- **Method**: 10 threads; one warm-up pass and one timed pass per query; three runs in shuffled order
- **Checks**: results compared with DuckDB at a small scale; row counts compared at scale factor 10

We also ran three older 1.x releases. The [findings](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/findings.md) list every result with its range, the [methodology](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/methodology.md) gives the rules, and the [analysis JSON](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json) holds the numbers.

## Limits

- **One machine, one data size.** With more memory, 1.44 may finish TPC-DS on its default engine and query 4 may run without swap on 2.1.
- **Lazy analytical queries over Parquet.** We did not measure eager code, CSV input, cloud storage or writes.
- **Three runs each.** We treat a difference under 10% as noise.
- **Query 4 on its own was run once per release**, on a machine that was busy with other work.
- **The 5x expectation.** Polars expects the streaming engine to be "easily 5x faster" in aggregate[^2]. We saw 1.6x to 2.1x on these suites.

## Try it on your own workload

To see the effect of the engine alone, name it on the version you already run:

```python
lf.collect(engine="streaming")
```

Then install 2.x and compare the default against `engine="in-memory"`.

To repeat one of our measurements, install the Polars version you want and run:

```bash
$ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
    --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
    --ignore-memory-warnings --platform-option rechunk=false \
    --execution-engine streaming
```

Change `--execution-engine` to `default` or `in-memory`, and `--benchmark` to `tpcds`, `ssb` or `clickbench`.

## Conclusions

For lazy queries, the upgrade paid off in our tests. Default settings gave 36% to 53% less time, lower peak memory, and a TPC-DS run that fits in 16 GiB. The port took three mechanical fixes.

The gain depends on where you start. It is smaller if you already use the streaming engine, and we measured none on the in-memory engine. The row-order change needs a read of your code, because nothing raises.

2.0 and 2.1 were close on everything except one large group-by query, which needed far more memory on 2.1. If your workload has that shape and runs near your memory limit, test it on 2.1 first.

---

## References

[^1]: [polars release history](https://pypi.org/project/polars/#history) - PyPI, accessed November 2026
[^2]: [Pre-release of Polars 2.0](https://pola.rs/posts/announcing-polars-2/) - Polars, published September 2, 2026, accessed November 2026
[^3]: [Version 2.0 upgrade guide](https://docs.pola.rs/releases/upgrade/2/) - Polars documentation, accessed November 2026
[^4]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741), accessed November 2026
[^5]: [Streaming OOC group-by with shuffles](https://github.com/pola-rs/polars/pull/29911) - Polars pull request #29911, merged October 21, 2026, accessed November 2026
[^6]: [Semi-join before a union of per-partition scan_iceberg reads uses ~4x the memory of 2.0.0](https://github.com/pola-rs/polars/issues/30608) - Polars issue #30608, open, accessed November 21, 2026
[^7]: [Streaming multiplexer spills a separate copy of each buffered morsel per output port](https://github.com/pola-rs/polars/issues/30981) - Polars issue #30981, open, accessed November 21, 2026
[^8]: [Count pre-aggregates in memory when choosing the number of streaming group-by partitions](https://github.com/pola-rs/polars/pull/30405) - Polars pull request #30405, merged October 29, 2026, accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
