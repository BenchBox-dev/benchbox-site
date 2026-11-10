# Evidence: TPC-DS OBT Q93 parameters, BenchBox 0.4.2 vs 0.5.0

Source for `images/tpcds_obt_q93_parameters.png` in the TPC-DS OBT post.
Captured 2026-11-09 on macOS 27.0.1, DuckDB CLI 1.5.5, Python 3.12.15.

## Method

Both releases were asked for the SQL they would run, with `--dry-run`,
which saves the same SQL a real run uses. BenchBox 0.5.0 then generated
and loaded the TPC-DS OBT table at scale factor 1, and the two
`query_93.sql` files were executed with the `duckdb` CLI against that one
database, so the loader cannot account for the difference. Scale factor 1
is the only scale `tpcds_obt` accepts in either release.

```bash
for v in 0.4.2 0.5.0; do
  uvx --with pandas --from "benchbox[duckdb]==$v" benchbox run --platform duckdb \
    --benchmark tpcds_obt --scale 1 --dry-run ./dry-$v --non-interactive
done
uvx --with pandas --from "benchbox[duckdb]==0.5.0" benchbox run --platform duckdb \
  --benchmark tpcds_obt --scale 1 --queries 93 --phases generate,load,power \
  --non-interactive --output ./run-050
DB=benchmark_runs/databases/tpcds_sf1/tpcds_sf1_notuning_noconstraints.duckdb
for v in 0.4.2 0.5.0; do
  duckdb -readonly "$DB" -csv -c "select count(*) from ($(cat dry-$v/*queries*/query_93.sql))"
done
```

The generate and load step took about six minutes and wrote a 2.9 GB
database holding `tpcds_sales_returns_obt` with 5,041,336 rows.

## Generated SQL (the filter only)

0.4.2:

```sql
WHERE
  (
    (
      obt.reason_sk = obt.reason_r_reason_sk AND obt.reason_r_reason_desc = '0'
    )
    AND (
      obt.item_sk = obt.item_sk AND obt.sale_id = obt.sale_id
    )
  )
  AND channel = 'store'
```

0.5.0:

```sql
WHERE
  (
    obt.reason_sk = obt.reason_r_reason_sk AND obt.reason_r_reason_desc = 'Did not like the warranty'
  )
  AND channel = 'store'
```

The image shows the three conditions that differ in effect. It leaves out
the 0.4.2 pair `obt.item_sk = obt.item_sk AND obt.sale_id = obt.sale_id`,
which is true for every row with non-null keys and does not change the
result here.

## Results

| Measure | 0.4.2 SQL | 0.5.0 SQL |
| --- | --- | --- |
| Sale lines matching the filter | 0 | 3,609 |
| Rows returned (the query ends in `LIMIT 100`) | 0 | 100 |

The table holds 75 distinct `reason_r_reason_desc` values and none is
`'0'`:

```sql
select count(distinct reason_r_reason_desc) from tpcds_sales_returns_obt
  where reason_r_reason_desc is not null;                      -- 75
select count(*) from tpcds_sales_returns_obt
  where reason_r_reason_desc = '0';                            -- 0
```

## Other queries in the same sweep

Of the 0.4.2 dry-run files, 13 contain the literal `= '0'`. They were not
executed for this note.
