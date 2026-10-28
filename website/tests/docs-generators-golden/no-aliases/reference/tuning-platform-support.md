# Tuning Platform Support

This page lists, for each platform in the tuning capability registry, what a
tuning file can change at execution and whether a tuned run can be verified
against the live catalog. It is generated from
`benchbox/core/tuning/capability_registry.py`, the packaged tuning templates,
and each adapter's catalog introspector by
`scripts/generate_tuning_support_matrix.py` (`make tuning-support-matrix`);
a test fails when the page drifts from those sources, so do not edit it by
hand.

- **Shipped templates**: benchmarks with a packaged `*_tuned.yaml` template,
  used by `--tuning tuned`. Platforms without one use the generic fallback.
- **Applied at execution**: tuning types the platform renders when tables are
  created or loaded. Requesting any other type fails validation.
- **Not applied**: tuning types the registry lists but the platform does not
  apply; requesting one fails validation with the registry's reason.
- **Catalog introspector**: whether the adapter reads the catalog after load
  to corroborate the applied-tuning ledger.
- **Can reach `applied_verified`**: yes only when the platform has a catalog
  introspector and applies at least one tuning type. Other platforms report
  at most `applied_unverified`.

Aliases resolve to another platform's entry: .

| Platform | Shipped templates | Applied at execution | Not applied | Spark session map | Catalog introspector | Can reach `applied_verified` |
| --- | --- | --- | --- | --- | --- | --- |
| `alpha` | tpch | clustering, sorting (with sorted ingestion) | partitioning, foreign_keys | applied | yes | yes |
| `beta` | none | none | partitioning | - | no adapter | no |
| `delta` | none | none | clustering, sorting | applied | yes | no |
| `gamma` | tpch, tpcds | partitioning | none | - | no | no |
