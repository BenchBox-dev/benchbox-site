export type TagCategory = { slug: string; title: string; tags: readonly string[] };

export const TAG_CATEGORIES: readonly TagCategory[] = [
  { slug: "audience", title: "By Audience", tags: ["beginner", "intermediate", "advanced", "contributor"] },
  { slug: "benchmark", title: "By Benchmark", tags: ["tpc-h", "tpc-ds", "tpc-di", "tpc-havoc", "tpch-skew", "ssb", "clickbench", "h2odb", "join-order", "amplab", "tpc-ds-obt", "tpcds-obt", "tpcds_obt", "tpch", "tpcds", "tpcdi", "tpch_skew", "tpchavoc", "joinorder", "ai_primitives", "read_primitives", "write_primitives", "transaction_primitives", "metadata_primitives", "tsbs_devops", "nyctaxi", "coffeeshop", "datavault", "tsbs-devops", "read-primitives", "write-primitives", "transaction-primitives", "metadata-primitives", "ai-primitives", "custom-benchmark"] },
  { slug: "platform", title: "By Platform", tags: ["duckdb", "sqlite", "postgresql", "datafusion", "snowflake", "databricks", "bigquery", "redshift", "motherduck", "starburst", "clickhouse", "trino", "presto", "firebolt", "timescaledb", "influxdb", "athena", "aws-glue", "emr-serverless", "athena-spark", "dataproc", "dataproc-serverless", "azure", "fabric", "fabric-spark", "synapse-spark", "spark", "pyspark", "pandas", "polars", "dask", "modin", "cudf", "datafusion-df", "databricks-df", "fabric-lakehouse", "cedardb", "citus", "databend", "doris", "gizmosql", "lakesail", "paradedb", "pg-duckdb", "pg-mooncake", "postgresql-extension", "questdb", "quanton", "singlestore", "starrocks", "gluten", "velox"] },
  { slug: "platform-type", title: "By Platform Type", tags: ["sql-platform", "dataframe-platform", "cloud-platform", "embedded-platform", "cloud-storage", "dataframe", "spark-compatible"] },
  { slug: "content-type", title: "By Content Type", tags: ["guide", "tutorial", "reference", "concept", "quickstart"] },
  { slug: "feature", title: "By Feature", tags: ["architecture", "cli", "cloud", "e2e", "python-api", "configuration", "data-generation", "performance", "tuning", "validation", "testing", "visualization"] },
  { slug: "data-format", title: "By Data Format", tags: ["parquet", "iceberg", "delta-lake", "ducklake", "vortex", "formats"] },
  { slug: "deployment", title: "By Deployment", tags: ["self-hosted", "local", "local-dev", "local-platform", "docker", "cloud-native", "distributed", "multi-engine"] },
  { slug: "workload", title: "By Workload", tags: ["olap", "oltp", "htap", "time-series", "vector-search", "vector_search", "columnstore", "flightdata", "ai-ml", "real-world-benchmark"] },
  { slug: "results", title: "By Results and Analysis", tags: ["results", "metrics", "query-plans", "comparison", "analysis", "benchmarks", "platform-compatibility"] },
  { slug: "maturity", title: "By Maturity", tags: ["beta", "experimental"] },
];
