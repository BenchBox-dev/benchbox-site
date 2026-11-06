---
blogpost: true
date: November 6, 2026
author: Joe Harris
series: building-benchbox
post_number: 21
type: release-notes
tags: benchbox, release, sqlglot, execution-engines, tuning, tpch, qphh, security, results-explorer
meta_description: "BenchBox v0.5.0 bundles its own SQLGlot so every install translates SQL the same way, records the deployment and execution engine behind each run, fails on tuning a platform cannot apply, and adds TPC-H refresh functions and QphH@Size."
---
# BenchBox v0.5.0: one SQL translator, execution engines, and tuning that fails loudly

**TL;DR**: BenchBox v0.5.0 ships from its own [SQLGlot fork](https://github.com/BenchBox-dev/benchbox-sqlglot) so that all benchmark SQL is translated identically; the public `sqlglot` package is no longer installed. Runs now record the deployment, engine, and gateway used so we can check that results are comparable. Tuning a platform cannot apply now fails the run instead of being skipped. TPC-H gains refresh functions and QphH@Size on five platforms.

---

![TPC-DS Q78 ratio column on one SQLite database at scale factor 0.01. BenchBox 0.4.2 with the public sqlglot generates ROUND("ss_qty" / (...), 2) and returns 2.0, 0.0, 1.0 and 1.0 for four rows; BenchBox 0.5.0 with the bundled benchbox-sqlglot 30.29.0.1 generates ROUND(CAST("ss_qty" AS REAL) / (...), 2) and returns 2.32, 0.49, 1.67 and 1.8 for the same rows. SQLite integer division truncated the ratio and raised no error.](./images/v050_sqlite_q78_ratio.png)

BenchBox v0.5.0 was released on **November 5, 2026**.

v0.5.0 bundles `benchbox-sqlglot` 30.29.0.1, built on SQLGlot 30.29.0, inside the wheel. All SQL transpilation is now consolidated into our own SQLGlot version.

Platform names are now more consistent across `benchbox` surfaces: `--platform firebolt:cloud` works in the CLI, MCP and Python. A new `--execution-engine` option chooses how Polars, Dask and pg-duckdb execute a query.

Tuning options are now validated and enforced. Previously a tuning file that configured an impossible setting was silently skipped. Such configs now fail loudly so that users can correct them.

## At a glance

| Area | What changed in v0.5.0 | Why it matters |
| --- | --- | --- |
| SQL translation | Bundled SQLGlot 30.29.0.1; public `sqlglot` no longer installed | Same translated SQL in every install; results record the translator version |
| Deployment selectors | `--platform name:mode` on more platforms, in MCP and Python | Each deployment ranks separately |
| Execution engines | `--execution-engine` for Polars, Dask and pg-duckdb | Results record the requested and observed engine |
| TPC-H refresh and QphH | RF1 and RF2 in Power and Throughput; `benchbox metrics qphh` | QphH@Size on DuckDB, SQLite, PostgreSQL, Snowflake and SingleStore |
| Tuning | Unapplicable tuning fails; `benchbox tuning validate`; ignored tuning listed in results | A tuned result means the tuning applied |
| Security | `certifi` 2026.10.19 and `grpcio` 1.84.1 floors; private submission salt | Older releases trust the compromised emSign CAs |
| Wrong answers fixed | TPC-DI, ClickHouse, DataFusion, Doris, StarRocks and QuestDB queries | Rerun those baselines before comparing |
| Published rankings | 25 results removed, 58 added for ClickHouse Local, DataFusion and SQLite | Explorer rows reflect the new translator |

## One translator per install

BenchBox runs the same benchmarks on many platforms to provide comparisons, so SQL translation to each platform's dialect decides whether the numbers mean anything. `sqlglot` did not cover every platform BenchBox runs, and several translations ran without error and returned different values. The image above is one: TPC-DS Q78 divides two integer sums, SQLite truncates an integer quotient, and v0.4.2 reported `2.0` where the ratio is `2.32`. BenchBox had grown a layer of post-translation fix-ups to patch both problems. Those now live in the fork.

The translator is now part of the release. BenchBox no longer installs the public `sqlglot` package. `benchbox-sqlglot` 30.29.0.1 ships inside the `benchbox` wheel with its license.

Startup is faster as a side effect. Importing BenchBox no longer loads SQLGlot until something translates SQL, and `benchbox run` loads only the requested platform's adapter.

With the bundled translator, many queries on SQLite, ClickHouse, Spark, Databricks, QuestDB, DataFusion, PostgreSQL, Trino, Presto, Athena and SingleStore get different SQL, as do some Read Primitives on DuckDB, BigQuery and StarRocks. `STDDEV` and `VARIANCE` now use the sample form on MySQL, Doris, StarRocks and SingleStore. Every result records the SQLGlot version that translated its SQL, so a later reader can tell which translator produced a number.

v0.5.0 removes 25 results built on superseded SQL translations or wrong values from the [Results Explorer](https://benchbox.dev/results/) rankings and adds 58 replacements for ClickHouse Local, DataFusion and SQLite.

## Recording how a query ran

v0.5.0 records which deployment, engine and gateway a run used, and refuses comparisons across them.

**Deployment selectors.** `--platform name:mode` now covers platforms such as `firebolt:cloud` and `pg-duckdb:motherduck`, works in MCP and Python, and shares the `compute_resource` and `compute_size` options in place of vendor names such as `warehouse`. Each deployment ranks separately in the Explorer.

**Execution engines.** `--execution-engine` chooses how a query runs: Polars `in-memory` or `streaming`, Dask `threaded` or `distributed`, and pg-duckdb `duckdb` or `postgres`. The result records the requested engine and the observed one. The old `--polars-streaming` flag is a deprecated alias.

**Gateways and containers.** Snowflake (`--gateway`) and Databricks (the `gateway` setting) can route connections through a gateway. Such results are never official. Server engines running in Docker on macOS or Windows are recorded and ranked as container runs.

**More evidence per run.** Results record the engine version on DuckDB, SQLite and DataFusion, and the live Spark, LakeSail and Velox session settings.

**Comparisons that respect it.** `benchbox compare` refuses results with different deployments, execution engines or gateways unless you pass `--allow-heterogeneous-comparison`, and warns when data generation or power-stream policy differs.

GizmoSQL joins as an experimental platform: TPC-H and TPC-DS on a GizmoSQL Core 1.37 or newer server with the `gizmosql` extra.

## TPC-H refresh functions and QphH@Size

`--benchmark-option tpch_refresh_functions=true` adds the RF1 and RF2 refresh functions to the Power and Throughput phases, and `benchbox metrics qphh` computes QphH@Size from a power result and a throughput result. Refresh runs on DuckDB, SQLite, PostgreSQL, Snowflake and SingleStore; other platforms skip maintenance, so QphH@Size is available on those five.

Throughput bookkeeping changed with it. Streams are numbered 1 to S and TPC-H power iterations all use stream 00. Throughput honors `--queries` and `validation_mode`, and a query subset reports no Throughput@Size. TPC-H and TPC-DS runs below scale factor 1 rank in their own unofficial cohort. If you published Throughput@Size from an earlier release, rerun it on v0.5.0.

## Tuning no longer fails silently

`benchbox` tuning files can specify partitioning, clustering or an index that the target platform does not support. Earlier releases skipped the setting and still recorded the run as tuned. v0.5.0 fails the run, names the tuning type and gives the reason. Unknown keys in a tuning YAML fail too. Check saved files before upgrading:

```bash
uv run -- benchbox tuning validate my_tuning.yaml --platform duckdb
```

Results now list the tuning a platform ignored, and `--dry-run --tuning tuned` works without the platform driver installed, so you can see the generated DDL before buying compute.

Tuning reaches more of the PostgreSQL family: PostgreSQL partitions, indexes and clusters tuned tables; CedarDB partitions; Citus distributes; ParadeDB and pg_mooncake cluster and sort. Tuned runs on PostgreSQL, Athena, Synapse, Fabric Warehouse and BigQuery that used to abort now run, and ClickHouse primary keys, Spark session settings, Databricks `z_order` and PostgreSQL-family `CLUSTER` apply as requested. A new [platform tuning reference](https://benchbox.dev/docs/reference/tuning-platform-support.html) lists each platform's shipped templates and the tuning types it applies.

## Security

The eMudhra emSign certificate authorities were compromised. BenchBox v0.5.0 requires `certifi` 2026.10.19 or newer, and its BigQuery, cloud, cloud Spark, LakeSail and Velox extras require `grpcio` 1.84.1 or newer. Older releases trust those CAs, so a network attacker could impersonate cloud endpoints and steal tokens. The [Python advisory](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576) has the details. Databricks SQL, result submission and data downloads now verify TLS against `certifi` rather than the system store; behind a corporate CA, set `REQUESTS_CA_BUNDLE` or `SSL_CERT_FILE`.

Two smaller fixes close gaps in anonymization. `submit`, `export` and `publish` create a private salt in `~/.benchbox/submission_salt` on first use, so anonymized exports no longer hash with an empty salt, and anonymized bundles drop the compute resource name. Dry-run preview files no longer include saved credentials.

## Fixes that change answers

Several queries returned plausible, wrong rows and now return correct ones: TPC-DI EQ3, EQ6 and EQ8; ClickHouse TPC-DI AQ6, CoffeeShop TM1, Read Primitives `map_access` and six TPC-Havoc variants; DataFusion TPC-DI EQ7; Doris and StarRocks TPC-DS queries such as 46 and 68; and QuestDB filters on nullable columns. TPC-DS OBT 0.2 uses a wider table, runs 90 of the 99 TPC-DS queries and returns the TPC-DS answers. The SQLite loader now reads quoted fields and loads empty nullable fields as NULL, which changes SQLite TPC-DS and ClickBench.

Some baselines change because loads got faster. PostgreSQL-family loads run `ANALYZE` on every table, and SQLite indexes TPC-Havoc and Data Vault join keys, so queries that took minutes now finish far faster. JoinOrder at scale factor 1 peaks near 5 GiB instead of 9 GiB on Polars, and near 3 GiB instead of over 7 GiB on DataFusion.

Two guards protect the host. On a validation mismatch, BenchBox stops instead of dropping a server database that holds tables from outside the benchmark, and on Snowflake it drops only the benchmark's tables. Runs fail when the output volume has less than 5% free; `BENCHBOX_MIN_FREE_DISK_PERCENT` changes the limit.

## Changed behavior to be aware of

| Previous use | v0.5.0 action |
| --- | --- |
| `deployment_mode`, `warehouse` and similar option spellings | Use `--platform name:mode`, `compute_resource` and `compute_size`; passing two spellings stops the run; the old ones warn and stop working in 0.6.0 |
| `--polars-streaming` | Use `--execution-engine streaming` |
| `translate_sql_query(pre_processors=, post_processors=)` | Pass named `rewrites` |
| `run_throughput_test`, `run_official_benchmark` | Pass `adapter=` and at least 2 streams |
| `benchbox.mcp.create_server(log_level=...)` | `create_server()` no longer sets up logging or tracing; `run_server()` does |
| ParadeDB | Requires `pg_search`; use the `paradedb/paradedb:0.26.2-pg18` image |
| `--platform singlestore:cloud` | Use `--platform singlestore` for Helios and self-managed clusters |
| `databend:self-hosted` | Connects over HTTP on port 8000 by default |
| Saved profiles with DuckDB `threads`, `temp_directory`, SQLite `database_path`, `timeout` | These now apply, and `--platform-option` values equal to the default override the profile; remove any you do not want |
| Dask `use_distributed=false` with `scheduler_address` | Fails; use `--execution-engine distributed` |
| DuckDB `auto` and nested tuning databases | Rebuilt once; drop the old ones |
| ClickHouse Server loads into `default` | Now `benchbox_<benchmark>_<scale>`; set `--platform-option database=<name>` to choose |
| Saved `stream_timeout_seconds` | Now applies to Throughput; remove it to keep the default |
| Local Spark driver heap | 60% of RAM unless you pass `--driver-memory` |
| Tools that read result files | Results use schema 2.3 |
| Source checkouts | uv 0.13.4 or newer; rebuild local Velox and LakeSail Docker images |

## Try it yourself

After upgrading to v0.5.0:

1. Confirm the installed version:

```bash
benchbox --version
```

2. Validate a saved tuning file against its platform:

```bash
uv run -- benchbox tuning validate my_tuning.yaml --platform duckdb
```

3. Run TPC-H with refresh functions and compute QphH@Size:

```bash
uv add "benchbox[duckdb]"
uv run -- benchbox run --platform duckdb --benchmark tpch --scale 0.01 \
  --phases power,throughput \
  --benchmark-option tpch_refresh_functions=true --non-interactive
uv run -- benchbox metrics qphh --power-results <power.json> \
  --throughput-results <throughput.json> --scale-factor 0.01
```

4. Choose an execution engine on Polars:

```bash
uv run -- benchbox run --platform polars-df --benchmark tpch --scale 0.01 \
  --execution-engine streaming
```

5. Browse the refreshed rankings at [benchbox.dev/results/](https://benchbox.dev/results/).

v0.5.0 was a maintainer-driven cycle. If a result, number or migration note needs correction, [start a discussion](https://github.com/BenchBox-dev/BenchBox/discussions).

---

## References

- Changelog entry: `CHANGELOG.md` (`[0.5.0] - 2026-11-04`)
- Release tag: [v0.5.0](https://github.com/BenchBox-dev/BenchBox/releases/tag/v0.5.0)
- Python advisory on the emSign CA incident: [discuss.python.org](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576)
- Platform tuning reference: `docs/reference/tuning-platform-support.md`
- `tuning` command reference: `docs/reference/cli/tuning.md`
- Results Explorer: [benchbox.dev/results/](https://benchbox.dev/results/)
- Q78 evidence behind the image: `drafts/building-benchbox/research/v050-sqlite-q78-ratio-2026-11-06.md`
