# Polars 2.0 version matrix: re-verification notes (2026-11-12)

Companion to `outlines/polars-2-version-matrix.md`. It records what changed
between the 2026-10-17 verification and 2026-11-12, and corrects two points in
`polars-2-version-matrix-verification-2026-10-17.md`: the spill measurement
and the source used for out-of-core behavior.

## Sources

| ID | Source | What it supports |
|---|---|---|
| R9 | Polars 2.0.0 release notes, <https://github.com/pola-rs/polars/releases/tag/py-2.0.0> (accessed 2026-11-12) | "Enable OOC by default with 80% of available RAM as threshold" (#29741, merged 2026-10-05), "Set default OOC disk budget to 64 GB" (#29734), "Add streaming (out-of-core) sort" (#29657). Out-of-core execution is on by default in 2.0.0. |
| R10 | Polars source at tag `py-2.0.0`, `crates/polars-config/src/spill_path.rs` and `crates/polars-config/src/lib.rs` (accessed 2026-11-12) | The default spill directory is `{temp_dir}/polars-{USER}/spill` on macOS, where `temp_dir` is the process temp directory. The out-of-core settings are `POLARS_OOC_*` environment variables, including `POLARS_OOC_MEMORY_BUDGET_FRACTION` (default 0.8), `POLARS_OOC_MEMORY_BUDGET_MB`, `POLARS_OOC_DISK_BUDGET_MB` and `POLARS_OOC_LOG_METRICS`. |
| R11 | Spill-location check, run 2026-11-12 on the matrix host with Polars 2.0.0 | See "Spill-location check" below. |
| R12 | Polars 2.1.0 release notes, <https://github.com/pola-rs/polars/releases/tag/py-2.1.0>, and PyPI (accessed 2026-11-12) | 2.1.0 was uploaded 2026-10-25. It adds an out-of-core streaming group-by (#29911) and an out-of-core streaming window node (#30282), and changes how the engine waits for spills under its memory budget (#30294, #30296). It is the current release and is not in the matrix. |
| R13 | Run manifest `matrix-manifest.json`, `host` block | macOS 27.0.1 on arm64, Python 3.12.13, 10 cores, 16.0 GiB. |
| R14 | BenchBox `benchbox/core/equivalence/cross_surface.py` and `benchbox/core/tpchavoc/validation.py` on `develop` (read 2026-11-12) | How the cross-surface value checks treat row order. See "Row order" below. |
| R15 | BenchBox Polars platform page, `docs/platforms/polars.md` in this repository | Replaces R7, whose path in the core repository no longer exists. The current option is the core `--execution-engine {default,in-memory,streaming}`. |

R4 (the 2026-09-02 post) is the release-candidate post, titled "Pre-release of
Polars 2.0". It lists "proper out-of-core support" as upcoming work. The
default in R9 was merged on 2026-10-05, the day before 2.0.0 shipped, so R4
does not describe the out-of-core behavior of the version we measured. Cite R9
for that.

R6 (Runtime Wire) is no longer needed. R9 is a primary source for the same
facts.

## Spill-location check (R11)

Question: does Polars 2.0.0 write spill files to `POLARS_TEMP_DIR`, the
directory the matrix runner sampled?

Method: one process with `POLARS_TEMP_DIR` and `TMPDIR` set to two different
empty directories, `POLARS_OOC_MEMORY_BUDGET_MB=200` and
`POLARS_MAX_THREADS=4`. It sorted a 12,000,000-row LazyFrame (two integer
columns and one string column) on two keys with `collect(engine="streaming")`.
A thread sampled the size of both directories every 20 ms.

Result:

| Directory | Peak size |
|---|---|
| `POLARS_TEMP_DIR` | 0 bytes |
| `TMPDIR` | 1,120,994,120 bytes, all under `polars-{USER}/spill` |

Polars 2.0.0 does not write out-of-core spill files to `POLARS_TEMP_DIR`. This
matches R10.

## What this changes

- The matrix runner at `ecd08a9f0` set `POLARS_TEMP_DIR` to a per-cell
  directory and sampled only that directory (line 413 and the `monitor`
  function). It did not set `TMPDIR`. The reading of 0.0 GiB in all 120 runs
  therefore says nothing about whether a 2.0.0 run spilled.
- The 2026-10-17 note called "we saw no files in the configured temp
  directory" a supportable claim. It is true and misleading: the directory was
  the wrong one. Do not use it in the post.
- `findings.md` in the core repository said that 2.0.0 completing TPC-DS "is
  not out-of-core spilling". The matrix cannot support that either way.
- What the post can say: 2.0.0 enables out-of-core execution by default (R9),
  our runner did not watch the directory it spills to (R10, R11), and so we do
  not know whether the 2.0.0 TPC-DS runs spilled.
- What would settle it: rerun the 2.0.0 TPC-DS cells (setups A and C) while
  sampling `{TMPDIR}/polars-{USER}/spill`, or with `POLARS_OOC_LOG_METRICS=1`.
  This is a functional check and does not need a quiet host.

## How much of the default-settings gain is the engine switch

The 2026-10-17 outline said "most" of the default-settings gain comes from the
new default, and supported it with setup B (2.0.0 forced in memory). Setup B
shows the in-memory engine barely moved. It does not measure the switch. The
direct measure is 1.44.2 default (setup A, in memory) against 1.44.2 streaming
(setup C), and both cells are reported for three benchmarks.

Computed from the two-decimal cell medians in `findings.md` (seconds):

| Benchmark | 1.44.2 A | 1.44.2 C | 2.0.0 A | Switch on 1.44.2 | Total gain | Share from the switch |
|---|---|---|---|---|---|---|
| TPC-H | 11.95 | 8.08 | 6.89 | -32.4% | 5.06 | 76% |
| SSB | 5.24 | 4.22 | 3.23 | -19.5% | 2.01 | 51% |
| ClickBench | 4.45 | 2.55 | 2.23 | -42.7% | 2.22 | 86% |

Notes:

- These cross-setup pairs are not among the analyzer's 42 comparisons. The
  min-max ranges of each pair do not overlap (TPC-H 11.19-11.95 against
  7.59-8.21; SSB 4.98-5.43 against 4.08-4.29; ClickBench 4.41-4.49 against
  2.40-2.83), and each change is above 10%, so all three meet the
  candidate-mover rule.
- Shares are computed from rounded medians and can be off by a point.
- "Most" holds for TPC-H and ClickBench. On SSB the switch is about half.
- The remainder is not exactly the setup C improvement, because 2.0.0 setup A
  and setup C medians differ (TPC-H 6.89 against 6.16).

## Row order (R14)

The cross-surface value checks are not blanket order-insensitive. Where the
reference SQL has an `ORDER BY`, the check compares the order keys in sequence
and compares rows that tie on the keys as a multiset. Where it has none, both
results are sorted before comparison. This is the code on `develop` as read on
2026-11-12. Whether the SF 0.1 qualification on 2026-10-09 ran the same code
is still open.

## How the abort rules worked, re-read

Re-read at `ecd08a9f0` on 2026-11-12; the 2026-10-17 description holds.

- The 14 GiB and 1 GiB limits are applied after the run, in `classify_outcome`.
  They do not stop a run.
- The safety monitor is the only rule that stops a run. It checks memory
  pressure and host swap growth on every fifth 1-second sample, so "three
  critical samples" takes about 15 seconds.
- Manifest check of the TPC-DS cells that did not qualify: all twelve setup A
  runs on 1.x have `host_safety_abort` true and exit code -9 (swap growth
  6.24 to 10.40 GiB). The 2.0.0 B runs (1.33, 5.70, 3.69 GiB) and the 1.40.1 C
  runs (1.02, 2.32, 1.69 GiB) have `host_safety_abort` false and exit code 0:
  they finished and were ruled out afterwards by the 1 GiB limit.

## Currency

- The matrix ran on 2026-10-09 and measured 2.0.0. 2.1.0 shipped on
  2026-10-25 (R12) with out-of-core changes that bear on the TPC-DS section.
- Adding 2.1.0 cells is not a small rerun. Every matrix run used BenchBox
  commit `ecd08a9f0`, and the DataFrame query code has changed since, so new
  cells are comparable only if they run at that commit or the reference cells
  are rerun beside them. Timings also need a quiet host.

## Reproducibility gaps

- `qualification.json` and `polars-version-matrix-analysis.json` are not in
  the core repository. Readers can reach `findings.md`, `methodology.md` and
  `polars-version-matrix-comparisons.csv` under
  `_project/analysis/polars-version-matrix/`.
- The reproduce command in the 2026-10-17 outline passed
  `--qualification qualification.json`, which a reader does not have.

## Still open

- Whether the 2.0.0 TPC-DS runs spilled (see "What would settle it").
- Whether to add 2.1.0 cells or publish with 2.1.0 named as not measured.
- Whether the SF 0.1 qualification ran the order-aware comparison code.
- The 1.31.0 streaming TPC-DS crash is still not investigated.
