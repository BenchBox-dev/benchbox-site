---
tags: [reference, cli, intermediate]
---

<span id="cli-run"></span>

# `run` - Run Benchmarks

The primary command for executing benchmarks. Supports interactive mode, direct execution, and various execution phases.

## Basic Syntax

```bash
benchbox run [OPTIONS]
```

## Core Options

**Platform and Benchmark Selection:**

- `--platform TEXT`: Platform type
  - SQL platforms: `duckdb`, `sqlite`, `databricks`, `bigquery`, `snowflake`, `redshift`, `clickhouse`, `datafusion`, `polars`, `trino`, `presto`
  - DataFrame platforms: `polars-df`, `pandas-df`, `pyspark-df`, `datafusion-df` (see [DataFrame Platforms](../../platforms/dataframe.md))
- `--benchmark TEXT`: Benchmark name (tpch, tpcds, tpcdi, ssb, clickbench, h2odb, etc.)
- `--scale FLOAT`: Scale factor for data generation (default: 0.01)

**Execution Control:**

- `--phases TEXT`: Benchmark phases to run (default: "power")
  - Available phases:
    - `generate` - Generate benchmark data files
    - `load` - Load data into database
    - `warmup` - Run warmup queries (optional, prepares caches)
    - `power` - Sequential query execution (Power Test)
    - `throughput` - Concurrent query execution (Throughput Test)
    - `maintenance` - **Data modification operations (DATABASE RELOAD REQUIRED AFTER)** - See [TPC-H Maintenance](../../guides/tpc/tpc-h-official-guide.md#maintenance-test) or [TPC-DS Maintenance](../../guides/tpc/tpc-ds-official-guide.md#maintenance-test)
  - Use comma-separated list: `--phases generate,load,power`
  - **Warning:** Maintenance phase permanently modifies data; reload database before running power/throughput again
  - **Note:** the number of concurrent streams for the `throughput` phase is set
    with `--streams N` (an advanced option listed by
    `benchbox run --help-topic all`; `--concurrency N` is accepted as an
    alias). The deprecated `run-official` command also spells the setting
    `--streams` — see [Deprecated: `run-official`](#deprecated-run-official)
    below.
- `--iterations INTEGER`: Number of measured power test iterations (default: 3, minimum 1). Each power test also runs one warm-up pass first. Power phase only; a warning is printed when no power phase is selected. An advanced option listed by `benchbox run --help-topic all`.
- `--force [MODE]`: Force a rerun (modes: `all`, `datagen`, `upload`, or `datagen,upload`; a bare `--force` means `all`). What each value deletes is in [Forced Reruns](#forced-reruns)
- `--timeout SECONDS`: Stop the whole run (generate, load and execute) after this many seconds. Exits with code 124 and keeps a partial result marked `timed_out`. Unset means no limit and `0` also means no limit; a negative or fractional value is a usage error. When omitted, `execution.timeout_seconds` from the config file applies. Details in [Run Time Limit](#run-time-limit)
- `--non-interactive`: Use defaults for all prompts (useful for automation)

**Output and Paths:**

- `--output TEXT`: Output directory (supports local paths and cloud storage: s3://, gs://, abfss://)
- `--dry-run OUTPUT_DIR`: Preview configuration and queries without execution

**Query Configuration:**

- `--seed INTEGER`: An RNG seed for query parameter generation (power/throughput tests)
- `--queries TEXT`: Run specific queries in specified order (comma-separated IDs: "1,6,17")
  - **Constraints**:
    - Max 100 queries per run
    - Alphanumeric IDs only (letters, numbers, dash, underscore; max 20 chars each)
    - Only works with `power` and `standard` phases (errors if used with ONLY incompatible phases)
    - Duplicates automatically removed
    - Order preserved as specified
  - **TPC Compliance**: Breaks official TPC-H/TPC-DS compliance (overrides stream permutations)
  - **Valid Ranges**: TPC-H (1-22), TPC-DS (1-99), SSB (1-13)
  - **Examples**:

    ```bash
    benchbox run --platform duckdb --benchmark tpch --queries "Q6"

    benchbox run --platform postgres --benchmark tpch --queries "Q1,Q6,Q17"

    benchbox run --platform duckdb --benchmark tpcds --queries "Q42" --verbose --phases power
    ```

    The first example runs a single query for debugging. The second runs several queries in the order given. The third adds verbose logging for development.

**Tuning and Optimization:**

- `--tuning TEXT`: Tuning mode (default: "notuning")
  - `tuned`: Enable optimizations (constraints for SQL, parallelism for DataFrame)
  - `notuning`: Disable for baseline comparison
  - `auto`: Auto-detect optimal settings based on system profile
  - Path to config file: Custom tuning configuration (YAML)

**Data Compression (Advanced):**

- `--compression TEXT`: Compression configuration (e.g., `zstd`, `zstd:9`, `gzip:6`, `none`)
  - Format: `TYPE` or `TYPE:LEVEL`
  - Types: `zstd` (default), `gzip`, `none`
  - Levels: 1-9 for gzip, 1-22 for zstd

**Validation (Advanced):**

- `--validation TEXT`: Validation mode
  - `exact`: Exact row count validation (default)
  - `loose`: Loose validation (±50% row-count tolerance, applied to each query's expected row count)
  - `range`: Min/max bounds validation
  - `disabled`: No validation
  - `full`: All validation checks enabled (preflight, postgen, postload, platform check)
  - `preflight`, `postgen`, `postload`, `check-platforms`: Individual validation types
- `--strict-translation`: Fail instead of falling back when SQL dialect translation cannot produce target SQL
- `--client-region TEXT`: Attested client cloud region (e.g. `us-east-1`), recorded in `environment.client_link` with `source: "cli_option"`
- `--client-cloud TEXT`: Attested client cloud provider (`aws`, `gcp`, `azure`)
- `--no-link-probe`: Disable the post-benchmark statement overhead probe (6 metered `SELECT 1` statements on billable warehouses)

**Platform-Specific Configuration:**

- `--platform-option KEY=VALUE`: Platform-specific option (can be used multiple times)
- Use `benchbox platforms status <name>` to view platform details
- Universal keys available on all platforms:
  - `driver_version` - pin the Python driver package version (e.g. `1.2.0`)
  - `driver_auto_install` - auto-install the requested driver via uv if missing (`true`/`false`)
  - `force_recreate` - drop and recreate the benchmark database before loading, reusing the existing data files (`true`/`false`); DataFrame runs ignore it
- Athena Spark only: `runtime_version` - record the Spark engine version you expect (e.g. `PySpark engine version 3`); the workgroup sets the version and BenchBox records this value as requested

**Benchmark-Specific Configuration:**

- `--benchmark-option KEY=VALUE`: Benchmark-specific option (can be used multiple times)
- Run `benchbox run --help-topic benchmarks` to see all available options per benchmark
- Selected benchmarks and their options:

  | Benchmark | Option | Default | Description |
  |-----------|--------|---------|-------------|
  | `nyctaxi` | `taxi_types` | - | Taxi types to load: `yellow`, `green`, `hvfhv` (comma-separated) |
  | `nyctaxi` | `year` | `2019` | Year of TLC data (2019-2025) |
  | `nyctaxi` | `months` | - | Months to include, comma-separated (1-12) |
  | `nyctaxi` | `seed` | - | Random seed for reproducibility |
  | `nyctaxi` | `force_regenerate` | - | Force data regeneration (`true`/`false`) |
  | `tpch_skew` | `skew_preset` | `moderate` | Skew distribution: `none`, `light`, `moderate`, `heavy`, `extreme`, `realistic` |
  | `tpch_skew` | `force_regenerate` | - | Force data regeneration |
  | `tsbs_devops` | `num_hosts` | - | Number of simulated hosts |
  | `tsbs_devops` | `duration_days` | - | Duration in days for data generation |
  | `tsbs_devops` | `interval_seconds` | `10` | Measurement interval in seconds |
  | `tsbs_devops` | `start_time` | - | Start time ISO format (e.g. `2019-01-01T00:00:00`) |
  | `tsbs_devops` | `seed` | - | Random seed for reproducibility |
  | `tsbs_devops` | `force_regenerate` | - | Force data regeneration (`true`/`false`) |
  | `datavault` | `hash_algorithm` | `md5` | Hash algorithm for hub/link keys: `md5`, `sha256` |
  | `datavault` | `record_source` | `TPCH` | Record source identifier for audit columns |
  | `datavault` | `force_regenerate` | - | Force data regeneration (`true`/`false`) |
  | `flightdata` | `end_year` | latest | Last year of flight data to include |
  | `flightdata` | `seed` | - | Random seed for reproducibility |
  | `flightdata` | `force_regenerate` | - | Force data regeneration (`true`/`false`) |
  | `joinorder` | `queries_dir` | - | Directory containing custom query files; defaults to the embedded 113 canonical JOB queries |
  | `joinorder` | `force_regenerate` | - | Clear and refetch verified canonical data (`true`/`false`); `joinorder` still requires `--scale 1` |
  | `tpcdi` | `enable_parallel` | `false` | Enable parallel processing for ETL |
  | `tpcdi` | `max_workers` | - | Maximum number of parallel workers |
  | `tpcds_obt` | `dimension_mode` | `full` | OBT dimension mode: `full`, `minimal` |
  | `tpcds_obt` | `channels` | - | Sales channels: `store`, `web`, `catalog` (comma-separated) |
  | `tpcds_obt` | `output_format` | `parquet` | Output format: `dat`, `parquet` |
  | `tpcds_obt` | `tpcds_source_dir` | - | Directory containing TPC-DS source data |
  | `tpcds_obt` | `force_regenerate` | - | Force data regeneration (`true`/`false`) |
  | `vector_search` | `dimensions` | `1536` | Embedding vector dimensions |

  Most options also accept a hyphenated alias (e.g. `taxi-types` for `taxi_types`).

**Logging and Output:**

- `--verbose`, `-v`: Enable verbose logging (use `-vv` for very verbose)
- `--quiet`, `-q`: Suppress all output (overrides verbose flags)

**Help System:**

- `-h, --help`: Show common options
- `--help-topic all`: Show all options including advanced
- `--help-topic examples`: Show categorized usage examples
- `--help-topic benchmarks`: Show benchmark-specific options (see `--benchmark-option` below)

## Usage Examples

### Basic Local Benchmark

```bash
benchbox run --platform duckdb --benchmark tpch --scale 0.01

benchbox run --platform duckdb --benchmark tpch
```

The first command is a simple TPC-H benchmark on DuckDB. The second uses the default settings.

### Cloud Platform Examples

```bash
benchbox run --platform databricks --benchmark tpch --scale 0.1 \
  --output dbfs:/Volumes/workspace/raw/benchmarks/

benchbox run --platform bigquery --benchmark tpcds --scale 0.01 \
  --verbose --phases power

benchbox run --platform snowflake --benchmark tpch --scale 1 \
  --tuning tuned
```

The examples use Databricks with a custom output location, BigQuery with verbose logging, and Snowflake with tuning enabled.

### DataFrame Platform Examples

```bash
benchbox run --platform polars-df --benchmark tpch --scale 1 \
  --tuning auto

benchbox run --platform pandas-df --benchmark tpch --scale 0.1 \
  --platform-option dtype_backend=pyarrow

benchbox run --platform pyspark-df --benchmark tpch --scale 1 \
  --platform-option driver_memory=8g

benchbox run --platform polars --benchmark tpch --scale 0.1
benchbox run --platform polars-df --benchmark tpch --scale 0.1
```

The examples use Polars DataFrame with auto-tuning, Pandas DataFrame with the PyArrow backend, and PySpark DataFrame in local mode. The last two commands compare SQL mode (`polars`) against DataFrame mode (`polars-df`) on the same workload.

### Advanced Phase Control

```bash
benchbox run --benchmark tpch --scale 0.1 --phases generate \
  --output ./tpch-data

benchbox run --platform duckdb --benchmark tpch --scale 0.1 \
  --phases load

benchbox run --platform duckdb --benchmark tpcds --scale 0.01 \
  --phases power,throughput --seed 42
```

The commands, in order, generate data only, load data into the database, and run the full TPC-DS power and throughput test.

### Dry Run and Preview

```bash
benchbox run --platform duckdb --benchmark tpch --scale 0.1 \
  --dry-run ./preview

benchbox run --platform snowflake --benchmark tpcds \
  --phases power --dry-run ./debug --seed 7
```

The first command previews the configuration without running it. The second previews with a specific seed so the queries are reproducible.

### Benchmark-Specific Options

```bash
benchbox run --platform duckdb --benchmark nyctaxi \
  --benchmark-option taxi_types=yellow,green \
  --benchmark-option year=2022

benchbox run --platform duckdb --benchmark tpch_skew --scale 1 \
  --benchmark-option skew_preset=heavy

benchbox run --platform duckdb --benchmark tsbs_devops \
  --benchmark-option num_hosts=100 \
  --benchmark-option interval_seconds=30

benchbox run --platform duckdb --benchmark tpcdi \
  --benchmark-option enable_parallel=true \
  --benchmark-option max_workers=4

benchbox run --platform duckdb --benchmark datavault \
  --benchmark-option hash_algorithm=sha256

benchbox run --help-topic benchmarks
```

The examples, in order:

- NYC Taxi: load only yellow and green trips from 2022.
- TPC-H Skew: use the heavy skew distribution.
- TSBS Devops: set a custom host count and interval.
- TPC-DI: enable parallel ETL with 4 workers.
- Data Vault: use SHA-256 hashing.
- The last command lists all benchmark options.

### Platform-Specific Options

```bash
benchbox run --platform clickhouse-server --benchmark tpch \
  --platform-option secure=true \
  --platform-option port=9440

benchbox run --platform duckdb --benchmark tpch \
  --platform-option driver_version=1.2.0 \
  --platform-option driver_auto_install=true

benchbox run --platform athena-spark --benchmark tpch --scale 1.0 \
  --platform-option compute_resource=my-spark-workgroup \
  --platform-option s3_staging_dir=s3://my-bucket/benchbox \
  --platform-option "runtime_version=PySpark engine version 3"

benchbox platforms status clickhouse
```

The examples, in order:

- ClickHouse server over TLS on port 9440. The platform name picks the deployment (`clickhouse-local` for embedded chDB); the `mode` option is a deprecated alias.
- Pin the driver version, which works on any platform.
- Athena Spark: run in a Spark-enabled workgroup and record the engine version it is configured with.
- The last command shows platform details and capabilities.

## Table Storage Options

**Table Mode:**

- `--table-mode [native|external]`: How tables are created (default: `native`)
  - `native`: Standard materialized tables in the target database
  - `external`: External table or view references (e.g., Parquet-backed)
  - **Note:** Incompatible with `--tuning tuned` when set to `external`

**Table Format:**

- `--table-format TEXT`: Open table format for data files
  - Format: `FORMAT[:COMPRESSION[:PARTITION:COLS...]]`
  - Examples: `parquet`, `delta:snappy`, `iceberg:zstd`, `vortex`
  - Supported formats depend on the platform adapter

**Pre-sorted Data:**

- `--presort [parquet-sorted|delta-sorted|iceberg-sorted]`: Pre-sort data into open table formats
  - Only valid for TPC-H and TPC-DS benchmarks
  - TPC-H sorts on `lineitem.l_shipdate`; TPC-DS sorts on `store_sales.ss_sold_date_sk`

## Cloud Sorted Ingestion Options

These flags control cloud data-organization strategy selection across supported cloud warehouses. They are advanced options - use `--help-topic all` to see them in the CLI help.

- `--sorted-ingestion-mode [off|auto|force]`: Cloud sorted-ingestion strategy mode
- `--sorted-ingestion-method [auto|ctas|z_order|hilbert|liquid_clustering|vacuum_sort]`: Override the clustering method used during sorted ingestion

```bash
benchbox run --platform snowflake --benchmark tpch --scale 1 \
  --sorted-ingestion-mode force \
  --sorted-ingestion-method ctas
```

This runs Snowflake with forced CTAS-based sorted ingestion.

## Databricks Clustering Options

These overrides are Databricks-specific and are passed via `--platform-option`.

- `--platform-option databricks_clustering_strategy=[z_order|liquid_clustering|liquid_clustering_auto|none]`: SQL tuning strategy for Databricks tables
- `--platform-option liquid_clustering_columns=col1,col2`: Comma-separated liquid clustering columns

```bash
benchbox run --platform databricks --benchmark tpch --scale 1 \
  --platform-option databricks_clustering_strategy=z_order

benchbox run --platform databricks --benchmark tpch --scale 1 \
  --platform-option databricks_clustering_strategy=liquid_clustering \
  --platform-option liquid_clustering_columns=l_shipdate,l_orderkey

benchbox run --platform databricks --benchmark tpch --scale 1 \
  --platform-option databricks_clustering_strategy=liquid_clustering_auto
```

The commands, in order, run Databricks with Z-order clustering, with liquid clustering on specific columns, and with automatic liquid clustering.

## Billable Platforms

A platform is billable when its registry category is `cloud` or its resolved deployment mode is managed. A non-interactive `run` of a billable platform exits with code 6 unless you acknowledge that it may incur cost. The refusal happens before the platform manager, saved credentials, adapter or any connection is used.

```bash
benchbox run --platform snowflake --benchmark tpch --non-interactive

benchbox run --platform snowflake --benchmark tpch --non-interactive --acknowledge-billable-platform

BENCHBOX_ACKNOWLEDGE_BILLABLE_PLATFORM=1 benchbox run --platform snowflake --benchmark tpch --non-interactive
```

The first command exits 6 with the refusal message. The second acknowledges with the flag, and the third with the environment variable (`1`, `true`, `yes` or `on`). The result bundle records the acknowledgement and its source under `execution.billable_platform_acknowledgement` (see [Result Formats](../result-formats.md)).

- **Non-interactive** means `--non-interactive`, `BENCHBOX_NON_INTERACTIVE` set to a true value, or a standard input or output that is not a terminal. On a terminal the usual prompt applies.
- **`benchbox compare -p`** applies the same rule and takes the same flag.
- **Billable by default:** `athena`, `athena-spark`, `bigquery`, `clickhouse-cloud`, `databend`, `databricks`, `databricks-df`, `dataproc`, `dataproc-serverless`, `emr-serverless`, `fabric-lakehouse`, `fabric-spark`, `fabric_dw`, `firebolt`, `glue`, `influxdb`, `motherduck`, `quanton`, `redshift`, `snowflake`, `snowpark-connect`, `starburst`, `synapse`, `synapse-spark`. `timescaledb` (`cloud` mode) and `pg-duckdb` (`motherduck` mode) are billable only in a managed mode.
- **`run-official`** takes the same `--acknowledge-billable-platform` flag and forwards it to `run`; the environment variable works there too.

> [!WARNING]
> The acknowledgement is a statement of intent, not an access control.
>
> - Any caller that can start the command can set the flag or the variable itself.
> - `--dry-run` is exempt. It reads saved credentials but installs no package and makes no Databricks network call.
> - `databend` and `firebolt` stay billable when you run them self-hosted or in core mode, and a billable service reached through a self-hosted mode is not detected.
> - The paths in [Paths the guard does not cover](#paths-the-guard-does-not-cover) are not guarded.
> - Platform credentials saved in `~/.benchbox/credentials.yaml` are stored in plain text, readable by any process you run. The operating system keyring holds only the hosted-submission token.

### Paths the guard does not cover

| Path | Why it is not guarded |
|---|---|
| `run --dry-run` | It previews configuration. It reads `~/.benchbox/credentials.yaml`, installs no package and makes no Databricks network call. |
| `setup --validate-only`, `setup --diagnose` | Connecting is their purpose. A Snowflake check can resume a suspended warehouse. |
| Remote `start_benchmark` | Gated only by the operator allow-list; the acknowledgement is not passed through it. |
| `shell` with an `md:` MotherDuck path | You asked for that connection. |

The local MCP `run_benchmark` tool is guarded.

The MCP server applies the same rule: it allows no billable platform unless the operator started the server with `BENCHBOX_ACKNOWLEDGE_BILLABLE_PLATFORM=1`, and no tool argument can grant it. See [MCP](../mcp.md).

## Driver Auto-Install

`--platform-option driver_version=X` selects an exact driver version. The value must be a valid package version such as `1.2.3`; anything else is refused before it reaches an installer, and `run` exits 2.

When the installed driver differs from the requested version and no isolated runtime matches, BenchBox can install the requested version with `uv pip install` or `pip install`. That happens only when `driver_auto_install=true` is passed as a platform option or `BENCHBOX_DRIVER_AUTO_INSTALL=1` is set. BenchBox prints the exact `package==version` and the target interpreter to stderr before it installs.

- **Terminal session:** the platform option alone installs, after the printed notice.
- **Non-interactive session** (standard input or output is not a terminal, or `BENCHBOX_NON_INTERACTIVE` is set): the platform option alone is refused with exit 6. Set `BENCHBOX_DRIVER_AUTO_INSTALL=1` to allow the install.
- **Dry run:** a `--dry-run` never installs a package. A missing or mismatched driver is reported and the preview continues.

`benchbox run-official` follows the same rule. `benchbox platforms install` prints installation instructions only and never installs ([platforms](platforms.md#platforms-install-installation-guide)).

## Forced Reruns

| Value | Local data | Target database |
|---|---|---|
| `datagen` | Regenerated, overwriting existing files | Deleted before the run, the same as `--platform-option force_recreate=true` |
| `upload` | Untouched | Untouched; data is re-uploaded to remote storage even if a valid copy exists |
| `all` or `datagen,upload` | As `datagen` | As `datagen`, plus the re-upload |

Deleting the target database means a local database file or directory is deleted. On a remote platform the database is dropped, except Snowflake (drops this benchmark's tables and its tuning metadata and keeps the database) and Databricks (truncates every table in the schema). A platform that cannot drop a database refuses the run instead.

## Run Time Limit

`--timeout SECONDS` bounds one invocation of `benchbox run`, `benchbox run-official` or `benchbox datagen` (see [datagen](datagen.md)). It is optional: BenchBox sets no limit unless you ask for one.

```bash
benchbox run --platform duckdb --benchmark tpch --scale 10 --timeout 3600
```

**Setting the limit**

- Unset means no limit. `0` also means no limit, so the command line can switch off a value set in the config file.
- A negative or fractional value is a usage error, as is an invalid `execution.timeout_seconds` in the config file.
- The command line wins over the config file: `--timeout` overrides `execution.timeout_seconds` ([Configuration](configuration.md#execution)).
- The same setting exists as `timeout_seconds` on the MCP `run_benchmark` and `start_benchmark` tools ([MCP Server Reference](../mcp.md#run-surface-contract)), and as `timeout_seconds=` on `benchmark.generate_data()` and `adapter.run_benchmark()` in Python.

**What the clock covers**

- One clock covers the whole invocation: generation, loading and execution share it.
- The clock starts when the command starts running the benchmark. Time spent waiting for the host lock does not count.
- Container start-up, health checks, credential checks and the generator `-h` probes keep their own limits. Query plan capture keeps its own 30-second limit (`plan_capture_timeout_seconds`).
- Throughput streams no longer stop after 3600 seconds (TPC-H) or 7200 seconds (TPC-DS) unless you set a limit. See `stream_timeout_seconds` in [Configuration](configuration.md#execution).

**What happens at the limit**

- BenchBox checks the limit between phases and between queries, never inside a timed query. A query cut short by the limit is reported with status `TIMEOUT`; on GizmoSQL the limit also tells the server how long a query may run.
- The external TPC programs a run starts are ended at the limit: `dbgen` and `dsdgen` (data generation, including parallel and streaming generation), `qgen` and `dsqgen` (query generation), and the `make` builds of the TPC tools. Each is stopped together with its process group; on a platform without process groups, only the process BenchBox started is ended. The error names the limit and the tool. Generators that start no such program, such as the Python generators of the other benchmarks, are not interrupted: they finish, and the run stops at the next check or at the 30-second hard stop below. The `-h` start-up probes keep their short limits.
- If the run has not stopped 30 seconds after the limit, the hard stop starts. It cancels remote work (if that cleanup had not already started at the limit), writes the partial result, prints its path, ends every child process it started and exits. That takes a few seconds: within 5 seconds when the cleanup had started at the limit, which it does whenever the platform supports it. The 30 seconds is fixed, not a setting.
- The command exits with code 124, the value `timeout(1)` uses. A run that failed, errored or was interrupted keeps that verdict and its exit code even if it also passed the limit; the timeout is recorded beside it.

**The partial result**

- The result keeps the queries that finished and is marked `timed_out` (`summary.validation`). `execution.timeout` records `timeout_seconds`, `phase` and `query_id`, the query that was about to start when the run stopped. `query_id` is absent when the run stopped between phases, finished its work after the limit, or was ended by the hard stop. Result schema 2.6 adds `execution.timeout`.
- A timed-out result is never official, published, submitted or ranked. It loses an official compliance class, and publish and submit refuse it.
- A power test stopped at the limit is not a success and reports no Power@Size.

**Cloud platforms**

When a limit is set, BenchBox warns once for every platform in the registry category `cloud`; no warning is printed without a limit or for a local platform. Cleanup of remote work is implemented for Onehouse Quanton, Google BigQuery, Amazon EMR Serverless, AWS Glue and Google Dataproc, which print:

> A run time limit is set. If the run times out, BenchBox will try to cancel the work it started on {platform}. This cleanup has not been checked against the live service, so work may keep running and billing.

Every other cloud platform prints:

> A run time limit is set. If the run times out, work BenchBox started on {platform} may keep running and billing: BenchBox cannot cancel it on this platform.

Remote cleanup has not been checked against live services. It is verified only with stubbed clients: no cloud run was made and no credentials were used. Work may keep running and billing after a timeout.

A failed cleanup does not change exit code 124 or the `timed_out` result. Its error is printed to standard error as `Remote cleanup failed: ...` and recorded in `validation_details["timeout"]["cleanup_errors"]` of the result. The cleanup cancels only work this run started; it never stops a warehouse, application, cluster or session that existed before the run.

**Python**

`adapter.run_benchmark(benchmark, timeout_seconds=...)` raises `RunTimeoutError`, which carries the partial result as `partial_result`; it never exits the caller's process, and Python has no hard stop. `benchmark.generate_data(timeout_seconds=...)` raises `RunTimeoutError` at the limit: when a TPC generator was stopped, `partial_result` is `None`; when generation finished after the limit, it holds the generated paths. Each call has its own clock; a call made inside an already bounded run uses that run's clock.

## Execution Control Options

These flags control monitoring, progress display, memory handling, and caching behavior. They are advanced options - use `--help-topic all` to see them in the CLI help.

- `--mode [sql|dataframe]`: Force execution mode (validates against platform capabilities)
- `--no-monitoring`: Disable metrics collection during benchmark execution
- `--no-progress`: Disable progress bars
- `--ignore-memory-warnings`: Proceed with execution despite low memory warnings
- `--global-cache`: Use shared data cache at `~/.benchbox/datagen/` instead of project-local `benchmark_runs/` directory

## Query Plan Capture Options

- `--capture-plans`: Capture the logical query plan for each executed query and embed it in results.
  By default this is a static (estimated) `EXPLAIN` issued after measurement, with no re-execution of the
  query (overhead is typically a few milliseconds per query).
  Plans are persisted to the results bundle for later comparison or regression detection.
  Display is not affected — plans are captured silently.
  See [Query Plan Analysis](../../features/query-plan-analysis.md) for full details.

- `--show-plans`: Display query plans in the console after each query executes.
  Use for interactive inspection **without** `--capture-plans`. When `--capture-plans`
  is also active, display is suppressed to avoid running EXPLAIN twice; use
  `benchbox show-plan` to inspect plans already captured to the results bundle.

- `--analyze-plans` / `--no-analyze-plans`: The single capture-detail knob (used with
  `--capture-plans`). The default is the static (estimated) plan with no re-execution.
  `--analyze-plans` opts into post-measurement `EXPLAIN ANALYZE` plans with actual per-operator
  timing and cardinality where the engine supports it (DuckDB, MotherDuck, PostgreSQL, GizmoSQL),
  re-running each SELECT once in the isolated post-measurement phase (~1× extra query cost, outside
  the measured window). `--no-analyze-plans` forces the estimated plan. Write statements (DML, CTAS,
  `SELECT ... INTO`) are never re-executed regardless: they stay on a plain `EXPLAIN`.

- `--normalize-plan-literals`: In addition to the default fingerprint, record a literal-normalized fingerprint (`fingerprint_normalized` in the plans companion file) that collapses queries differing only in literal constants (e.g. parameter substitutions) to the same value. Requires `--capture-plans`; the default `fingerprint` is left unchanged.
  - Example: `--capture-plans --normalize-plan-literals`

- `--plan-config TEXT`: Fine-grained control over query plan capture
  - Format: comma-separated key:value pairs
  - Keys:
    - `queries:ID1,ID2,...` - capture plans for specific query IDs only
    - `strict:true|false` - fail if plan capture encounters errors; without it, failures are recorded as plan capture errors
  - Requires `--capture-plans` to also be set
  - Example: `--capture-plans --plan-config "queries:Q1,Q6,strict:true"`
  - **Note:** Plan capture records each distinct query exactly once in an isolated
    post-measurement phase, so the old per-iteration sampling keys (`sample:` / `first:`) have
    been removed. The default capture does not re-execute queries; `--analyze-plans` re-runs each
    captured SELECT once on DuckDB, MotherDuck, PostgreSQL and GizmoSQL.

> **Cross-run fingerprint comparison and benchmark seeds.** The default
> `plan_fingerprint` embeds filter/join/projection literals, so comparing fingerprints
> across runs that used *different* seeds yields false positives when only a
> seed-driven filter value changed. Hold the seed constant across compared runs, or
> use the opt-in **literal-normalized** fingerprint
> (`QueryPlanDAG.normalized_fingerprint`,
> `create_plan_metadata_from_results(..., normalize_literals=True)`), which masks
> literals so seed-varied plans compare equal. See
> [Query Plan Analysis → Literal normalization](../../features/query-plan-analysis.md#literal-normalization-seed-independent-fingerprints).

## Deprecated: `run-official`

`run-official {tpch|tpcds} [OPTIONS]` is a hidden, deprecated compatibility
shim kept for older scripts. Prefer `run --official` for all new usage — it
covers everything `run-official` does except concurrent-stream count (see
below).

```bash
benchbox run-official {tpch|tpcds} [OPTIONS]
```

- `--platform TEXT` (required): Platform to run on
- `--scale FLOAT` (required): TPC scale factor (must be one of the
  TPC-allowed values: 1, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000)
- `--phases TEXT` (required): Comma-separated test phases
- `--streams INTEGER`: Number of concurrent streams for the `throughput`
  phase. **Required** when `--phases` includes `throughput`; must be at least
  **2** (the TPC minimum), and `--streams 0` or `--streams 1` is rejected.
  Sets `BenchmarkConfig.concurrency` (the same field `run`'s throughput driver
  reads internally), so `run-official ... --streams 4` is equivalent to
  running with 4 concurrent throughput streams.
- `--seed INTEGER`: Random seed for reproducible official runs (a warning is
  printed if omitted)
- `--output PATH`: Output directory
- `-v`, `--verbose`: Enable verbose logging
- `--validate-results`: Enable result validation
- `--timeout SECONDS`: Stop the whole run after this many seconds (exit code 124). A timed-out run is not an official result. `0` means no limit. When omitted, `execution.timeout_seconds` from the config file applies, as for `run`; with neither set there is no limit. See [Run Time Limit](#run-time-limit)

**Note:** plain `run` (including `run --official`) accepts `--streams N` (with
`--concurrency N` as an alias), an advanced option that sets
`BenchmarkConfig.concurrency`. `run-official --streams N` is therefore
equivalent to `run --streams N` — see the `throughput` phase note above.

## Related

- [Configuration](configuration.md) - Configuration files and environment variables
- [Platform Options](configuration.md#platform-specific-options) - Platform-specific settings
- [Tuning Commands](tuning.md) - Generate and manage tuning configurations
