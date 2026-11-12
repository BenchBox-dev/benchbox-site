# Outline: Name the Engine Before You Compare Polars 2.0 With 1.x

**Post type:** BenchBox in Action (a methodology question answered with real
runs, neutral on the platform).
**Target length:** 2,000-2,500 words.
**Editorial angle:** The lead is the method, and the version matrix is the
illustration. A "2.0 vs 1.x" number mixes two changes: which engine a bare
`collect()` uses, and how fast each engine is. Holding the engine fixed
separates them. On our host the engine switch alone, measured on 1.44.2,
accounts for about half to most of the default-settings gain, depending on the
benchmark; the streaming engine also got faster; the in-memory engine barely
moved. The second lesson is about measurement: on a 16 GiB machine our memory
rules decided which cells finished, some of those rules measured the host more
than the Polars version, and our spill measurement watched the wrong
directory.

**Why the lead changed (2026-11-12):** the first outline led with the 2.0.0
release. Polars 2.1.0 shipped on 2026-10-25, so a release-news hook is stale.
The method lesson does not depend on which version is current.

**Evidence sources:**
- `research/polars-2-version-matrix-reverification-2026-11-12.md` (R9-R15:
  out-of-core default, spill location, engine-switch shares, row order,
  currency). Where it disagrees with the older note, it wins.
- `research/polars-2-version-matrix-verification-2026-10-17.md` (R1-R8, how
  the abort rules worked).
- `research/polars-2-version-matrix-figures-2026-10-09.md` (field mapping for
  every timing in `polars-version-matrix-analysis.json`).
- `_project/analysis/polars-version-matrix/findings.md`, `methodology.md` and
  the comparisons CSV in the core repository.

Every timing comes from the analysis JSON or is computed from its cell medians
and marked as computed. Every Polars behavior claim cites R4 (release-candidate
post), R9 (2.0.0 release notes) or R10 (source at the 2.0.0 tag), or is stated
as what our runs showed.

**Voice reminders:** "we"; neutral on platforms; median with min-max range
beside every figure; "candidate mover", never "significant"; no em-dashes or
en-dashes (ASCII hyphen for ranges); define scale factor, collect engine and
candidate mover on first use; footnote external facts with access dates.

## Title and frontmatter

- Title (under 60 chars): "Polars 2.0 vs 1.x: Name the Engine Before You Compare"
  (53 chars).
- meta_description (150-160 chars): five Polars releases, four benchmarks,
  three engine settings; how much of a 2.0 upgrade gain is the new streaming
  default, and what our memory rules measured.
- `series: platform-deep-dives`. `post_number` and `date` are not set.
- tags: polars, dataframe, tpc-h, tpc-ds, ssb, clickbench, benchmarking,
  methodology.
- TL;DR (3 sentences):
  1. With each version's defaults, 2.0.0 finished TPC-H, SSB and ClickBench
     38% to 50% faster than 1.44.2 at SF10 on a 16 GiB Apple M4.
  2. Switching 1.44.2 to the streaming engine already gave 51% to 86% of that
     gain (computed, R-note 2026-11-12); forced onto the in-memory engine,
     2.0.0 was within 6% faster to 12% slower than 1.44.2.
  3. On TPC-DS, which cells finished was decided by our host memory rules, and
     we could not tell whether 2.0.0 spilled to disk because we watched the
     wrong directory.
- Scope bound, stated once in the introduction and once beside the test
  environment: measured on 2026-10-09 with 2.0.0; 2.1.0 (2026-10-25) is not
  measured. Remove this bound only if 2.1.0 cells are added (see "Before
  drafting").

## 1. Introduction (200-300 words)

- Hook: an upgrade benchmark answers the question you asked, which may not be
  the one you meant. Polars 2.0 changed what a bare `collect()` does: it now
  runs on the streaming engine (R4, quote and footnote). Define "collect
  engine" in one sentence: the executor that runs a lazy query plan when you
  call `collect()`.
- The problem with one headline number: it mixes the default change with any
  change in how fast each engine runs.
- What we did: five versions, four benchmarks, three engine settings, three
  rounds each. Scope: Polars DataFrame API (`polars-df`) only, one host,
  measured 2026-10-09.
- Mention the Polars team's own expectation ("easily 5x faster" in aggregate,
  R4) only if attributed as their expectation; our results do not test it.

## 2. What we ran (250-350 words)

- Test environment table (style guide template): Apple M4, 10 cores, 16 GiB,
  macOS 27.0.1, Python 3.12.13 (R13), mains power, `caffeinate -dims`; Polars
  1.31.0, 1.35.2, 1.40.1, 1.44.2, 2.0.0; TPC-H, TPC-DS, SSB, ClickBench at
  SF10; `POLARS_MAX_THREADS=10`; `rechunk=false`; tuning `notuning`; one
  warm-up and one measured pass per query; 3 rounds, cell order shuffled each
  round (seed 20261009); BenchBox commit `ecd08a9f0` for every run.
- The three setups, with the current flag (R15):
  - A: `--execution-engine default` (no engine argument; 1.x runs in memory,
    2.0.0 runs streaming per R4).
  - B: `--execution-engine in-memory`, 2.0.0 only, compared with 1.44.2 A.
  - C: `--execution-engine streaming`, on 1.31.0, 1.40.1, 1.44.2, 2.0.0.
  - One sentence: the 2026-10-09 runs recorded an earlier Polars-only option
    name with the same three values; BenchBox has since moved the setting to
    a core option that other platforms share.
- Define scale factor and cell total (sum of measured per-query wall times,
  Parquet reads included).
- Define candidate mover: median change of at least 10% with non-overlapping
  min-max ranges. 42 comparisons, 20 candidates; three rounds cannot support
  a significance test.
- Version selection, accurately:
  - 1.35.2 is not in setup C. At SF 0.01 its streaming TPC-DS results had
    NULLs where DuckDB's SQL results had values (queries 5, 14, 27, 67),
    twice. We did not determine whether Polars or BenchBox's DataFrame query
    code causes this. Do not write "the streaming engine diverged".
  - 1.0.0, 1.12.0 and 1.22.0 were dropped after the probe (panic; TPC-DS Q51
    mismatch; Q51 and Q87 failures).

## 3. Default settings: 2.0.0 against 1.44.2 (200-250 words)

- Table: TPC-H 6.89 (6.06-9.51) vs 11.95 (11.19-11.95), -42.3%; SSB 3.23
  (3.21-3.44) vs 5.24 (4.98-5.43), -38.3%; ClickBench 2.23 (2.09-2.82) vs
  4.45 (4.41-4.49), -49.8%; TPC-DS 2.0.0 31.01 (30.88-36.94), 1.44.2 not
  reported (section 7).
- Note the wide 2.0.0 TPC-H range and that the median sits near the low end.
- Cross-check worth one sentence: 2.0.0's setup A and setup C medians are
  within 12% of each other on all four benchmarks, which fits R4's statement
  that the default is now streaming.

## 4. How much of that is the switch (300-350 words)

This section carries the thesis. It is new in this outline.

- The direct measure of the switch is one version on both engines: 1.44.2
  default (in memory) against 1.44.2 streaming. Table, with ranges from
  `findings.md`:
  - TPC-H 11.95 (11.19-11.95) to 8.08 (7.59-8.21), -32.4%, 76% of the gain.
  - SSB 5.24 (4.98-5.43) to 4.22 (4.08-4.29), -19.5%, 51% of the gain.
  - ClickBench 4.45 (4.41-4.49) to 2.55 (2.40-2.83), -42.7%, 86% of the gain.
- State that these three figures are computed from the cell medians and are
  not among the analyzer's 42 comparisons. All three meet the candidate-mover
  rule. Shares come from rounded medians.
- Reader takeaway, as a finding and not as advice to switch: a 1.44.2 user who
  named the streaming engine already had about half (SSB) to most (TPC-H,
  ClickBench) of what the 2.0.0 default delivers on these benchmarks.
- Then the control: 2.0.0 in memory against 1.44.2 default. TPC-H 11.53
  (10.42-11.55), -3.5%, no; SSB 5.88 (5.75-6.49), +12.2%, candidate (slower);
  ClickBench 4.19 (4.06-4.36), -5.9%, no. With the engine held at in-memory,
  the gain is gone.
- Method, as one imperative: set the engine explicitly in a before-and-after
  upgrade test (Polars: `collect(engine=...)` or
  `pl.Config.set_engine_affinity`, R4; BenchBox: `--execution-engine`).

## 5. Streaming against streaming, and the 1.x trend (300-350 words)

- Table: TPC-H 6.16 (6.10-6.39) vs 8.08 (7.59-8.21), -23.8%; TPC-DS 31.28
  (30.37-42.83) vs 61.30 (59.75-68.11), -49.0%; SSB 3.37 (3.21-3.40) vs 4.22
  (4.08-4.29), -20.1%; ClickBench 2.20 (2.09-2.21) vs 2.55 (2.40-2.83),
  -13.8%. All four candidates.
- Flag TPC-DS: largest change, wide 2.0.0 range, and 2.0.0 has out-of-core
  execution on by default (R9), so the two cells may not be doing the same
  work in memory. A lead for a larger run, not a headline.
- 1.x trend table (setup A SSB and ClickBench; setup C TPC-H, SSB,
  ClickBench). Streaming's largest 1.x step: TPC-H 1.31.0 to 1.40.1 (11.37 to
  7.86, -30.9% against oldest). 1.40.1 and 1.44.2 within 3.3% on every setup C
  benchmark.
- Omit TPC-H setup A from the trend table, with the reason (section 6).

## 6. What decided TPC-DS: our memory rules on a 16 GiB host (400-500 words)

Describe the rules as they worked, not as they were specified. Keep two verbs
apart throughout: a run is "stopped" only by the safety monitor; a cell is
"ruled out" after the run by the swap limit.

- 6a. The outcome table (10 TPC-DS cells):
  - Stopped by the safety monitor in every round: the four 1.x defaults (largest
    swap growth per cell 8.86-10.40 GiB).
  - Ruled out after the run by the swap limit: 2.0.0 B (1.33, 5.70 and
    3.69 GiB) and 1.40.1 C (1.02, 2.32 and 1.69 GiB). All six runs finished
    with exit code 0 and were not stopped (manifest `host_safety_abort` is
    false for each).
  - Crashed: 1.31.0 C (exit 138 or 139, 17-23 s, not investigated, probe had
    marked it clean).
  - Completed: 2.0.0 A, 2.0.0 C, 1.44.2 C.
- 6b. How each rule actually behaved:
  - Process memory limit (14 GiB): applied after the run, and never exceeded.
    macOS RSS leaves out swapped and compressed pages; the largest reading was
    8.4 GiB in a run where the host swapped out 10.4 GiB.
  - Swap limit (1 GiB): applied after the run, read from the host-wide
    `vm_stat` swap-out counter, so it measures the whole machine. This was the
    rule that mattered.
  - Safety monitor (6 GiB swap or sustained critical pressure): the only rule
    that stops a run. Checked about every 5 seconds, so runs reached 10.4 GiB
    before being stopped.
- 6c. Consequence beyond TPC-DS: TPC-H default on 1.31.0 (0.60, 0.56, then
  1.36 GiB) and 1.40.1 (1.77, 1.42, then 0.67 GiB) were ruled out by that
  host-wide counter, so there is no default-engine TPC-H comparison against
  the oldest version.
- 6d. The spill measurement watched the wrong directory:
  - 2.0.0 turns out-of-core execution on by default, with a memory budget of
    80% of available RAM and a 64 GB disk budget (R9).
  - Our runner set `POLARS_TEMP_DIR` per cell and measured that directory. It
    read 0.0 GiB in all 120 runs.
  - 2.0.0 does not spill there. Its default spill directory is under the
    process temp directory (R10). In a check on 2026-11-12, a streaming sort
    on 2.0.0 wrote 1.12 GB under `TMPDIR` and nothing under
    `POLARS_TEMP_DIR` (R11).
  - So we do not know whether the 2.0.0 TPC-DS runs spilled. Do not write "no
    run spilled" or "we saw no files in the configured temp directory".
  - If the rerun in "Before drafting" item 2 is done, replace the last bullet
    with what it showed.
- 6e. What we can say:
  - 2.0.0's default engine finished TPC-DS at SF10 on this host in all three
    rounds; every 1.x default did not; 2.0.0 forced in memory did not.
  - These outcomes describe this host and these rules, not a version's memory
    ceiling.
- 6f. What the numbers need (state as needs, not as a roadmap, unless tracker
  items exist): memory measured per process tree including swap, safety limits
  checked on every sample, swap attributed to the benchmark process, and the
  engine's real spill directory watched.

## 7. What these numbers do not show (250-300 words)

- Currency: 2.1.0 is not measured. It changes out-of-core behavior
  (out-of-core group-by and window, R12), which bears most on TPC-DS.
- Correctness: value-level checks at SF 0.1 per version and setup; at SF10,
  row counts only against DuckDB SQL. TPC-DS Q41 returns 10 rows on Polars
  and 12 on DuckDB on every version (in full-suite totals; common-query totals
  differ by 0.02 s or less).
- Row order: streaming does not guarantee row order for joins and group-bys
  (R4). The value checks compare order keys in sequence where the SQL has an
  `ORDER BY`, compare tied rows as a set, and sort both sides where it has
  none (R14). State this only after confirming the 2026-10-09 qualification
  ran that code.
- Engine fallback: we recorded the requested engine, not whether operators
  fell back to in-memory execution.
- No comparison with DuckDB: Polars timings include Parquet reads; the DuckDB
  matrix reads a pre-loaded database.
- Host load: load average before runs 3.9-39.8 (median 12.8) from the
  previous run's threads; memory pressure normal before every run; quiet-host
  gate applied once at the start.
- Late-run slowdown: seven runs more than 25% above their cell median, all
  among the last eight of round 3; round 3 averaged 10.6% above cell medians;
  cause unknown. Fastest-round comparison gives TPC-H -45.9%, SSB -35.6%,
  ClickBench -52.6%, same direction.
- Cell totals only: no per-query movers. The 2026-10-09 runs captured no query
  plans.

## 8. Reproduce it (150-200 words)

- One cell with the current option (R15). Readers can run this as written:

  ```bash
  $ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
      --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
      --platform-option rechunk=false --execution-engine streaming
  ```

- The matrix runner, as a dry run that prints the plan and needs no
  qualification file:

  ```bash
  $ uv run --no-sync -- python scripts/run_polars_version_matrix.py \
      --output-dir ~/benchmark_runs/polars-matrix \
      --shuffle-seed 20261009 \
      --dry-run
  ```

  Verify both commands against `develop` before publishing. The runner has
  been refactored since `ecd08a9f0`; on 2026-11-12 it required
  `--qualification` only for a real run. Say that a full run needs the
  qualification file produced by the probe, and link the methodology page
  for it.
- Link the findings, CSV and methodology by GitHub URL in
  `BenchBox-dev/BenchBox`. Say that raw bundles, the run manifest and the
  analysis JSON are not published.
- Note: on a 16 GiB machine, expect TPC-DS cells to hit the memory rules.

## 9. Conclusions (150-200 words)

- Method takeaway first: name the engine in any upgrade comparison; check that
  your memory limits measure the process you think they measure; check that
  your spill measurement watches the directory the engine writes to.
- 2.0.0 was faster than 1.44.2 in every comparison where both finished, on
  the default and on the streaming engine.
- The size depends on what you hold fixed: against 1.x defaults, about half to
  most of the gain was already available by switching engine on 1.44.2;
  between in-memory engines, the versions are close; between streaming
  engines, 2.0.0 leads by 14% to 49%.
- Invite runs on other hardware and on 2.1.0, and reports of the 1.31.0
  streaming TPC-DS crash.

## References

- R4 "Pre-release of Polars 2.0" (2026-09-02, accessed 2026-11-12). Cite it
  as the release-candidate post.
- R5 PyPI release record for 2.0.0 (accessed 2026-10-17).
- R9 Polars 2.0.0 release notes (accessed 2026-11-12).
- R10 Polars source at tag `py-2.0.0`, `crates/polars-config/src/spill_path.rs`
  (accessed 2026-11-12).
- R12 Polars 2.1.0 release notes (accessed 2026-11-12).
- BenchBox findings, methodology and CSV in the core repository, by GitHub
  URL.
- Research notes (all three files above).

## Charts (decide at draft time)

- Candidate: grouped bars per benchmark for 1.44.2 A, 1.44.2 C, 2.0.0 A and
  2.0.0 B, with min-max whiskers. This is the section 4 argument in one
  figure. Values from the analysis JSON only; cite the field.

## Before drafting

1. Correct `methodology.md` and `findings.md` in the core repository: describe
   the 14 GiB, 1 GiB and 6 GiB rules as measured (section 6b), resolve the
   "committed bundles" against "not committed" contradiction, and replace both
   "no run spilled" statements with what section 6d says. The post should not
   cite pages that disagree with it.
2. Rerun the 2.0.0 TPC-DS cells (setups A and C) at SF10 while sampling
   `{TMPDIR}/polars-{USER}/spill`, or with `POLARS_OOC_LOG_METRICS=1`. This is
   a functional check and does not need a quiet host. It turns section 6d from
   "we do not know" into a finding.
3. Decide on 2.1.0. Either add 2.1.0 cells for setups A and C, or keep the
   scope bound in the TL;DR and section 7. New cells are comparable only if
   they run at BenchBox commit `ecd08a9f0` or the 1.44.2 and 2.0.0 reference
   cells are rerun beside them, and timings need a quiet host.
4. Confirm the 2026-10-09 qualification ran the order-aware comparison code
   (section 7, R14).
5. Optional, strengthens section 6: TPC-DS at SF 3, or on a host with more
   RAM, to get a like-for-like default-engine TPC-DS comparison.
