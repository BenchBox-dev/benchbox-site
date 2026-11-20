# Polars 2.x upgrade post: evidence for the upgrade reader (2026-11-20)

Companion to `outlines/polars-2-version-matrix.md`. It records the sources
the post needs once it is written for someone deciding whether to upgrade,
beyond the timings in `polars-2-version-matrix-run-2026-11-19.md`.

## Sources

| ID | Source | What it supports |
|---|---|---|
| R20 | Polars "Version 2.0" upgrade guide, <https://docs.pola.rs/releases/upgrade/2/> (accessed 2026-11-20) | See "What changed" below. 51 third-level sections. |
| R21 | BenchBox core commit `1f56404ef9` (PR #2771, merged 2026-10-08), "run the Polars DataFrame benchmarks on Polars 2.0 as well as 1.x" | See "What the port cost". |
| R22 | Core `_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json` at commit `9d78af081b`, fields `peak_rss_gib` and `swap_out_growth_gib` per cell | See "Peak memory". |
| R23 | Core `_project/analysis/polars-version-matrix/qualification.json`, `reference.row_counts` | 181 reference queries: TPC-H 22, TPC-DS 103, SSB 13, ClickBench 43. |

R4 (the 2026-09-02 post, "Pre-release of Polars 2.0") was re-read on
2026-11-20. Verbatim: "We don't aim to make a big feature release of Polars
2.0. In fact we hope it to be a boring experience for you."; "Casual Polars
users can therefore expect huge improvements in memory usage and
performance. In aggregate we expect the streaming engine to be easily 5x
faster."

## What changed (R20, R4)

- `LazyFrame.collect` still defaults to `engine="auto"`; `"auto"` now
  resolves to streaming for lazy queries. Eager `DataFrame` operations still
  resolve to in-memory. `pl.sql(..., eager=True)` and
  `SQLContext.execute(eager=True)` now go through `LazyFrame.collect()`.
- Verbatim warning: "This change may silently impact the results of your
  pipelines." The streaming engine does not guarantee row order for
  operations that do not require it (`unpivot`, `group_by`, joins). Remedy:
  sort explicitly or pass `maintain_order`.
- Restore the old default: `pl.Config.set_engine_affinity("in-memory")`,
  `collect(engine="in-memory")`, or `POLARS_ENGINE_AFFINITY=in-memory`.
- Stricter: horizontal `concat` requires equal heights; `is_in` coercion is
  strict; string-to-temporal casts are removed in favor of `str.to_date()`
  and `str.to_datetime()`.
- Removed (table "Removal of deprecated functionality"): `melt`,
  `with_row_count`, `LazyFrame.fetch`, `group_by(...).count()`,
  `read/scan_*(rechunk=...)`, `missing_utf8_is_empty_string=` (replaced by
  `empty_string_is_null=`, boolean inverted), `LazyFrame.profile()`. Most
  raise `AttributeRemovedError` or `ArgumentRemovedError` with a hint.

## What the port cost (R21)

Three removals broke BenchBox on 2.0:

- reader `rechunk=` on `scan_csv` and `scan_parquet`, which made every table
  load fail;
- `scan_csv(missing_utf8_is_empty_string=)`;
- string-to-date casts, used by a date helper.

The fixes are in shared platform code (`polars_df.py`, `unified_frame.py`,
`polars_compat.py`, `polars_platform.py`); no query file changed. The CSV
keyword is chosen from the installed signature because BenchBox supports
`polars>=1.35.2,<3.0.0`. The same change added a CI job that installs
`polars==2.0.0` over the locked environment and runs the four suites at
SF 0.01 with their cross-surface value gates.

Do not write "all 181 queries returned identical values": the ClickBench
gate accepts a classified difference on query 18 (LIMIT with no ORDER BY).
Write that all four suites passed the value comparison.

## Peak memory (R22)

Peak resident set size in GiB, summed over the process tree, largest of
three rounds. Host swap growth in every cell below is at most 0.22 GiB, so
the readings are not distorted by swapped pages.

| Benchmark | 1.44.2 default | 1.44.2 streaming | 2.0.0 default | 2.1.0 default | 2.0.0 in-memory | 2.1.0 in-memory |
|---|---|---|---|---|---|---|
| TPC-H | 6.727 | 5.004 | 5.445 | 3.200 | 5.229 | 6.006 |
| SSB | 5.355 | 2.278 | 2.325 | 2.170 | 5.705 | 6.079 |
| ClickBench | 2.864 | 2.842 | 2.355 | 1.944 | 3.120 | 3.035 |

TPC-DS peaks are not comparable: the cells that did not qualify swapped
3 to 8 GiB, and resident memory leaves swapped pages out.

## Correction to an earlier note

`polars-2-version-matrix-run-2026-11-19.md` said the regenerated reference
matched the previous one "on all 207 queries". The reference has 181 queries
(R23), and all 181 row counts match the previous reference. The note is
corrected. The core methodology page carried the same figure.
