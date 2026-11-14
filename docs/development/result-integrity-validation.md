---
tags: [contributor, validation, architecture]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Result Integrity Validation

BenchBox includes a three-tier integrity validator for benchmark result JSON files. The validator checks structural correctness, completeness against benchmark specifications, and statistical believability of reported metrics.

## Overview

| Property | Value |
|----------|-------|
| Module | `benchbox.core.results.integrity_validator` |
| Specs | `benchbox.core.results.benchmark_specs` |
| CLI | `benchbox results validate` (see [Results Commands](../reference/cli/results.md#cli-results-validate)); also the `validate_results.py` maintainer script (source checkout only) |
| MCP tool | `validate_results` (in `benchbox.mcp.tools.analytics`) |
| Tests | `tests/unit/core/results/test_integrity_validator.py` |

### Design Principles

- **Never raises exceptions on validation failure** - always returns a structured `IntegrityReport`
- **Composes `SchemaV2Validator`** as the first structural gate - does not reimplement schema validation
- **Specs are hardcoded** from DuckDB SF1 reference runs, not dynamically imported from benchmark modules (avoids transitive import issues)
- **Three severity levels**: FAIL (mathematical impossibility, corruption or a missing required property), WARN (suspicious but plausible) and INFO (context that never changes the overall status)
- **Skipped checks emit PASS** with a "skipped" message so check counts remain consistent across benchmarks
- **Unchecked validation is not a pass**: `summary.validation` values of `not_run`, `not_validated`, `unknown`, or `uncertain` are non-clean publication/ranking states even when all queries succeeded

## Validation Status Semantics

`summary.validation` is a public correctness signal, not a generic run-success
flag. Query success and validation success are separate claims:

| Status | Meaning | Clean publication/ranking status |
|---|---|---|
| `passed` | Validation ran and did not find failures. | Yes |
| `warnings` | Validation ran but emitted warnings. | Consumer-specific; do not treat as stronger than the recorded warnings. |
| `failed`, `partial`, `interrupted`, `error` | Validation or execution found a non-clean condition. | No |
| `not_run`, `not_validated`, `unknown` | No validation evidence was recorded. | No |
| `uncertain` | A run completed, but translation fallback or equivalent uncertainty prevents a clean correctness claim. | No |

Lifecycle finalization converts default `PASSED` placeholders to `NOT_RUN` when
no validation records or validation details exist. SQL translation fallback is
recorded under `execution.translation`; if fallback occurred and the result
otherwise looked clean, the lifecycle marks `summary.validation` as `uncertain`.
Strict translation mode is available through CLI `--strict-translation` or
runtime options (`strict_translation=true`, `translation_strict=true`, or
`sql_translation_strict=true`) for CI, publishing, and compatibility gates that
should fail closed. Public submission and publishing gates also reject
`execution.translation.status` values of `fallback` or `failed`.

## Three-Tier Validation Model

### Tier 1: Structural (8 checks)

Validates that the result JSON is well-formed and internally consistent. When `schema_v2` fails, the other seven structural checks do not run.

| Check | Severity | Description |
|-------|----------|-------------|
| `schema_v2` | FAIL | Delegates to `SchemaV2Validator` for schema compliance |
| `required_keys` | FAIL | Top-level keys present (`version`, `run`, `benchmark`, `platform`, `config`, `summary`, `phases`, `queries`, `execution`, `environment`, `export`) |
| `query_count_math` | FAIL | `passed + failed + skipped = total` in summary |
| `timing_non_negative` | FAIL | All timing fields >= 0 |
| `percentile_ordering` | FAIL | p90 <= p95 <= p99 |
| `phase_status_values` | FAIL | Phase statuses are recognized values |
| `query_entry_fields` | FAIL | Each query has required fields (id, ms, status) |
| `query_ms_non_negative` | FAIL | Per-query millisecond values >= 0 |

### Tier 2: Completeness (5 checks)

Validates that the result contains expected content for its benchmark type.

| Check | Severity | Description |
|-------|----------|-------------|
| `expected_query_ids` | FAIL below 80% of the expected IDs found, WARN from 80% to 99% | Query IDs match benchmark spec (e.g., 22 for TPC-H). Benchmarks with a minimum unique-query count FAIL below it |
| `measurement_queries_present` | FAIL | At least one measurement query (run_type='measurement' or iter > 0) |
| `power_phase_completed` | WARN | Power test phase present and in a completed status |
| `tables_object` | WARN | Tables object present when spec requires it |
| `tpc_metrics` | INFO | TPC performance metrics present for TPC-H/DS/Havoc/Skew; absence is informational because an unofficial run records no QphH or QthDS |

### Tier 3: Believability (8 checks)

Validates that reported metrics are statistically plausible.

| Check | Severity | Description |
|-------|----------|-------------|
| `avg_between_min_max` | FAIL | Average timing is between min and max |
| `geomean_plausible` | FAIL | Geometric mean is between min and max |
| `success_rate` | FAIL | Success rate (skipped queries excluded) meets the benchmark spec floor (100% for TPC-H, 80% when the benchmark has no spec); FAIL also when no query was recorded or all were skipped |
| `sf1_row_counts` | FAIL | Row counts within +/-1% of spec (SF1 only); expected tables missing from the tables metadata also FAIL |
| `timing_outliers` | WARN | No individual query exceeds 30 minutes |
| `no_duplicate_executions` | WARN | No duplicate (id, iter, stream) tuples |
| `load_time_nonzero` | WARN | Data load time > 0 |
| `host_load` | INFO | Host load average at the start and end of the run, from `environment.host_load`; "Host load not recorded" for bundles written before the field existed |

The overall status is FAIL when any check FAILs, otherwise WARN when any check WARNs, otherwise PASS. INFO findings never change it.

The overall status is FAIL when any check FAILs, otherwise WARN when any check WARNs, otherwise PASS. INFO findings never change it.

## BenchmarkSpec System

Each benchmark has a `BenchmarkSpec` frozen dataclass defining its expected characteristics:

```python
@dataclass(frozen=True)
class BenchmarkSpec:
    benchmark_id: str
    unique_query_ids: frozenset[str]
    min_unique_queries: int = 0
    min_success_rate: float = 1.0
    high_failure_expected: bool = False
    requires_tables_object: bool = True
    sf1_row_counts: dict[str, int] | None = None
    sf1_power_at_size_range: tuple[float, float] | None = None
```

### Key fields

- **`unique_query_ids`**: The complete set of expected query IDs for the benchmark
- **`min_success_rate`**: Floor for success rate checks (e.g., 1.0 for TPC-H, 0.95 for TPC-DS)
- **`high_failure_expected`**: When `True`, bypasses success rate floor (used by `transaction_primitives`)
- **`requires_tables_object`**: When `False`, skips the tables object check (used by `metadata_primitives`)
- **`sf1_row_counts`**: Expected table row counts at scale factor 1, used for believability checks

### Coverage

Specs exist for 21 of 22 registered benchmarks: `tpch`, `tpcds`, `tpchavoc`, `tpch_skew`, `ssb`, `clickbench`, `nyctaxi`, `h2odb`, `amplab`, `joinorder`, `flightdata`, `datavault`, `coffeeshop`, `tpcdi`, `tsbs_devops`, `tpcds_obt`, `read_primitives`, `write_primitives`, `metadata_primitives`, `transaction_primitives`, `vector_search`. `ai_primitives` does not yet have an integrity spec.

8 legacy aliases are mapped automatically (e.g., `star_schema` -> `ssb`, `amplab_big_data` -> `amplab`).

### Adding a spec for a new benchmark

1. Run the benchmark at SF1 on DuckDB to produce a reference result file
2. Add a new entry to the `BENCHMARK_SPECS` dict in `benchmark_specs.py`:

   ```python
   BENCHMARK_SPECS["my_benchmark"] = BenchmarkSpec(
       benchmark_id="my_benchmark",
       unique_query_ids=frozenset(["q1", "q2", "q3"]),
       min_success_rate=1.0,
       requires_tables_object=True,
       sf1_row_counts={
           "table_a": 100_000,
           "table_b": 50_000,
       },
   )
   ```

3. If the benchmark has legacy aliases, add them to `LEGACY_ALIASES`
4. Run the test suite: `uv run -- python -m pytest tests/unit/core/results/test_integrity_validator.py`

## IntegrityReport

The validator returns an `IntegrityReport` dataclass:

```python
@dataclass
class IntegrityReport:
    file: str
    benchmark_id: str
    platform: str
    scale_factor: float
    overall_status: CheckStatus
    checks: list[CheckResult]
    summary: dict[str, int]
```

The fields are:

- `file`: the file path validated.
- `benchmark_id`: the benchmark identifier.
- `platform`: the platform name.
- `scale_factor`: the scale factor.
- `overall_status`: the worst status across all checks.
- `checks`: the individual check results.
- `summary`: counts by status (PASS, INFO, WARN, FAIL).

**Helper methods:**

- `report.passed()` - Returns `True` if overall status is PASS
- `report.has_warnings()` - Returns `True` if any check has WARN status

Each `CheckResult` contains:

```python
@dataclass
class CheckResult:
    category: CheckCategory
    name: str
    status: CheckStatus
    message: str
    details: dict | None
```

The fields are:

- `category`: STRUCTURAL, COMPLETENESS, or BELIEVABILITY.
- `name`: the check identifier, for example `query_count_math`.
- `status`: PASS, INFO, WARN, or FAIL.
- `message`: a human-readable description.
- `details`: optional structured details.

## Convenience Functions

The module provides two convenience functions for common use cases:

```python
from benchbox.core.results.integrity_validator import validate_file, validate_directory

report = validate_file(Path("results/tpch_duckdb_sf1.json"))

reports = validate_directory(Path("results/"), pattern="*.json")
```

`validate_file` validates a single file. `validate_directory` validates a directory and returns a list of reports.

Both functions handle invalid JSON gracefully - returning a FAIL report rather than raising exceptions.

## Access Points

| Interface | Usage |
|-----------|-------|
| **CLI** | `benchbox results validate <path> [options]`, exiting 5 on a FAIL finding; the `validate_results.py` maintainer script wraps the same validator, in a source checkout |
| **MCP tool** | `validate_results(result_file="...", verbose=True)` |
| **Python API** | `from benchbox.core.results.integrity_validator import validate_file` |

See the [CLI reference](../reference/cli/results.md#cli-results-validate) and [MCP reference](../reference/mcp.md) for usage details.

## Special Cases

- **`metadata_primitives`**: Has `requires_tables_object=False` and is excluded from load-time checks (no data loading phase)
- **`transaction_primitives`**: Has `high_failure_expected=True` - bypasses the success rate floor since failures are an expected part of transaction testing
- **Non-SF1 results**: Row count checks are skipped (emitted as PASS with "skipped" message)
- **Non-TPC benchmarks**: TPC metric checks are skipped similarly
