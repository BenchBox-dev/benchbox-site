---
tags: [reference, cli, data]
---

<span id="cli-datagen"></span>

# `datagen` - Data Generation

Generate benchmark data files without running queries. This is a convenience wrapper for `benchbox run --phases generate`.

## Basic Syntax

```bash
benchbox datagen --benchmark <name> --scale <sf> [OPTIONS]
```

## Options

**Required:**

- `--benchmark TEXT`: Benchmark name (e.g., `tpch`, `tpcds`, `clickbench`)
- `--scale FLOAT`: Scale factor for data generation

**Optional:**

- `--output PATH`: Output directory for generated data
- `--format [parquet|csv|json]`: **Not yet implemented.** This option is accepted but has no effect. Data is generated as pipe-delimited `.tbl` flat files (compressed to `.tbl.zst` when compression is enabled, which is the default). To convert generated data to parquet or other formats, use `benchbox run` with `--table-format`.
- `--seed INT`: Random seed for reproducible data generation
- `--verbose, -v`: Enable verbose logging
- `--timeout SECONDS`: Stop data generation after this many seconds (exit code 124). Unset means no limit and `0` also means no limit; a negative or fractional value is a usage error

## Usage Examples

```bash
benchbox datagen --benchmark tpch --scale 0.1 --output ./data/tpch_0.1

benchbox datagen --benchmark tpcds --scale 1 --seed 42 --output ./data/tpcds_1

benchbox datagen --benchmark clickbench --scale 1 --output ./data/clickbench

benchbox datagen --benchmark tpch --scale 0.01 --output ./data --verbose
```

The commands generate TPC-H data at scale factor 0.1, TPC-DS data with a specific seed, ClickBench data, and TPC-H data with verbose logging.

## Notes

- Internally invokes `benchbox run --phases generate` with a dummy platform. No database connection is needed.
- `--timeout` is the run time limit described in [Run Time Limit](run.md#run-time-limit). `datagen` hands it to `benchbox run --phases generate`, so when the option is omitted `execution.timeout_seconds` from the config file applies. At the limit a running TPC generator (`dsdgen`, `dbgen`, `dsqgen`, `qgen`) is ended together with its process group; other generators stop at the next check. If the command has not stopped 30 seconds after the limit, BenchBox writes the partial result and exits with code 124. Data left by a generator that was stopped part way is not reused: BenchBox regenerates it on the next run.
- Generated data can be reused across multiple benchmark runs by pointing `--output` to a shared location, or by using `benchbox run --global-cache`.

## Related

- [run](run.md) - Run full benchmarks including data generation
