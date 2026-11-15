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
fact in the result and keeps the run out of every native comparison and ranking.

> [!WARNING]
> A gateway sees your Snowflake credentials, every SQL statement and every result row. Use it only with disposable
> credentials, a dedicated warehouse and benchmark data, and only with a gateway you operate or trust. BenchBox
> cannot verify what the gateway does with that traffic.

## Setup

1. Load the benchmark data natively, with no gateway option. Greybeam refuses to generate or load through the
   gateway (see the lifecycle guardrails below); treat every gateway run as query-only.
2. Confirm the gateway endpoint answers Snowflake connector logins for your account. The Snowflake `account` is still
   sent, so login succeeds through the gateway.
3. Run the same query phases twice: once natively, once with the gateway. Compare them only by reading both results,
   never with `benchbox compare` (it refuses the pair).

```bash
benchbox run --platform snowflake --benchmark tpch --scale 0.01 --phases power \
  --gateway custom \
  --platform-option gateway_host=gateway.example.com \
  --platform-option gateway_port=8443
```

Snowflake multi-cluster warehouses are an Enterprise edition feature. Check the gateway vendor's edition
requirements before the run; BenchBox does not verify them.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--gateway` | `native` | Core option: `native`, `espresso`, `greybeam` or `custom` for Snowflake. Each platform lists the gateways it accepts, and an unsupported name is rejected with the allowed values |
| `gateway_host` | (required) | Bare gateway host name or address; a value with credentials (`user:password@`), a scheme or a path is rejected |
| `gateway_port` | connector default | Gateway port (1-65535) |
| `gateway_protocol` | `https` | `https` or `http` |
| `gateway_ca_bundle` | (none) | CA bundle file for a private-CA gateway. The connector reads it from the process environment, so `REQUESTS_CA_BUNDLE` must name the same file before BenchBox starts; otherwise construction fails. BenchBox never changes the environment |
| `gateway_ocsp_fail_open` | (connector default) | Passed to the connector only when set |
| `allow_insecure_gateway` | false | Disables certificate verification (`insecure_mode`) |

Gateway options are accepted only with a gateway other than `native`. A bare `--platform-option gateway_host=...`
with the native gateway is an error, not a silent no-op.

`allow_insecure_gateway` and `http` to a non-loopback host both require `BENCHBOX_ALLOW_INSECURE_GATEWAY=1` and
log a warning. Gateway options are not available through MCP.

## Transport security

- **TLS.** `https` is the default and certificates are verified. `allow_insecure_gateway` turns verification off
  (`insecure_mode`) and is for a throwaway test gateway only.
- **Private CA.** Set `gateway_ca_bundle` to the CA file and export `REQUESTS_CA_BUNDLE` with the same path before
  BenchBox starts. The connector reads the bundle from the process environment; BenchBox never changes the
  environment and fails construction if the two disagree.
- **OCSP.** Revocation checking follows the connector default. Pass `gateway_ocsp_fail_open` only when your gateway
  cannot serve OCSP responses; BenchBox sends the value to the connector only when you set it.
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
- Gateway runs never compare with native runs, with another gateway, or with another execution engine. `benchbox
  compare` and the regression baseline select only runs of the same variant.

## Caching

BenchBox sets `USE_CACHED_RESULT = FALSE` on the Snowflake session, reads the parameter back and keeps that receipt in
`platform.compute.cache_control`. A session parameter can only describe Snowflake's own result cache. It cannot
verify a cache inside the gateway or inside an engine the gateway routes to.

Warm-run gateway numbers are not valid measurements: a second run may be answered from a gateway cache that nothing
in the result can show. Report warm gateway timings only with the label cache-unverified, and never as cold-run
results. `strict_validation` keeps its meaning for the Snowflake receipt: a failed read-back fails the run when it is
on.

## Cost and TCO

For a total cost of ownership comparison, fill in the worksheet below from your own invoices. BenchBox reads none of
these inputs and never combines them with its own cost fields.

| Input | Source |
|-------|--------|
| Snowflake credits for the run window | Snowflake billing or `WAREHOUSE_METERING_HISTORY`, for the same warehouse and window |
| Gateway subscription or usage fee | Gateway vendor invoice |
| Delegated engine compute, if the gateway runs queries outside Snowflake | Vendor-reported usage |
| Replica storage and replication cost | Vendor invoice |
| Data transfer between the gateway and your network | Cloud provider bill |
| Engineering and operating time | Your own estimate |

Any table, chart or page that shows gateway-derived cost beside native cost must carry this banner:

> [!CAUTION]
> Cost is not comparable for gateway-routed runs. Inputs are supplied by the operator and are unverified by BenchBox.

## Log join

A gateway-routed run appends a run-level suffix, `_gw-<8 hex characters>`, to the per-query tag, for example
`BenchBox_Q1_gw-3fa9c2d1`. Every query in the run shares the suffix, so a gateway vendor can join its logs to the run
by tag. The statistics lookup against `QUERY_HISTORY` uses the same tag, so execution time, compilation time, bytes
scanned and credits are still recorded. Native runs keep the unsuffixed tag.

## Semantic gaps

- A gateway may answer from an engine other than Snowflake. Greybeam declares both `snowflake` and `duckdb` as
  routing targets; `espresso` and `custom` declare `snowflake` only. BenchBox cannot see which engine answered a
  query.
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
`DATABRICKS_CONFIG_PROFILE`) are rejected while a gateway is set. The run records the same `platform.gateway` block as a
Snowflake run.

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

Quiescence runbook, to run after every native load or refresh and before the first gateway query:

1. **Row-count parity.** For every benchmark table, compare `SELECT COUNT(*)` through the native endpoint with the same
   count through the gateway. Any difference means the replica has not caught up.
2. **Lag threshold.** Repeat the parity check at a fixed interval (for example 60 seconds). Treat the replica as
   quiescent only after parity holds on three consecutive checks with no source writes in between. Replication lag
   itself comes from the vendor's own monitoring; BenchBox does not read it.
3. **Abort criteria.** Abort the run without recording results if parity is not reached within the time budget you set
   before the load (size it to the data volume), if row counts ever move backwards, or if a gateway query returns zero
   rows for a table that is non-empty natively.

Only after step 3 passes run `benchbox run --platform snowflake --gateway greybeam ... --phases power`.
