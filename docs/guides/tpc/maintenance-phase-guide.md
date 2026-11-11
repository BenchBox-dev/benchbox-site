---
tags: [advanced, guide, tpc-h, tpc-ds]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# TPC Maintenance Phase: Complete Guide

> Standalone Maintenance tests permanently modify the database. TPC-H Power and Throughput also write
> when `tpch_refresh_functions=true`. Reload the original data before reusing update sets; otherwise,
> use `tpch_refresh_first_set` to continue at the next unused set.

## Overview

The TPC maintenance phases test data warehouse refresh operations. Standalone Maintenance tests write, update, and delete data. TPC-H Power and Throughput remain read-only by default but can apply RF1/RF2 when refresh integration is enabled.
These operations support common warehouse workflows:

- New transactions arrive continuously from source systems
- Historical data requires periodic updates
- Old data is archived or purged
- Data corrections are applied

### Key Characteristics

| Aspect | Power/Throughput Tests | Standalone Maintenance Test |
|--------|------------------------|------------------------------|
| **Data Modification** | None by default; optional TPC-H RF1/RF2 | Permanent (INSERT/DELETE) |
| **Database State** | Unchanged by default; modified with TPC-H refresh | **Modified after test** |
| **Repeatability** | Reuse clean data or advance update-set number | **Reload or use unused update sets** |
| **Purpose** | Query performance; optionally concurrent refresh | Data modification performance |
| **TPC specification coverage** | Depends on configuration and evidence | Required for QphH@Size |

## When to Use Maintenance Tests

### Use Maintenance Tests When You Need To

- ✅ **Test data warehouse ETL performance** - Measure how the database handles data refresh operations
- ✅ **Evaluate write performance under analytical workloads** - Understand the cost of data modifications
- ✅ **Simulate mixed read/write workloads** - TPC-H Throughput can run its opt-in refresh stream concurrently with query streams
- ✅ **Benchmark data maintenance windows** - Measure how long it takes to process data refreshes

### Skip Maintenance Tests When

- ❌ **Only measuring query performance** - Power and Throughput tests are sufficient for read-only benchmarks
- ❌ **Running quick exploratory tests** - Maintenance tests require database reload, adding operational overhead
- ❌ **Comparing read-only OLAP systems** - Some analytical databases are immutable and don't support data modifications
- ❌ **Working in production environments** - Never run Maintenance tests against production data (they permanently modify it!)

## TPC-H Refresh Functions

TPC-H uses DBGen update sets. `tpch_refresh_functions` defaults to `false`; set it to `true` to include RF1/RF2 in Power and the refresh stream in Throughput. `tpch_refresh_first_set` defaults to 1 and selects the first DBGen update set.

DBGen creates update files before measurement. Power uses RF1(set F), runs the 22 queries, then applies RF2(set F); only the final measurement iteration modifies data. Throughput starts a separate refresh stream and runs S serial RF1/RF2 pairs on sets F+1 through F+S alongside the S query streams. Refresh time contributes to the throughput interval; the refresh safety checks run before the interval starts and after it ends.

The standalone TPC-H maintenance phase runs only on adapters that declare refresh support (DuckDB, SQLite, PostgreSQL and the adapters built on it, Snowflake, and SingleStore). On other adapters it completes with one skipped `maintenance_not_supported` row and issues no refresh SQL.

RF1 inserts the DBGen order and lineitem rows in 1,000-row chunks and rejects order-key collisions. RF2 verifies that all selected orders exist, then deletes their lineitems before the orders. Each function uses a transaction. The standalone Maintenance phase uses the same generator and executor. These operations permanently modify the database.

After a combined run using Power set F and Throughput sets F+1..F+S, the next unused set is F+S+1. Reload the original data to repeat the run from set 1. This feature is verified in memory on DuckDB and SQLite; support is declared by the adapter.

```python
from benchbox import TPCH
from benchbox.platforms.duckdb import DuckDBAdapter

benchmark = TPCH(
    scale_factor=1.0,
    tpch_refresh_functions=True,
    tpch_refresh_first_set=1,
)
benchmark.generate_data()
adapter = DuckDBAdapter(database_path="tpch.duckdb", force_recreate=True)

power_result = adapter.run_benchmark(benchmark, test_execution_type="power")
throughput_result = adapter.run_benchmark(benchmark, test_execution_type="throughput")
```

This example writes to the database in both phases. Use the next unused update set or reload the data before another run.

### TPC-H Refresh Integrity

RF1 uses DBGen's generated update rows and rejects any order key already present before inserting. RF2 reads the DBGen delete keys and verifies that every order exists before deleting LINEITEM children and then ORDERS parents. The function transaction rolls back if a validation or DML operation fails.

## TPC-DS Maintenance Test

### Overview

TPC-DS data maintenance follows TPC-DS 4.0.0 clauses 5.2.3 to 5.3. BenchBox generates the refresh data with the kit's `dsdgen -update`, loads it into staging tables, and applies it with the 11 maintenance functions as set-based SQL. Each function reads staging tables and runs one or a few `INSERT ... SELECT` or `DELETE` statements against the warehouse tables. No rows are generated in Python.

### What the Test Does

1. **Generate the refresh sets.** Before any timer starts, `dsdgen -update` writes one refresh set per refresh run into a temporary directory. `first_refresh_set` (default 1) selects the first set and `refresh_runs` (default 1) the number of consecutive sets.
2. **Check the primary keys.** Maintenance refuses to start when a maintenance target table enforces a primary key (see [Enforced Primary Keys](#enforced-primary-keys)).
3. **Run the functions for each set.** For every function, inside that function's timed interval, BenchBox creates the staging tables, loads the function's refresh files through the platform's generic loader, begins a transaction, runs the function's statements and commits. Staging tables are dropped after the interval.
4. **Check the result.** A function fails on any rejected or missing staging row, and loading refresh data never truncates a warehouse table. After the last function, BenchBox runs the data-integrity checks when `validate_integrity` is on. They are outside the timed intervals.

Dsdgen generation, the connection open and close, the row-count reads before and after each function, and the staging cleanup are outside each function's interval. The test's `total_time` runs from the earliest function start to the latest function end across all refresh runs, so it also covers the gaps between intervals.

### The 11 Functions

| Function | Kind | Target tables | Staging tables |
|----------|------|---------------|----------------|
| `LF_CR` | Insert | `catalog_returns` | `s_catalog_returns` |
| `LF_CS` | Insert | `catalog_sales` | `s_catalog_order`, `s_catalog_order_lineitem` |
| `LF_I` | Insert | `inventory` | `s_inventory` |
| `LF_SR` | Insert | `store_returns` | `s_store_returns` |
| `LF_SS` | Insert | `store_sales` | `s_purchase`, `s_purchase_lineitem` |
| `LF_WR` | Insert | `web_returns` | `s_web_returns` |
| `LF_WS` | Insert | `web_sales` | `s_web_order`, `s_web_order_lineitem` |
| `DF_CS` | Delete | `catalog_returns`, `catalog_sales` | `s_delete` |
| `DF_SS` | Delete | `store_returns`, `store_sales` | `s_delete` |
| `DF_WS` | Delete | `web_returns`, `web_sales` | `s_delete` |
| `DF_I` | Delete | `inventory` | `s_inventory_delete` |

The delete functions remove sales whose sold date falls in the date ranges of the refresh set, and the returns that belong to them. Returns match sales on order or ticket number plus item, so returns of out-of-range orders that share a number survive.

### Result Fields

Each result records `run.maintenance_method` as `dsdgen_refresh_sets`. Each function also records its refresh set, the staged row counts and the rows inserted or deleted per table.

Maintenance timings from earlier BenchBox versions used a different method and are not comparable. `benchbox compare` and the analytics and platform comparison APIs refuse to compare results recorded with different maintenance methods.

### Platform Support

| Platform | Behaviour |
|----------|-----------|
| DuckDB, PostgreSQL, SQLite | Runs when no maintenance target table enforces a primary key; otherwise refuses |
| Snowflake | Runs; primary keys are informational constraints that Snowflake does not enforce |
| SingleStore | Reports the phase as skipped, because the refresh statements are not validated against its SQL |
| Other platforms | Report the phase as skipped |

### Enforced Primary Keys

The kit's refresh keys start at 1 in every refresh set (`getUpdateBase` reads the row count of the wrong table), so the order and ticket numbers in a refresh set overlap the base data's keys. BenchBox keeps the kit's keys unchanged. An enforced primary key rejects those inserts as duplicates.

> [!IMPORTANT]
> TPC-DS maintenance refuses to run when a maintenance target table carries an enforced primary key. The error names those tables.

Load the data without enforced primary keys and run the maintenance test again:

```bash
benchbox run \
  --platform duckdb \
  --benchmark tpcds \
  --scale 1.0 \
  --tuning notuning \
  --phases generate,load,maintenance
```

`--tuning notuning` loads the tables without primary keys. You can also disable primary keys in the tuning configuration.

### TPC-DS Code Example

```python
from benchbox.tpcds import TPCDS
from benchbox.platforms.duckdb import DuckDBAdapter
from pathlib import Path

benchmark = TPCDS(scale_factor=1.0, output_dir=Path("./tpcds_data"))
benchmark.generate_data()

adapter = DuckDBAdapter(database_path="tpcds.duckdb", force_recreate=True)

power_result = adapter.run_benchmark(benchmark, test_execution_type="power")
throughput_result = adapter.run_benchmark(benchmark, test_execution_type="throughput")
maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")
```

The maintenance run refuses when the target tables carry enforced primary keys, and it modifies the database when it runs. Load without primary keys, and reload the data before running Power or Throughput again or before repeating maintenance on the same refresh sets.

### TPC-H Refresh Performance

**Batched Multi-Row INSERTs:**

TPC-H RF1 uses batched multi-row INSERT statements for ~100x performance improvement:

```sql
INSERT INTO LINEITEM (...) VALUES (?, ?, ?, ...)
INSERT INTO LINEITEM (...) VALUES (?, ?, ?, ...)
... (998 more times)

INSERT INTO LINEITEM (...) VALUES
  (?, ?, ?, ...),
  (?, ?, ?, ...),
  ...
  (?, ?, ?, ...)
```

**Batched DELETE Operations:**

RF2 deletes use batched IN clauses instead of individual DELETE statements:

```sql
DELETE FROM LINEITEM WHERE L_ORDERKEY = ?
DELETE FROM LINEITEM WHERE L_ORDERKEY = ?
... (1498 more times)

DELETE FROM LINEITEM WHERE L_ORDERKEY IN (?, ?, ?, ...)
```

The per-key form issues 1,500 individual DELETE statements. The batched form replaces them with one statement whose IN list covers all 1,500 keys. This provides ~750x performance improvement for delete operations.

**Platform-Specific Parameter Placeholders:**

BenchBox automatically detects the correct SQL parameter placeholder style:

- `?` for SQLite, DuckDB, SQL Server
- `%s` for PostgreSQL, MySQL, Redshift

This ensures compatibility across all supported platforms without manual configuration.

## Why Database Reload Is Required

Understanding why you must reload after Maintenance tests is critical for valid benchmarking:

### 1. Data Changes Are Permanent

All INSERT and DELETE operations are **committed transactions**. The changes persist in the database permanently. There is no automatic rollback or cleanup.

**What this means:**

- New rows exist in ORDERS, LINEITEM, catalog_sales, etc.
- Existing rows have modified values
- Some rows have been permanently deleted
- All database indexes and statistics are updated

### 2. Query Results Will Differ

Power and Throughput queries execute against the **modified dataset**, producing different results:

**Affected query patterns:**

- `COUNT(*)` returns different row counts
- `SUM(revenue)` calculates different totals
- `AVG(price)` computes different averages
- `JOIN` operations match different rows
- Date range filters include/exclude different records

**Example:**

```sql
SELECT COUNT(*) FROM orders;

SELECT COUNT(*) FROM orders;

SELECT COUNT(*) FROM orders;
```

The same statement run at three points returns these results at scale factor 1.0:

- Before maintenance: 1,500,000 rows (the original count).
- After RF1, which inserted 1,500 orders: 1,501,500 rows, which differs from the original.
- After RF2, which deleted 1,500 orders: 1,500,000 rows again, but the rows are not the original ones.

Even if row counts match after both RF1 and RF2, the **actual data is different** - you deleted old orders and inserted new ones!

### 3. Not Idempotent

Running Maintenance tests multiple times doesn't produce the same result:

- **First run**: Inserts orders 1,501,000-1,502,500, deletes orders 1-1,500
- **Second run**: Inserts orders 1,502,501-1,504,000, deletes orders 1,501-3,000
- **Third run**: Inserts orders 1,504,001-1,505,500, deletes orders 3,001-4,500

Each execution modifies **different data**. There's no "undo" button.

### 4. TPC Specification Requirement

The official TPC specifications explicitly require:

> "The database must be in its initial loaded state before each Performance Test (Power or Throughput). Maintenance operations must not affect the database state for Performance Tests."

**What this means:**

- Official TPC results require clean data for Power/Throughput
- Running tests on modified data **violates the specification**
- Results become non-comparable to other published benchmarks
- Attempting to submit modified-data results would be rejected

## Complete Workflow Examples

### Workflow 1: Power + Throughput Only (No Maintenance)

```python
benchmark.generate_data()

adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)

power_result = adapter.run_benchmark(benchmark, test_execution_type="power")
throughput_result = adapter.run_benchmark(benchmark, test_execution_type="throughput")

```

### Workflow 2: Full Official Benchmark (All Three Tests)

```python
benchmark.generate_data()

adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)

power_result = adapter.run_benchmark(benchmark, test_execution_type="power")

throughput_result = adapter.run_benchmark(benchmark, test_execution_type="throughput")

maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")

```

### Workflow 3: Maintenance Only (Testing ETL Performance)

```python
benchmark.generate_data()

adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)

maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")

adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)
maintenance_result_2 = adapter.run_benchmark(benchmark, test_execution_type="maintenance")
```

### Workflow 4: Investigating Query Changes After Maintenance

```python
adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)
result_before = adapter.execute("SELECT COUNT(*), SUM(o_totalprice) FROM orders")
print(f"Before: {result_before}")

maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")

result_after = adapter.execute("SELECT COUNT(*), SUM(o_totalprice) FROM orders")
print(f"After: {result_after}")
```

## CLI Usage

### Running Individual Tests

```bash
benchbox run --platform duckdb --benchmark tpch --scale 1.0 --phases power

benchbox run --platform duckdb --benchmark tpch --scale 1.0 --phases throughput

benchbox run --platform duckdb --benchmark tpch --scale 1.0 --phases load,maintenance
```

### Correct Workflow

```bash
benchbox run \
  --platform duckdb \
  --benchmark tpch \
  --scale 1.0 \
  --phases generate,load,power,throughput,maintenance

benchbox run \
  --platform duckdb \
  --benchmark tpch \
  --scale 1.0 \
  --phases load,power,throughput
```

### Incorrect Workflows ❌

```bash
benchbox run \
  --platform duckdb \
  --benchmark tpch \
  --scale 1.0 \
  --phases generate,load,power,maintenance,throughput

benchbox run \
  --platform duckdb \
  --benchmark tpch \
  --scale 1.0 \
  --phases generate,load,power,throughput,maintenance
benchbox run \
  --platform duckdb \
  --benchmark tpch \
  --scale 1.0 \
  --phases power
```

If standalone Maintenance runs between Power and Throughput, the Throughput queries run against modified data. With TPC-H refresh integration enabled, Power and Throughput deliberately use consecutive update sets in that order; do not insert standalone Maintenance between them. Reload or choose the next unused update set before repeating a run.

## Troubleshooting

### "I ran Maintenance and now my query results changed"

✅ **This is expected behavior!** Maintenance tests permanently modify data. Reload the database to restore original results.

### "Can I run Power or Throughput after Maintenance?"

For query-only comparisons, load fresh data before Power or Throughput. When TPC-H refresh integration is enabled, the phases intentionally use consecutive update sets in Power-then-Throughput order; run standalone Maintenance afterward with the next unused set or reload first.

### "I want to run Maintenance multiple times to test sustained ETL load"

✅ **Possible, but requires reload between each run:**

```python
for i in range(5):
    adapter = DuckDBAdapter(database_path="benchmark.duckdb", force_recreate=True)

    result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")
    print(f"Run {i+1}: {result.total_execution_time:.2f}s")
```

### "How do I verify my database was modified?"

```python
before = adapter.execute("SELECT COUNT(*) FROM orders")[0][0]

maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")

after = adapter.execute("SELECT COUNT(*) FROM orders")[0][0]

print(f"Before: {before}, After: {after}, Difference: {after - before}")
```

### "TPC-DS maintenance refused: primary keys are enforced"

The dsdgen refresh sets reuse order and ticket numbers that already exist in the base data, so an enforced primary key on a maintenance target table rejects the inserts. DuckDB, PostgreSQL and SQLite enforce primary keys. Reload the data with `--tuning notuning` and run maintenance again. Snowflake does not enforce primary keys and runs without it. See [Enforced Primary Keys](#enforced-primary-keys).

### "Can I skip Maintenance tests?"

✅ **Yes, if you only need query performance metrics.** Maintenance tests are only required for:

- Full TPC specification coverage
- Complete benchmark suite
- ETL/data modification performance evaluation

### "What if my database doesn't support DELETE?"

Some immutable analytical databases (like certain columnar stores) don't support data modifications. In this case:

- Skip Maintenance tests entirely
- Document this limitation in your results
- Note that the run will not cover the full TPC specification

## Workflow Summary

### Golden Rules

1. Standalone Maintenance can run after Power/Throughput, but its update set must not have been applied already.
2. Reload before reusing DBGen update sets; otherwise advance `tpch_refresh_first_set`.
3. Keep Power and Throughput on the same intended dataset sequence.
4. Run standalone Maintenance last when using query-only tests.

### Correct Sequences

```text
✓ generate → load → power → throughput
✓ generate → load → power → throughput → maintenance using next unused set
✓ generate → load → maintenance
✓ maintenance → [RELOAD] → maintenance (repeat from the same set)
```

### Incorrect Sequences

```text
✗ generate → load → power → maintenance → throughput ❌
  (Throughput runs on modified data!)

✗ generate → load → maintenance → power → throughput ❌
  (Power and Throughput run on modified data!)

✗ maintenance → [NO RELOAD] → power ❌
  (Power runs on modified data!)

✗ maintenance → [NO RELOAD] → maintenance ❌
  (Second Maintenance runs on already-modified data!)
```

## FAQ

**Q: Do I need to reload between Power and Throughput tests?**
A: Not by default. With TPC-H refresh enabled, Power applies set F and Throughput uses consecutive sets F+1..F+S; do not run standalone Maintenance between them.

**Q: What happens if Maintenance runs before Power/Throughput?**
A: It modifies the database. Reload original data or configure the next unused TPC-H update set before measuring.

**Q: Can refresh functions run during Throughput tests?**
A: Yes, for TPC-H when `tpch_refresh_functions=true`; one RF1/RF2 stream runs concurrently with query streams. BenchBox results remain derived results, not audited TPC results.

**Q: How long does database reload take?**
A: Depends on scale factor and platform:

- SF=1 on DuckDB: ~30 seconds to 2 minutes
- SF=10 on DuckDB: ~5-15 minutes
- SF=100 on cloud warehouse: ~30 minutes to 2 hours

**Q: Is there a way to avoid reload overhead?**
A: No. Reload is mandatory for valid results. Budget time accordingly.

**Q: Can I use database snapshots instead of full reload?**
A: Yes! This can speed up testing:

```python
adapter.create_snapshot("clean_data")

power_result = adapter.run_benchmark(benchmark, test_execution_type="power")

adapter.restore_snapshot("clean_data")

maintenance_result = adapter.run_benchmark(benchmark, test_execution_type="maintenance")
```

Check your platform's documentation for snapshot support.

**Q: What if my Maintenance test fails?**
A: The database may be in an inconsistent state. Reload and investigate:

- Check database logs for errors
- Verify sufficient disk space
- Confirm write permissions
- Check for constraint violations

**Q: Do I need Maintenance tests for non-TPC benchmarks?**
A: No. Maintenance tests are specific to TPC benchmarks. Other benchmarks (ClickBench, JoinOrder, etc.) don't have maintenance phases.

## See Also

- [TPC-H Official Guide](./tpc-h-official-guide.md) - Complete TPC-H implementation details
- [TPC-DS Official Guide](./tpc-ds-official-guide.md) - Complete TPC-DS implementation details
- [CLI Reference](../../reference/cli/index.md) - Command-line options for running benchmarks
- [Test Types Example](../../../examples/features/test_types.py) - Runnable code demonstrating all three test types
- [TPC-H Specification](https://www.tpc.org/tpc_documents_current_versions/current_specifications5.asp) - Official TPC-H specification
- [TPC-DS Specification](https://www.tpc.org/tpc_documents_current_versions/current_specifications5.asp) - Official TPC-DS specification
