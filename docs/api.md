---
tags: [reference, python-api]
---

# API Reference

This page lists the benchmark classes and the import path to use for each. For detailed API documentation, see [Python API Reference](reference/python-api/index.md).

Each benchmark class takes `scale_factor` and `output_dir` and inherits from `BaseBenchmark`; see [Base Benchmark API](reference/python-api/base.md) for the methods they share. The canonical import is the one exported from the top-level `benchbox` package. The module import in the third column returns the same object.

| Benchmark | Canonical import | Module import | Contract |
| --- | --- | --- | --- |
| AMPLab Big Data | `from benchbox import AMPLab` | `from benchbox.amplab import AMPLab` | [AMPLab Big Data Benchmark API](reference/python-api/benchmarks/amplab.md) |
| Base class | `from benchbox import BaseBenchmark` | `from benchbox.base import BaseBenchmark` | [Base Benchmark API](reference/python-api/base.md) |
| ClickBench | `from benchbox import ClickBench` | `from benchbox.clickbench import ClickBench` | [ClickBench Benchmark API](reference/python-api/benchmarks/clickbench.md) |
| CoffeeShop | `from benchbox import CoffeeShop` | `from benchbox.coffeeshop import CoffeeShop` | [CoffeeShop Benchmark API](reference/python-api/benchmarks/coffeeshop.md) |
| Data Vault | `from benchbox import DataVault` | `from benchbox.datavault import DataVault` | [Data Vault Benchmark API](reference/python-api/benchmarks/datavault.md) |
| Flight Data | `from benchbox import FlightData` | `from benchbox.flightdata import FlightData` | [FlightData Benchmark API](reference/python-api/benchmarks/flightdata.md) |
| H2O.ai database benchmark | `from benchbox import H2ODB` | `from benchbox.h2odb import H2ODB` | [H2O.ai Database Benchmark API](reference/python-api/benchmarks/h2odb.md) |
| Join Order | `from benchbox import JoinOrder` | `from benchbox.joinorder import JoinOrder` | [Join Order Benchmark API](reference/python-api/benchmarks/joinorder.md) |
| Metadata Primitives | `from benchbox import MetadataPrimitives` | `from benchbox.metadata_primitives import MetadataPrimitives` | [MetadataPrimitives Benchmark API](reference/python-api/benchmarks/metadata-primitives.md) |
| NYC Taxi | `from benchbox import NYCTaxi` | `from benchbox.nyctaxi import NYCTaxi` | [NYCTaxi Benchmark API](reference/python-api/benchmarks/nyctaxi.md) |
| Read Primitives | `from benchbox import ReadPrimitives` | `from benchbox.read_primitives import ReadPrimitives` | [Read Primitives Benchmark API](reference/python-api/benchmarks/read-primitives.md) |
| Star Schema Benchmark | `from benchbox import SSB` | `from benchbox.ssb import SSB` | [SSB (Star Schema Benchmark) API](reference/python-api/benchmarks/ssb.md) |
| TPC-DI | `from benchbox import TPCDI` | `from benchbox.tpcdi import TPCDI` | [TPC-DI Benchmark API](reference/python-api/benchmarks/tpcdi.md) |
| TPC-DS | `from benchbox import TPCDS` | `from benchbox.tpcds import TPCDS` | [TPC-DS Benchmark API](reference/python-api/benchmarks/tpcds.md) |
| TPC-DS One Big Table | `from benchbox import TPCDSOBT` | `from benchbox.tpcds_obt import TPCDSOBT` | [TPCDSOBT Benchmark API](reference/python-api/benchmarks/tpcds-obt.md) |
| TPC-H | `from benchbox import TPCH` | `from benchbox.tpch import TPCH` | [TPC-H Benchmark API](reference/python-api/benchmarks/tpch.md) |
| TPC-Havoc | `from benchbox import TPCHavoc` | `from benchbox.tpchavoc import TPCHavoc` | [TPC-Havoc API](reference/python-api/benchmarks/tpchavoc.md) |
| TPC-H Skew | `from benchbox import TPCHSkew` | `from benchbox.tpch_skew import TPCHSkew` | [TPC-H Skew API](reference/python-api/benchmarks/tpch-skew.md) |
| Transaction Primitives | `from benchbox import TransactionPrimitives` | `from benchbox.transaction_primitives import TransactionPrimitives` | [Transaction Primitives API](reference/python-api/benchmarks/transaction-primitives.md) |
| TSBS DevOps | `from benchbox import TSBSDevOps` | `from benchbox.tsbs_devops import TSBSDevOps` | [TSBS DevOps API](reference/python-api/benchmarks/tsbs-devops.md) |
| Vector Search | `from benchbox import VectorSearch` | `from benchbox.vector_search import VectorSearch` | [Vector Search API](reference/python-api/benchmarks/vector-search.md) |
| Write Primitives | `from benchbox import WritePrimitives` | `from benchbox.write_primitives import WritePrimitives` | [Write Primitives Benchmark API](reference/python-api/benchmarks/write-primitives.md) |

TPC-DI needs the `tpcdi` extra (`pip install "benchbox[tpcdi]"`).
