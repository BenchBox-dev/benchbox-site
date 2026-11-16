---
tags: [guide, performance]
---

# Gate Performance in CI with `benchbox compare`

This guide shows how to fail a CI job when a benchmark gets slower, using `benchbox compare` against a stored baseline. It follows the method BenchBox uses for its own nightly performance gate, and it says plainly what that method cannot detect.

A naive check, which runs the benchmark once and compares it with a number you measured on your laptop, does not work. Hosted runners vary from night to night and from machine to machine, so a single-run comparison either fails on noise or has to be loosened until it misses real regressions. The steps below replace it with a baseline built from several runs on the same kind of runner and with thresholds taken from the measured spread.

## The design in one page

1. A workflow runs a small, fixed benchmark on every pull request, every night and on demand.
2. `benchbox compare` compares each run with a **baseline file stored in your repository**.
3. The baseline is the per-query median of at least five earlier runs on **one runner class**. It is never one run, and never a local run.
4. A query counts as regressed only when it is slower by more than a percentage **and** by more than a minimum number of milliseconds. The same two-part rule applies to the total time. Both minimums come from the spread you measured, not from a guess.
5. The job branches on the distinct exit codes of `compare`.

This design stores a baseline. An alternative runs the base commit and the head commit in the same job and compares them with each other, which removes runner variation between runs. This guide does not use it, because BenchBox's own gate is built on the stored baseline and the sensitivity review of that gate has not ruled on the alternative.

## Build the baseline

Run the benchmark at least five times on the runner class that the gate will use, keep each result file, and build the baseline from them:

- **Use several runs.** A single run carries its own noise, so copying it over the baseline only moves the noise problem into the baseline. The baseline is the per-query median of the runs.
- **Use one runner class.** Hosted runners come from several CPU models. In BenchBox's own runs a night's total time differed by up to 25% between models: about 440 ms on one AMD EPYC model, 520 to 535 ms on a Xeon model and 540 to 590 ms on another EPYC model, for the same benchmark. A baseline built from a mixed pool fails the nights that land on slower hardware. BenchBox's builder reads `environment.cpu_model` from each result and uses only the results from the slowest CPU model that has at least five of them. A slower or equal night then compares cleanly, and a faster night cannot fail.
- **Never use a local run.** A laptop is a different runner class with different noise.
- **Keep the sources.** Store a record of which runs went into the baseline, with their CPU models and totals, next to the baseline file. The builder writes it.

The [example workflow](#the-example-workflow) uploads each run's result as an artifact named `perf-regression-result`. The first runs fail at the compare step, because no baseline exists yet, and still upload their results, so run the workflow five or more times, then build the baseline from those runs with the script below. It downloads each run's artifact, builds the baseline and the sources record with BenchBox's `perf_smoke_baseline.py`, replays every in-baseline source result through the gate, and prints the two minimum-delta values to set in the workflow.

```bash
./build-perf-baseline.sh RUN_ID RUN_ID RUN_ID RUN_ID RUN_ID
```

Commit the baseline and its sources record. Rebuild them after a runner change, after a dependency upgrade that moves every query, and after a deliberate performance change you want to lock in. Rebuild from fresh runs rather than raising a threshold: if the noise floor creeps but no single change regressed, a new baseline is the fix.

## Choose the thresholds

`benchbox compare` takes three options that decide whether a run fails:

| Option | Meaning |
| --- | --- |
| `--fail-on-regression 10%` | Fail when something is more than 10% slower than the baseline. Without this option a regression never changes the exit status. |
| `--min-regression-delta 7ms` | Count a query as regressed only when it is also slower by more than this. Applies to individual queries. |
| `--min-aggregate-regression-delta 82ms` | Count a total or average as regressed only when it is also slower by more than this. Applies to aggregate metrics. |

Both minimum-delta options need `--fail-on-regression`. A query or an aggregate fails the gate only when it is over the percentage **and** over its minimum delta. At small scale factors a percentage alone is useless: BenchBox's TPC-H queries at scale factor 0.01 each run in 3 to 13 ms, so 10% is a fraction of a millisecond and scheduling jitter alone exceeds it.

### Derive the minimum deltas from measured spread

Take the runs you built the baseline from.

1. **Per-query spread.** For each query, subtract its lowest time from its highest across the runs. The largest of these is the per-query spread.
2. **Per-query floor.** Multiply the largest spread by 1.25 and round up to a whole millisecond. That is `--min-regression-delta`.
3. **Aggregate spread.** Subtract the lowest total from the highest total across the runs.
4. **Aggregate floor.** Multiply by 1.25 and round up. That is `--min-aggregate-regression-delta`.

Worked example, from BenchBox's own gate. The nine nightly results from 30 September to 8 October 2026 had a largest per-query spread of 5.4 ms (query 18). That is above the 4 ms level at which a flat 5 ms floor stops being safe, so the floor is 1.25 × 5.4 = 6.75, rounded up to **7 ms**. For the totals, six runs on the baseline's runner class spanned 539.8 to 604.7 ms, a spread of 64.9 ms, so the aggregate floor is 1.25 × 64.9 = 81.1, rounded up to **82 ms**. With a baseline total of 547 ms, that floor lets the noisiest observed night (+57.7 ms) pass, while a uniform 2× slowdown still fails.

The 10% figure is a starting point. The two floors usually bind first on a small benchmark. These values belong to BenchBox's benchmark and runners. Derive your own from your own runs, and recompute them whenever you rebuild the baseline.

> [!NOTE]
> The floor is a maximum over the runs you measured. A later run can exceed it. Measure more runs when you can, and treat a failure that disappears on a re-run with suspicion about the floor, not about the code.

## Branch on the exit codes

`benchbox compare` in file mode (two result files) exits with:

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | No regression beyond the thresholds. | Pass. |
| 1 | An input could not be read, or an option value is malformed (for example `--fail-on-regression ten`). | Fix the job. This is not a performance finding. |
| 2 | Invalid option combination, for example a minimum-delta option without `--fail-on-regression`. | Fix the job. |
| 3 | A regression exceeded `--fail-on-regression` and its minimum delta. | Fail the build with a performance message. |
| 4 | The two results cannot be compared: different execution variants or timing modes. | Rebuild the baseline from runs that match the current ones. |

Exit code 6, an acknowledgement refused for a billable platform, applies to runs of billable platforms and does not occur when comparing two files. Codes 75 to 79 belong to BenchBox's heavy-work host lock and are never `compare` results.

Treat 3 differently from every other nonzero code. A 3 is a performance finding that someone should read. A 1, 2 or 4 means the gate did not measure anything, and a job that fails the same way for both gives people no way to tell a slow build from a broken pipeline. The example workflow maps each code to its own message.

## The example workflow

This workflow runs DuckDB on TPC-H at scale factor 0.01, compares the result with a stored baseline, and branches on the exit codes. It runs on pull requests, nightly and on demand, and uploads each result as an artifact. The actions are pinned to commit SHAs. Set the two minimum-delta values from your own runs.

```yaml
name: perf-regression

on:
  pull_request:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:

permissions:
  contents: read

env:
  BENCHBOX_VERSION: "0.5.2"
  BASELINE_PATH: perf/baselines/duckdb_tpch_sf001.json
  FAIL_ON_REGRESSION: 10%
  MIN_REGRESSION_DELTA: 7ms
  MIN_AGGREGATE_REGRESSION_DELTA: 82ms

jobs:
  perf-regression:
    name: DuckDB TPC-H SF=0.01 regression gate
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Checkout code
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09

      - name: Set up Python
        uses: actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1
        with:
          python-version: '3.11'

      - name: Install BenchBox
        run: python -m pip install "benchbox[duckdb]==${BENCHBOX_VERSION}"

      - name: Set isolated benchmark output
        run: echo "BENCHBOX_OUTPUT_DIR=$RUNNER_TEMP/perf-regression" >> "$GITHUB_ENV"

      - name: Run DuckDB TPC-H SF=0.01 power phase
        run: |
          benchbox run \
            --platform duckdb \
            --benchmark tpch \
            --scale 0.01 \
            --phases power \
            --non-interactive

      - name: Locate current result file
        id: current
        run: |
          results=()
          while IFS= read -r result; do
            results+=("$result")
          done < <(find "$BENCHBOX_OUTPUT_DIR/results" -maxdepth 1 -name 'tpch_sf001_duckdb_sql_*.json' -print)
          if [[ "${#results[@]}" != "1" ]]; then
            echo "Expected one current result file, found ${#results[@]}." >&2
            exit 1
          fi
          echo "path=${results[0]}" >> "$GITHUB_OUTPUT"

      - name: Compare against stored baseline
        env:
          CURRENT_RESULT: ${{ steps.current.outputs.path }}
        run: |
          set +e
          benchbox compare \
            "$BASELINE_PATH" \
            "$CURRENT_RESULT" \
            --fail-on-regression "$FAIL_ON_REGRESSION" \
            --min-regression-delta "$MIN_REGRESSION_DELTA" \
            --min-aggregate-regression-delta "$MIN_AGGREGATE_REGRESSION_DELTA" \
            --non-interactive
          status=$?
          set -e
          case "$status" in
            0)
              echo "No regression beyond the per-query and aggregate floors."
              ;;
            3)
              echo "::error::Performance regression: a query or the aggregate exceeded ${FAIL_ON_REGRESSION} and its floor."
              exit 1
              ;;
            4)
              echo "::error::Baseline and current result are not comparable (different variant or timing mode). Rebuild the baseline."
              exit 1
              ;;
            2)
              echo "::error::Invalid compare options: the minimum-delta options require --fail-on-regression."
              exit 1
              ;;
            1)
              echo "::error::compare failed: unreadable result file or invalid FAIL_ON_REGRESSION or minimum-delta value."
              exit 1
              ;;
            *)
              echo "::error::compare exited with unexpected status ${status}."
              exit 1
              ;;
          esac

      - name: Upload result artifact
        if: always()
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f
        with:
          name: perf-regression-result
          path: ${{ env.BENCHBOX_OUTPUT_DIR }}/results/*.json
          retention-days: 30
```

The workflow expects the baseline at `perf/baselines/duckdb_tpch_sf001.json`. It pins BenchBox to one version, so a BenchBox upgrade is a reviewed change that can come with a new baseline. The two minimum deltas shown are BenchBox's own; set yours from the derivation above.

The baseline script that the guide refers to:

```bash
#!/usr/bin/env bash
set -euo pipefail

BUILDER_REF="4c848ffdd6d55567ce7b4200a027c787586380b3"
BUILDER_URL="https://raw.githubusercontent.com/BenchBox-dev/BenchBox/${BUILDER_REF}/scripts/perf_smoke_baseline.py"
ARTIFACT_NAME="${ARTIFACT_NAME:-perf-regression-result}"
BASELINE_OUTPUT="${BASELINE_OUTPUT:-perf/baselines/duckdb_tpch_sf001.json}"
SOURCES_OUTPUT="${SOURCES_OUTPUT:-perf/baselines/duckdb_tpch_sf001.sources.json}"

usage() {
  cat <<'USAGE'
usage: build-perf-baseline.sh RUN_ID RUN_ID RUN_ID RUN_ID RUN_ID [RUN_ID ...]

Builds the stored baseline from at least five completed runs of the perf-regression
workflow, each downloaded from its own run, then replays every in-baseline source result through
the gate and prints the two floors to set in the workflow.

Requires: gh (authenticated for this repository), jq, python3, curl, and benchbox on PATH.
Environment: ARTIFACT_NAME, BASELINE_OUTPUT, SOURCES_OUTPUT.
USAGE
}

if [[ "$#" -lt 5 ]]; then
  usage >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "$BUILDER_URL" -o "$work/perf_smoke_baseline.py"

sources=()
for run_id in "$@"; do
  gh run download "$run_id" -n "$ARTIFACT_NAME" -D "$work/$run_id"
  results=()
  while IFS= read -r result; do
    results+=("$result")
  done < <(find "$work/$run_id" -name 'tpch_sf001_duckdb_sql_*.json' -print)
  if [[ "${#results[@]}" != "1" ]]; then
    echo "run $run_id: expected exactly one tpch_sf001_duckdb_sql_*.json result, found ${#results[@]}" >&2
    exit 1
  fi
  result="${results[0]}"
  sources+=("$run_id=$result")
done

mkdir -p "$(dirname "$BASELINE_OUTPUT")" "$(dirname "$SOURCES_OUTPUT")"
python3 "$work/perf_smoke_baseline.py" "${sources[@]}" \
  --output "$BASELINE_OUTPUT" \
  --sources-output "$SOURCES_OUTPUT"

query_floor="$(jq -r '.regression_floor.floor_ms' "$SOURCES_OUTPUT")"
aggregate_floor="$(jq -r '[.source_runs[] | select(.in_baseline) | .total_ms] | (max - min) * 1.25 | ceil' "$SOURCES_OUTPUT")"

while IFS= read -r run_id; do
  source_result=""
  for source in "${sources[@]}"; do
    if [[ "${source%%=*}" == "$run_id" ]]; then
      source_result="${source#*=}"
    fi
  done
  if ! replay_output="$(benchbox compare "$BASELINE_OUTPUT" "$source_result" \
    --fail-on-regression 10% \
    --min-regression-delta "${query_floor}ms" \
    --min-aggregate-regression-delta "${aggregate_floor}ms" \
    --non-interactive 2>&1)"; then
    echo "replay of run $run_id failed the gate:" >&2
    echo "$replay_output" >&2
    exit 1
  fi
done < <(jq -r '.source_runs[] | select(.in_baseline) | .workflow_run_id' "$SOURCES_OUTPUT")

echo "MIN_REGRESSION_DELTA: ${query_floor}ms"
echo "MIN_AGGREGATE_REGRESSION_DELTA: ${aggregate_floor}ms"
```

Run it where `gh` is authenticated for your repository and `benchbox`, `jq`, `curl` and `python3` are on the path. It fetches BenchBox's `perf_smoke_baseline.py` from a pinned commit.

Before you rely on the gate, test it in both directions. A normal run must exit 0. Then check that a regression exits 3, for example by comparing the baseline with a copy whose query times you have raised by more than both floors:

```bash
benchbox compare perf/baselines/duckdb_tpch_sf001.json slowed.json \
  --fail-on-regression 10% --min-regression-delta 7ms --min-aggregate-regression-delta 82ms
echo $?
```

## What this gate cannot detect

The gate is a trade. The minimum deltas keep scheduling noise from failing builds, and the same minimums hide real slowdowns. The figures below are measured with BenchBox's own baseline (547.4 ms total over 22 TPC-H queries at scale factor 0.01, EPYC 7763) and gate options (10%, 7 ms, 82 ms), by editing a copy of the baseline and running the real `benchbox compare`. A regression exits 3. The review that produced these numbers is BenchBox's own adversarial check of the gate, and it has not yet ruled on whether to change the floors. Read this section as the current limits of the method, not as a promise that they will change.

### A small query can double and pass

A query counts as regressed only when it is more than 10% slower and more than 7 ms slower. At this scale every query runs in 4.4 to 12.3 ms, so the 7 ms term alone decides.

| Query | Baseline | Slowest time that still passes | Ratio |
| --- | --- | --- | --- |
| Smallest | 4.4 ms | 11.4 ms | 2.59× |
| Median | about 8.3 ms | 15.3 ms | 1.84× |
| Slowest | 12.3 ms | 19.3 ms | 1.57× |

Doubling the smallest query from 4.4 ms to 8.8 ms (in all three measured iterations) moved the total from 547.4 to 561.2 ms, +13.8 ms, far below the 82 ms aggregate floor, and the gate passed. A query at +7.0 ms passed, and +7.2 ms failed.

The floor cannot be both jitter-proof and sensitive for queries this short. Query 18 alone varied by 5.4 ms between healthy nights, so a smaller floor would fail healthy builds. The 5.4 ms is also a maximum over nine nights, so a tenth night can exceed it.

### About 15% of the total time passes, and small regressions stack silently

The aggregate floor (82 ms) is larger than 10% of the baseline total (54.7 ms), so the floor, not the percentage, decides. Every entry slowed by 14% passed (+76.5 ms); 16% failed (+87.7 ms). The gate tolerates a uniform slowdown of about 15%.

The per-query and aggregate floors do not add up to a tighter bound. Three queries each slowed by 7 ms in every iteration added 63.0 ms to the total and fired nothing; a fourth added 84.0 ms and fired the aggregate check. A regression that adds the same few milliseconds to a handful of short queries is invisible until it touches more than three of them.

### The average adds nothing

`compare` applies the same millisecond floor to the average query time as to the total. The average is the total divided by the 66 measured executions, so it would have to rise by more than 82 ms, about ten times its 8.3 ms value, to fail. It never fires before the total does.

### Only the last measured execution of each query is judged

Per query, `compare` reads one time: the last recorded execution. A spike in an earlier iteration, or in the warm-up, is invisible query by query. It shows only through the total, and only when it is large: making the first measured iteration of every query ten times slower fired the aggregate check alone.

### Faster runners hide larger regressions

The baseline uses the slowest runner class, and `compare` does not look at the CPU model. The same trip level of 629.4 ms (547.4 + 82) applies on every machine, so the regression that can hide depends on which hardware the job lands on:

| Runner class (source totals) | Regression hidden before the gate fires |
| --- | --- |
| Baseline class, EPYC 7763 (539.8 to 586.1 ms) | +89.6 ms (16.6%) from the fastest night |
| Xeon 8573C (534.0 ms) | +95.4 ms (17.9%) |
| Xeon 8370C (518.8 ms) | +110.6 ms (21.3%) |
| EPYC 9V74 (409.7 to 465.0 ms) | +164.4 ms (35.4%) from 465.0 ms; +219.7 ms (53.6%) from 409.7 ms |

This is the intended trade: no false failures on slow hardware, less sensitivity on fast hardware. A failing run does not say which CPU it ran on. The result file records `environment.cpu_model`, so when an aggregate check fails and no single query explains it, compare the run's CPU model with the baseline's before you treat it as a regression.

### Work that is not compared

Only the query timings of the measured phase are compared. Tripling `run.total_duration_ms` passed, and so did a ten-fold slower data load and warm-ups five times slower. Setup, loading and validation time are outside the gate.

### Missing and failed queries pass

`compare` walks the baseline's queries and skips any that the current result does not contain. A query that vanished from the result passed, and because the total shrank it looked like an improvement (517.0 ms against 547.4 ms). A query recorded as failed with a time of `0.0` or no time also passed, because `compare` does not read the query status. The `benchbox run` step in front of it may fail the job on its own when a query fails, but the review did not establish that, so do not rely on it. If your gate must fail on a missing or failed query, check for it in the job before you call `compare`.

### A fixed baseline, no trend memory and no retry

- Slow drift is caught eventually, because each run is compared with the same reference. Rebuilding the baseline from recent runs re-bases it on whatever has crept in, and a creep of 15% or less passes both before and after.
- Neighbouring runs are never compared with each other, so a transient bad runner and a real regression look the same in the log.
- The gate does not retry. A run that fails on a bad runner needs a re-run by a person.
- On pull requests the example gates every change. BenchBox's own gate runs nightly, so a change reaches it a day after it merges.

### What the gate is good for

It catches large, broad slowdowns in the benchmarked path: a uniform slowdown beyond about 15%, or a few queries slowing by more than the per-query floor each. It does not catch small ones, and it does not measure anything outside the timed queries. If you need to detect a 5% regression on a short benchmark, a stored-baseline gate with floors from hosted-runner spread cannot do that. Use a larger scale factor, so each query runs for long enough that the floor is a small share of it, or a dedicated runner with less noise.

## Related

- [Result Bundle Schema (2.4)](../reference/result-schema.md) describes the result files that `compare` reads.
- [Platform Comparison Guide](platform-comparison.md) covers comparing platforms with each other rather than a build with its baseline.
