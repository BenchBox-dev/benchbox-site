# Outline: Name the Engine Before You Compare Polars 2.x With 1.x

**Post type:** BenchBox in Action (a methodology question answered with real
runs, neutral on the platform).
**Target length:** 2,000-2,500 words.
**Editorial angle:** The lead is the method, and the version matrix is the
illustration. A "2.x vs 1.x" number mixes two changes: which engine a bare
`collect()` uses, and how fast each engine is. Holding the engine fixed
separates them. On our host the engine switch alone, measured on 1.44.2,
accounts for about two-thirds to most of the default-settings gain; both
streaming and, in 2.1.0, in-memory execution also got faster. The second
lesson is about measurement: on a 16 GiB machine our memory rules decided
which TPC-DS cells counted, one of those rules measured the whole host, and
our first spill measurement watched the wrong directory.

**Measured:** the full matrix was rerun on 2026-11-19 with 2.1.0 added. Every
timing comes from that run. The 2026-10-09 run appears only as a
reproducibility check.

**Evidence sources:**
- `research/polars-2-version-matrix-run-2026-11-19.md` (R16-R19: the run,
  its figures, TPC-DS outcomes, what went differently). Wins over the older
  notes.
- `research/polars-2-version-matrix-reverification-2026-11-12.md` (R9-R15:
  out-of-core default, spill location, row order).
- `research/polars-2-version-matrix-verification-2026-10-17.md` (R1-R8,
  how the resource rules work).
- Core `_project/analysis/polars-version-matrix/findings.md`,
  `methodology.md`, the comparisons CSV and `qualification.json`.

Every timing comes from R16. Figures marked "computed" are derived from cell
medians with the candidate-mover rule and must say so in the post. Every
Polars behavior claim cites R4 (release-candidate post), R9 (2.0.0 release
notes), R10 (source at the 2.0.0 tag) or R12 (2.1.0 release notes), or is
stated as what our runs showed.

**Voice reminders:** "we"; neutral on platforms; median with min-max range
beside every figure; "candidate mover", never "significant"; no em-dashes or
en-dashes (ASCII hyphen for ranges); define scale factor, collect engine and
candidate mover on first use; footnote external facts with access dates.

## Title and frontmatter

- Title (under 60 chars): "Polars 2.x vs 1.x: Name the Engine Before You Compare"
  (53 chars).
- meta_description (150-160 chars): six Polars releases, four benchmarks,
  three engine settings; how much of a 2.x upgrade gain is the new streaming
  default, and what our memory rules measured.
- `series: platform-deep-dives`. `post_number` and `date` are not set.
- tags: polars, dataframe, tpc-h, tpc-ds, ssb, clickbench, benchmarking,
  methodology.
- TL;DR (3 sentences):
  1. With each version's defaults, 2.0.0 and 2.1.0 finished TPC-H, SSB and
     ClickBench 36% to 53% faster than 1.44.2 at SF10 on a 16 GiB Apple M4.
  2. Switching 1.44.2 to the streaming engine already gave 62% to 86% of that
     gain (computed); held on the same engine, 2.1.0 and 2.0.0 were within 9%
     of each other except in memory, where 2.1.0 was up to 18% faster.
  3. On TPC-DS our host's memory rules decided which runs counted, and one of
     them read swap for the whole machine, which is why 2.1.0's TPC-DS results
     are not in our tables.

## 1. Introduction (200-300 words)

- Hook: an upgrade benchmark answers the question you asked, which may not be
  the one you meant. Polars 2.0 changed what a bare `collect()` does: it now
  runs on the streaming engine (R4, quote and footnote). Define "collect
  engine" in one sentence: the executor that runs a lazy query plan when you
  call `collect()`.
- The problem with one headline number: it mixes the default change with any
  change in how fast each engine runs.
- What we did: six versions (1.31.0 to 2.1.0), four benchmarks, three engine
  settings, three rounds each, 156 runs. Scope: Polars DataFrame API
  (`polars-df`) only, one host.
- Mention the Polars team's own expectation ("easily 5x faster" in aggregate,
  R4) only if attributed as their expectation; our results do not test it.

## 2. What we ran (250-350 words)

- Test environment table (style guide template): Apple M4, 10 cores, 16 GiB,
  macOS 27.0.1, Python 3.12.15; Polars 1.31.0, 1.35.2, 1.40.1, 1.44.2, 2.0.0,
  2.1.0; TPC-H, TPC-DS, SSB, ClickBench at SF10; `POLARS_MAX_THREADS=10`;
  `rechunk=false`; tuning `notuning`; one warm-up and one measured pass per
  query; 3 rounds, cell order shuffled each round (seed 20261119); BenchBox
  commit `82e76af81` for every run.
- The three setups:
  - A: `--execution-engine default` (no engine argument; 1.x runs in memory,
    2.x runs streaming per R4).
  - B: `--execution-engine in-memory`, 2.0.0 and 2.1.0, compared with 1.44.2 A.
  - C: `--execution-engine streaming`, every version except 1.35.2.
- Define scale factor and cell total (sum of measured per-query wall times,
  Parquet reads included).
- Define candidate mover: median change of at least 10% with non-overlapping
  min-max ranges. 59 analyzer comparisons, 28 candidates, plus 12 computed
  comparisons; three rounds cannot support a significance test.
- Correctness, in two sentences: every cell first passed a value-level check
  against DuckDB SQL at small scale (order-aware where the SQL has an
  ORDER BY), and every SF10 run had to match DuckDB's row count on every
  query.
- Version selection, accurately:
  - 1.35.2 is not in setup C. In the 2026-10-09 probe at SF 0.01 its streaming
    TPC-DS results had NULLs where DuckDB's SQL results had values (queries 5,
    14, 27, 67), twice. We did not determine whether Polars or BenchBox's
    DataFrame query code causes this. Do not write "the streaming engine
    diverged".
  - 1.0.0, 1.12.0 and 1.22.0 were dropped after that probe (panic; TPC-DS Q51
    mismatch; Q51 and Q87 failures).

## 3. Default settings: 2.x against 1.44.2 (200-250 words)

- Table (R16): TPC-H 2.0.0 6.53 (6.06-7.59), 2.1.0 6.16 (6.04-6.73) against
  1.44.2 11.20 (10.64-13.28): -41.7%, -45.0%. SSB 3.58 (3.30-4.08), 3.31
  (3.31-3.94) against 5.61 (5.15-7.07): -36.2%, -41.0%. ClickBench 2.31
  (2.17-2.33), 2.16 (2.02-2.37) against 4.58 (4.34-4.67): -49.6%, -52.8%. All
  six are candidate movers. TPC-DS: 2.0.0 34.13 (30.91-36.43); 1.44.2 and
  2.1.0 not reported (section 6).
- One sentence on reproducibility: the 2.0.0 ratios were -42.3%, -38.3% and
  -49.8% in our first run a month earlier, on an older BenchBox commit.
- Cross-check worth one sentence: 2.x setup A and setup C medians are within
  7% of each other on every benchmark where both qualified (largest gap
  TPC-DS 2.0.0, 34.13 against 36.53), which fits R4's statement that the
  default is now streaming.

## 4. How much of that is the switch (300-350 words)

This section carries the thesis.

- The direct measure of the switch is one version on both engines: 1.44.2
  default (in memory) against 1.44.2 streaming (R16, computed):
  - TPC-H 11.20 (10.64-13.28) to 8.06 (8.02-8.28), -28.1%: 67% of 2.0.0's
    default-settings gain, 62% of 2.1.0's.
  - SSB 5.61 (5.15-7.07) to 4.11 (4.05-4.69), -26.8%: 74% and 65%.
  - ClickBench 4.58 (4.34-4.67) to 2.64 (2.57-3.09), -42.4%: 86% and 80%.
- State that these are computed from cell medians, not analyzer comparisons;
  all three pairs meet the candidate-mover rule.
- Be honest about sensitivity: in the first run the SSB share was 51%; it is
  the least stable of the three because SSB's 1.44.2 cells moved between runs.
  Say "about two-thirds to most", not a single number.
- Reader takeaway, as a finding and not as advice: a 1.44.2 user who named the
  streaming engine already had most of what the 2.x default delivers on these
  benchmarks.
- Then the control, in memory against 1.44.2's in-memory default: 2.0.0
  TPC-H +15.5%, SSB +6.3%, ClickBench +4.2% (none a mover); 2.1.0 TPC-H -5.6%,
  SSB +2.2%, ClickBench -12.9% (a mover). With the engine held at in-memory,
  2.0.0's gain is gone; 2.1.0 keeps a small one on ClickBench.
- Method, as one imperative: set the engine explicitly in a before-and-after
  upgrade test (Polars: `collect(engine=...)` or
  `pl.Config.set_engine_affinity`, R4; BenchBox: `--execution-engine`).

## 5. Same engine, newer version (300-350 words)

- Streaming against 1.44.2 streaming (R16): TPC-H 2.0.0 -21.5%, 2.1.0
  -27.7%; SSB -7.8%, -15.9%; ClickBench -16.1%, -12.6%; TPC-DS 2.0.0 -41.4%
  (36.53 against 62.27), 2.1.0 not reported. Movers: all but SSB 2.0.0.
- 2.1.0 against 2.0.0 (computed): default and streaming within -8.8% to
  +4.1% with overlapping ranges, so no movers. In memory 2.1.0 is faster on
  all three: TPC-H -18.3% (ranges overlap), SSB -3.9%, ClickBench -16.4%
  (a mover). Keep this neutral: report the numbers, do not explain them
  without a source.
- 1.x trend, short: on streaming, TPC-H's largest 1.x step is 1.31.0 to
  1.40.1 (11.02 to 7.91, -28.2% against oldest); 1.40.1 and 1.44.2 are within
  6% of each other on every setup C benchmark (largest gap ClickBench, 2.50
  against 2.64). Omit TPC-H setup A from any trend table, with the reason
  (section 6).

## 6. What decided TPC-DS: our memory rules on a 16 GiB host (400-500 words)

Describe the rules as they worked. Keep the verbs apart: a run is "stopped"
by the safety monitor or the host sentinel; a cell is "ruled out" after the
run by the swap limit.

- 6a. Outcomes (R16, R17):
  - Qualified: 2.0.0 A, 2.0.0 C, 1.44.2 C.
  - Stopped in every round: the four 1.x defaults (largest swap growth per
    cell 6.8-7.9 GiB).
  - Finished but ruled out: 2.1.0 A and 2.1.0 C. Every round finished, every
    query succeeded, and per-run totals were 34.7-42.1 s and 36.3-40.7 s,
    close to 2.0.0's. The host swapped 1.0-5.9 GiB during those runs.
  - Mixed: 2.0.0 B, 2.1.0 B, 1.40.1 C. Crashed: 1.31.0 C (exit 138 or 139,
    12-15 s, as in the first run; not investigated).
- 6b. How each rule behaved:
  - Memory limit (14 GiB, after the run): never exceeded. macOS RSS leaves out
    swapped and compressed pages; largest reading 8.9 GiB.
  - Swap limit (1 GiB, after the run): read from the host-wide `vm_stat`
    counter, so it measures the whole machine, not the process. It is the rule
    that ruled out 2.1.0, and TPC-H 1.31.0 default.
  - Safety monitor (6 GiB swap or sustained critical pressure): the runner's
    only stopping rule, checked about every 5 seconds.
  - The host's own heavy-work sentinel also stopped eight runs at critical
    memory pressure (R18). All were in cells already failing on memory, so it
    changed no result. One sentence is enough; it shows that the machine's
    guards, not just ours, shape what a benchmark can finish.
- 6c. Spill, measured properly this time:
  - 2.0.0 turns out-of-core execution on by default (R9) and spills under the
    process temp directory, not `POLARS_TEMP_DIR` (R10, R11). Our first run
    watched the wrong directory; we fixed the runner (R19) before this run.
  - Result: 2.0.0 did not spill on TPC-DS at SF10 on this host. 2.1.0 spilled
    0.47-0.57 GiB in every default and streaming run.
- 6d. What we can say:
  - 2.0.0's default and streaming engines finished TPC-DS at SF10 on this host
    in all three rounds without spilling; no 1.x default did.
  - 2.1.0 also finished every round, but its runs spilled and the host
    swapped, and our rule counts the host's swap against the run. We do not
    know whether 2.1.0 or the rest of the machine caused that swap. Do not
    write that 2.1.0 "failed" TPC-DS.
  - These outcomes describe this host and these rules, not a version's memory
    ceiling.
- 6e. What the numbers need (state as needs, not as a roadmap, unless tracker
  items exist): swap attributed to the benchmark process rather than the host,
  memory measured including swap, safety checks on every sample, and an idle
  host.

## 7. What these numbers do not show (250-300 words)

- Correctness: value-level checks at small scale (0.01 for TPC-H and TPC-DS,
  0.1 for SSB and ClickBench); at SF10, row counts only. TPC-DS Q41 returns 10
  rows on Polars and 12 on DuckDB on every version (in full-suite totals;
  common-query totals differ by 0.021 s or less).
- Row order: streaming does not guarantee row order for joins and group-bys
  (R4). The value checks compare order keys in sequence where the SQL has an
  ORDER BY and compare as a set where it has none.
- Engine fallback: we recorded the requested engine, not whether operators
  fell back to in-memory execution.
- No comparison with DuckDB: Polars timings include Parquet reads; the DuckDB
  matrix reads a pre-loaded database.
- Host load: the host was not idle; load average before runs 10.8-43.1
  (median 16.8); memory pressure normal before every run.
- Round effect: round 1 ran 9.4% above cell medians on average. Fastest-round
  comparison gives the same direction and size (2.0.0 against 1.44.2: TPC-H
  -43.0%, SSB -36.0%, ClickBench -49.9%).
- Cell totals only: no per-query movers.

## 8. Reproduce it (150-200 words)

- One cell with the current option. Readers can run this as written:

  ```bash
  $ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
      --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
      --platform-option rechunk=false --execution-engine streaming
  ```

- The matrix runner, as a dry run that prints the 156-run plan:

  ```bash
  $ uv run --no-sync -- python scripts/run_polars_version_matrix.py \
      --output-dir ~/benchmark_runs/polars-matrix \
      --shuffle-seed 20261119 \
      --dry-run
  ```

  A full run also needs `--qualification` pointing at the committed
  `_project/analysis/polars-version-matrix/qualification.json`, whose hash
  the runner checks. Verify both commands against `develop` before
  publishing.
- Link the findings, CSV, methodology and qualification file by GitHub URL in
  `BenchBox-dev/BenchBox`. Say that raw bundles, the run manifest and the
  analysis JSON are not published.
- Note: on a 16 GiB machine, expect TPC-DS cells to hit the memory rules, and
  run on an idle host.

## 9. Conclusions (150-200 words)

- Method takeaway first: name the engine in any upgrade comparison; check that
  your memory limits measure the process you think they measure; check that
  your spill measurement watches the directory the engine writes to.
- 2.0.0 and 2.1.0 were faster than 1.44.2 in every default-settings and
  streaming comparison where both qualified.
- The size depends on what you hold fixed: against 1.x defaults, about
  two-thirds to most of the gain was already available by switching engine on
  1.44.2; between 2.0.0 and 2.1.0, small differences except in memory.
- Invite runs on hosts with more memory (the open 2.1.0 TPC-DS question), and
  reports of the 1.31.0 streaming TPC-DS crash.

## References

- R4 "Pre-release of Polars 2.0" (2026-09-02, accessed 2026-11-12). Cite it
  as the release-candidate post.
- R5 PyPI release record for 2.0.0 (accessed 2026-10-17).
- R9 Polars 2.0.0 release notes (accessed 2026-11-12).
- R10 Polars source at tag `py-2.0.0`, `crates/polars-config/src/spill_path.rs`
  (accessed 2026-11-12).
- R12 Polars 2.1.0 release notes (accessed 2026-11-12).
- BenchBox findings, methodology, CSV and qualification file in the core
  repository, by GitHub URL.
- Research notes (all four files above).

## Charts (decide at draft time)

- Candidate: grouped bars per benchmark for 1.44.2 A, 1.44.2 C, 2.0.0 A and
  2.1.0 A, with min-max whiskers. This is the section 4 argument in one
  figure. Values from the analysis JSON only; cite the field.

## Before drafting

1. Merge the core PR that publishes the refreshed `findings.md`,
   `methodology.md` and comparisons CSV for the 2026-11-19 run, so the post
   cites pages that match it.
2. Re-check the two reproduce commands against `develop`.
3. Optional, strengthens section 6: TPC-DS on a host with more memory, or with
   swap attributed per process, to settle whether 2.1.0 or the host caused the
   swap.
