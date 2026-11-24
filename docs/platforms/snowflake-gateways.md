---
tags: [advanced, guide, snowflake, cloud-platform]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Snowflake Gateways

A gateway is an endpoint that sits between BenchBox and Snowflake and answers Snowflake connector traffic on the
warehouse's behalf. `--gateway espresso|greybeam|custom` routes a [Snowflake](snowflake.md) run through one. Databricks
accepts the same `gateway` setting with the `espresso` and `custom` values and the restrictions listed under
[Databricks](#databricks).

A gateway-routed run measures the gateway and whatever it routes to, not Snowflake alone. BenchBox records that
fact in the result and keeps the run out of native rankings, cost totals and native regression baselines.
`benchbox compare` and the MCP `compare_results` tool refuse to pair it with a native run; `benchbox compare` accepts
`--allow-heterogeneous-comparison` to override.

> [!WARNING]
> A gateway sees your Snowflake credentials, every SQL statement and every result row. Use it only with disposable
> credentials, a dedicated warehouse and benchmark data, and only with a gateway you operate or trust. BenchBox
> cannot verify what the gateway does with that traffic.

## Setup

1. Load the benchmark data natively, with no gateway option. Greybeam refuses to generate or load through the
   gateway (see the lifecycle guardrails below); treat every gateway run as query-only.
2. Confirm the gateway endpoint answers Snowflake connector logins for your account. The Snowflake `account` is still
   sent, so login succeeds through the gateway.
3. Run the same query phases twice: once natively, once with the gateway. `benchbox compare` refuses the pair unless
   you pass `--allow-heterogeneous-comparison`. With the flag, the comparison measures the gateway and whatever it
   routes to against native Snowflake.

```bash
benchbox run --platform snowflake --benchmark tpch --scale 0.01 --phases power \
  --gateway custom \
  --platform-option gateway_host=gateway.example.com \
  --platform-option gateway_port=8443
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--gateway` | `native` | Core option: `native`, `espresso`, `greybeam` or `custom` for Snowflake. Each platform lists the gateways it accepts, and an unsupported name is rejected with the allowed values |
| `gateway_host` | (required) | Bare gateway host name or address; a value with credentials (`user:password@`), a scheme or a path is rejected |
| `gateway_port` | connector default | Gateway port (1-65535) |
| `gateway_protocol` | `https` | `https` or `http` |
| `gateway_ca_bundle` | (none) | CA bundle file for a private-CA gateway. On connector 5.x BenchBox passes it as `extra_root_store_path`. On connector 4.x and earlier the connector reads it from the process environment, so `REQUESTS_CA_BUNDLE` must name the same file before BenchBox starts; otherwise construction fails. BenchBox never changes the environment |
| `gateway_ocsp_fail_open` | (connector default) | Revocation check mode, `true` or `false`. Passed to the connector only when set; see Revocation checking below |
| `allow_insecure_gateway` | false | Turns off certificate revocation checking only. Certificate and host name verification still apply, so a self-signed or untrusted gateway still fails |

Gateway options are accepted only with a gateway other than `native`. A bare `--platform-option gateway_host=...`
with the native gateway is an error, not a silent no-op.

`allow_insecure_gateway` and `http` to a non-loopback host both require `BENCHBOX_ALLOW_INSECURE_GATEWAY=1` and
log a warning. Gateway options are not available through MCP.

## Transport security

- **TLS.** `https` is the default and certificates are verified. `allow_insecure_gateway` turns off only certificate
  revocation checking. It does not turn off certificate or host name verification, so a self-signed or untrusted
  gateway certificate still fails the connection. It requires `BENCHBOX_ALLOW_INSECURE_GATEWAY=1`.
- **Private CA.** On snowflake-connector-python 5.x, set `gateway_ca_bundle` to the CA file; BenchBox passes it to the
  connector as `extra_root_store_path` and `REQUESTS_CA_BUNDLE` is not needed. On 4.x and earlier, set
  `gateway_ca_bundle` and also export `REQUESTS_CA_BUNDLE` with the same path before BenchBox starts. The connector
  reads the bundle from the process environment there; BenchBox never changes the environment and fails construction
  if the two disagree.
- **Revocation checking.** What BenchBox passes depends on the installed snowflake-connector-python.
  - **5.x.** The connector checks revocation with certificate revocation lists (`crl_check_mode`), and its default is
    `DISABLED`. `allow_insecure_gateway` sets `DISABLED`. Otherwise `gateway_ocsp_fail_open=true` sets `ADVISORY` and
    `false` sets `ENABLED`. When neither option is set, BenchBox passes nothing and the connector default applies.
    `allow_insecure_gateway` wins when both options are set.
  - **4.x and earlier.** `gateway_ocsp_fail_open` is passed as `ocsp_fail_open`, only when you set it.
    `allow_insecure_gateway` is passed as `disable_ocsp_checks` where the installed connector supports that
    parameter, and as `insecure_mode` otherwise; either turns OCSP off even when `gateway_ocsp_fail_open` is set.
    Without these options, up to 4.7 OCSP checking is on and fails open, and `gateway_ocsp_fail_open=false` makes it
    fail closed. In 4.8, checking is off unless `ocsp_fail_open` is set; either value turns it on, `true` failing open
    and `false` failing closed.
- **Plain HTTP.** `http` to a loopback host needs no opt-in because the traffic never leaves the machine. Any other
  `http` endpoint needs the environment opt-in above.
- **Credentials.** A host with embedded credentials (`user:password@`), a scheme or a path is rejected without being
  echoed. Result files record the gateway's protocol and port, and the host only when it is a loopback address.

## Authentication

Prefer key pair authentication for the user a gateway run logs in with. Snowflake is retiring single-factor password
sign-in, and a key pair keeps the password out of the traffic the gateway sees. See
[Key Pair Authentication](snowflake.md#key-pair-authentication); `private_key_path` is a Python API argument.

The Databricks gateway accepts personal access tokens only.

## PrivateLink

When the gateway is reachable only over a private endpoint, set `gateway_host` to the private DNS name of that
endpoint. BenchBox does not interpret the name, so the same transport rules apply: `https` with certificate
verification, plus `gateway_ca_bundle` when the private endpoint presents a certificate from a private CA.

## What a gateway run records

- `platform.gateway` is `{name, routed: true}`, and the platform variant carries the gateway name. A native run has
  neither.
- `tpc_compliant` is always `false`. `benchmark.compliance_class` is always `unofficial_nonstandard`, whatever the
  benchmark reports, so TPC metrics are suppressed and publish, submit, bundle validation, the results database and
  metrics readiness all refuse the run as non-official. A stored result that claims `official` while
  `platform.gateway.routed` is true is treated the same way.
- `benchbox compare` refuses to pair a gateway run with a native run, another gateway or another execution engine
  unless you pass `--allow-heterogeneous-comparison`. The regression baseline selects only runs of the same variant.
- Every `queries[].execution_engine` is `unknown` unless the platform manifest names the engine the gateway reported,
  so DuckDB, Snowflake and unknown buckets stay separate and are never blended.
- A metadata probe that the gateway answers with an empty, truncated or synthetic row does not fail the run. The
  result records `metadata_degraded: true` and the missing fields stay empty.

## Caching

BenchBox sets `USE_CACHED_RESULT = FALSE` on the session, reads the parameter back with `SHOW PARAMETERS` and keeps
that receipt in `platform.compute.cache_control`. On a gateway run both statements pass through the gateway, so the
receipt records what the gateway answered. It cannot show whether the setting held in the Snowflake session that ran
each query. It also cannot show a cache inside the gateway or in an engine the gateway routes to, or the warehouse's
local data cache, which no session parameter controls. A gateway run therefore also records:

```json
{
  "snowflake_result_cache": "disabled",
  "gateway_cache": "unverified",
  "warm_run_metrics": "cache_unverified"
}
```

`snowflake_result_cache` is `disabled` when the read-back confirmed the result cache is off. It is `enabled` when you
left the result cache on, in which case nothing is read back. It is `unvalidated` when the read-back returned no row,
or, with `strict_validation` off, returned the wrong value or failed. With `strict_validation` on (the default), a
read-back that returns the wrong value or errors fails the run; a read-back that returns no row only adds a warning.

`warm_run_metrics` covers every timing in the run. A power run executes one warm-up pass, then repeats the same
queries with the same parameters (see [Benchmark methodology](../concepts/benchmark-methodology.md#iterations-and-warm-up)),
so a gateway cache could have answered any measured iteration without the result showing it. If you publish gateway
timings, label them cache-unverified.

## Cost and TCO

BenchBox does not publish a cost total for a gateway run. `normalized_cost.cost_status` is
`not_comparable_gateway`, `normalized_cost_usd` is null, per-query costs are empty and the result has no cost total,
because the credits a gateway run consumes depend on how the gateway routes each query.

BenchBox reads no invoices and never combines outside costs with its own cost fields. A total cost comparison has to
come from your own bills, and each source has limits:

- **Snowflake credits.** `WAREHOUSE_METERING_HISTORY` is hourly, can lag up to three hours (six for cloud services
  credits), and reports credits before the cloud services adjustment. Billed credits are in
  `METERING_DAILY_HISTORY`, which is daily and account-wide, so it cannot isolate a run. To isolate a gateway run by
  warehouse, give it a warehouse that nothing else uses during those hours, including the native run; a gateway can
  also send queries to other warehouses. `QUERY_ATTRIBUTION_HISTORY` attributes compute credits per query and records
  `QUERY_ID` and `QUERY_TAG`. Join it on the statement ids the result records in
  `queries[].platform_timing.requests[].id`, which survive a gateway that rewrites the tag, or select the run's `_gw-`
  tag suffix. It lags up to eight hours, leaves out queries of about 100 ms or less and most idle time (only gaps
  between queries within the same minute are attributed), and excludes cloud services and data transfer costs.
- **Costs outside Snowflake.** The gateway fee, compute for queries another engine answered, replica storage
  (possibly in a bucket you own) and network transfer come from the vendor's invoice and your cloud provider's bill.

If you show these figures beside a native BenchBox cost, state that BenchBox did not measure them.

## Log join

A gateway-routed run appends a run-level suffix, `_gw-<8 hex characters>`, to the per-query tag, for example
`BenchBox_Q1_gw-3fa9c2d1`. Every query in the run shares the suffix, so a gateway vendor can join its logs to the run
by tag. The statistics lookup against `QUERY_HISTORY` uses the statement id the connector returns, not the tag, so a
gateway that rewrites or drops the tag does not break timing or statistics capture. Native runs keep the unsuffixed tag.

## Semantic gaps

- A gateway may answer from an engine other than Snowflake. Greybeam declares both `snowflake` and `duckdb` as
  routing targets; `espresso` and `custom` declare `snowflake` only. BenchBox cannot see which engine answered a
  query, which is why the per-query engine is `unknown`.
- A delegated engine can differ from Snowflake in function behavior, type coercion, NULL ordering, rounding and
  timestamp handling. A row-count validation failure on a gateway run may be a semantic difference rather than a wrong
  result.
- Query history, credits and bytes-scanned statistics describe only the work Snowflake performed. Queries answered
  elsewhere may report no Snowflake statistics.

## No-rewrite stance

BenchBox sends the same SQL through a gateway that it sends natively. It does not rewrite queries to suit a gateway,
add hints, or retry a failed query natively. A query the gateway cannot answer is a failed query in the result.

## Databricks

The Databricks adapter accepts `gateway` with `native`, `espresso` or `custom` as a `DatabricksAdapter` argument; see
the [Databricks platform page](databricks.md). A gateway run needs an explicit `server_hostname` that names the gateway
and an `access_token`; BenchBox does not fall back to the auto-detected workspace, which would bypass the gateway. A
personal access token is required, and OAuth environment variables (`DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`,
`DATABRICKS_CONFIG_PROFILE`) are rejected while a gateway is set. The run records the same `platform.gateway` block,
`unknown` per-query engines, the unverified gateway cache and `not_comparable_gateway` cost as a Snowflake run.

## Greybeam lifecycle guardrails

Greybeam queries an Iceberg replica that CDC keeps in sync with the native Snowflake tables. Loading or refreshing
through the gateway therefore leaves the replica empty or stale, and queries against it return wrong answers.
BenchBox enforces these runtime restrictions:

- **Generate and load phases** raise `ConfigurationError`. Pass explicit query phases (for example
  `--phases power,throughput`) after loading natively. Query-only runs also refuse automatic database recreation or
  loading when the database is missing, empty, or incompatible. `--force-recreate` fails before database management.
  The SQL adapter checks before database reset/drop, fresh setup, schema creation, and data loading, so a missing or
  stale replica cannot trigger writes as a side effect of a query-only run. Fix the native dataset and wait for CDC
  quiescence rather than recreating it through the gateway.
  Read-only validation connections and dry-run database checks do not decide whether the database needs recreation;
  they remain available without the inline-load override. Mutation entrypoints still enforce the guard independently.
  The escape hatch needs both `--allow-greybeam-inline-load` and `BENCHBOX_I_UNDERSTAND_GREYBEAM_LOAD=1`; it also covers
  automatic reload/recreation, and results from such a run are invalid data.
- **TPC-H RF1/RF2 and TPC-DS maintenance streams** fail fast when `maintenance` is named in `--phases` or the
  maintenance test type is selected. When the maintenance phase is only implied (a combined run without `--phases`), it
  is skipped with a loud warning and a `maintenance_skipped: true` row with status `SKIPPED` in the query results.
  The escape hatch does not cover maintenance.
  TPC-H refresh functions enabled inside the power or throughput phase (`tpch_refresh_functions`) also fail closed
  before any refresh set is generated or applied; the phase reports a `FAILED` row naming the greybeam gateway.

To wait for CDC quiescence, confirm from the vendor's replication status that the replica has caught up before the
first gateway query after a native load or refresh. BenchBox does not read replication lag. Comparing row counts
through the native endpoint and through the gateway is a useful smoke test but not proof: a gateway may answer a
`COUNT(*)` from Snowflake rather than the replica, and a TPC-H RF1/RF2 pair leaves the `ORDERS` row count unchanged
even when the replica applied neither refresh. Discard any run in which a gateway query returns zero rows for a table
that is non-empty natively.

Then run `benchbox run --platform snowflake --gateway greybeam ... --phases power`.
