# Fast-lane guards

The "fast lane" is every test collected under `pytest -m fast` (excluding
`slow`/`stress`/`resource_heavy`/`live_integration`) -- the required,
sub-few-minutes suite every develop PR runs in `code-test`
(`.github/workflows/ci.yml`).

## No test-count ceiling

There is no limit on how many tests the fast lane may collect. The
`code-test` job's `timeout-minutes` cap is a hard cancel, not a detection
mechanism; it does not notice a slowdown that stays under the cap.

## Fast-tier duration report

The `core` job runs a blocking `verify-fast-duration` step on pull requests.
It downloads the PR's `fast-junit` artifact and compares it with the
committed baseline in `tests/fixtures/fast_tier_baseline`
(`python -m scripts.build_fast_duration_baseline verify`). Each run's test
times are scaled by the runner-speed factor from its calibration record, so a
slow hosted runner is not mistaken for a slowdown.

The job summary shows the normalized summed time over tests present in both
runs, the delta, the summed-time ratio, the median per-test ratio, coverage of
the baseline ids, the runner speed factor and the pytest collection time. Tests
missing from the baseline are allowed 0.5 seconds each; time beyond that counts
toward the delta. Job wall time is not a metric.

The step fails the `core` job on any of these outcomes:

- `would-block`: the ratio exceeds 1.30 and the delta exceeds 360 seconds
  (provisional thresholds).
- `rejected`: the run has no calibration record, or the committed baseline is
  missing or unusable.
- `neutral`: the two runs share no comparable tests.
- Baseline-id coverage below 95 percent.

The comparison reads the mode, the thresholds, the script and the baseline from
the PR head, so a PR can change them. Those paths
(`scripts/build_fast_duration_baseline.py`, `scripts/fast_tier_calibration.py`,
`tests/duration_policy.py`, `tests/__init__.py` and
`tests/fixtures/fast_tier_baseline/`) are soundness paths in the oracle review.
A PR that makes the fast tier slower on purpose refreshes the baseline in the
same PR. `pr-arm` refuses to arm a head with a `would-block` verdict unless the
PR changes `tests/fixtures/fast_tier_baseline`.

To roll the gate back to report-only, set `VERIFY_MODE` in
`scripts/build_fast_duration_baseline.py` to `"report"`.

The thresholds are provisional and the calibration sample is small. In the
recorded evidence (`quality/fast-duration-calibration.json`, a bounded
convenience sample of recent runs) the same head ran at ratios of 0.976 and
1.156 depending on runner speed, and no false-block rate was measured. Treat a
block near the thresholds as possible noise: rerun the job before refreshing
the baseline.

## Marker and path guards

A guard script stops the wrong kind of test from entering the lane. It reads
the fast-lane policy file:

- `forbidden_marker_expressions`: for each expression, the script collects
  `pytest -m "fast and <expression>"`. A non-empty selection is a
  `FAST_LANE_VIOLATION` (currently `resource_heavy`, `stress` and
  `live_integration`).
- `forbidden_path_substrings`: any fast-lane test whose node ID contains one
  of these substrings is a `FAST_LANE_VIOLATION`. The list is empty today.
- `enabled`: set to `false` to switch the guards off.

The guards run as `guard-fast-lane-markers` in the `code-lint` job of
`ci.yml`, in `lint.yml` for release branches, in `make ci-lint`, and in the
`timing-policy-fast-lane` pre-push hook, all with `--strict`. If pytest
cannot collect, the script reports `FAST_LANE_ENVIRONMENT_ERROR` instead of a
violation, because nothing is known to be wrong with the lane; run it from the
project environment (for example through `make ci-lint`). To fix a violation,
remove the forbidden marker from the test or move the test out of the fast
tier.

## Medium tier

The `medium-test` job in `.github/workflows/ci.yml` splits the medium tier
across four Linux runners. Its `timeout-minutes` (25 minutes) is a hard cancel
that backstops a hung tier, not a policy check. `make test-medium` runs the
full medium suite locally.
