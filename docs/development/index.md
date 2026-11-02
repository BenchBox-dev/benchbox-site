---
tags: [contributor]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Developer Documentation

Documentation for contributors and developers working on BenchBox.

## Roadmap

- [Development Roadmap](roadmap.md) - Planned platform and benchmark additions

## Getting Started with Development

- [Development Guide](development.md) - Setting up development environment and workflow
- [Testing](testing.md) - Testing strategies, running tests, and test organization
- [Test tiers and duration budgets](test-tier-policy.md) - Measured T1/T2/T3 policy and quarantine markers
- [Pytest xdist Safety](pytest-xdist-safety.md) - Why macOS worker counts are capped and how to validate changes

## Contributing

- [Adding New Platforms](adding-new-platforms.md) - How to add support for new database platforms
- [New Platform Acceptance Checklist](new-platform-acceptance-checklist.md) - Required registry, docs, tests, compatibility, and UAT gates
- [Import Patterns](import-patterns.md) - Lazy loading and dependency management patterns
- [TPC Compilation Guide](tpc-compilation-guide.md) - Compiling TPC benchmark tools

## Architecture & Design

- [Architecture Overview](../design/architecture.md) - High-level system architecture
- [Code Structure](../design/structure.md) - Codebase organization
- [DB API 2.0](db-api-2.md) - Python DB API 2.0 specification and platform integration
- [Runtime Modules](runtime-modules.md) - Runtime module organization and responsibilities
- [Run Lifecycle Map](run-lifecycle-map.md) - Current `benchbox run` execution/export branches
- [Data Sharing](data-sharing.md) - Data sharing between benchmark phases
- [Dependency Compatibility](dependency-compatibility.md) - Managing optional dependencies

## Testing

- [Testing Guide](testing.md) - Testing strategies and test organization
- [Test tiers and duration budgets](test-tier-policy.md) - Measured T1/T2/T3 policy and quarantine markers
- [Pytest xdist Safety](pytest-xdist-safety.md) - Root cause, reproducer, and validation checklist for xdist lock-ups
- [Testing Index](../testing/index.md) - Test documentation overview
- [Live Integration Tests](../testing/live-integration-tests.md) - Running tests against live databases

## Results & Validation

- [Result Execution Environment Contract](result-execution-environment.md) - Normalized client host, platform runtime, cloud/compute/storage facets, and anonymization policy
- [Result Integrity Validation](result-integrity-validation.md) - Three-tier validator: structural, completeness, and believability checks for result JSON files

## Reference

- [Read Primitives Catalog](read-primitives-catalog.md) - Catalog of primitive read operations
- [Read Primitives: Platform Skip Reference](read-primitives-skips-reference.md) - Why each query is skipped per platform and how to re-enable

## Related Documentation

- [Concepts](../concepts/index.md) - Core concepts and glossary

- [Development Roadmap](roadmap.md)
- [Getting Started with Development](getting-started.md)
- [Development Guide](development.md)
- [Platform Development](platform-development.md)
- [Adding New Platform Adapters](adding-new-platforms.md)
- [Adding a New DataFrame Platform](adding-dataframe-platform.md)
- [New Platform Acceptance Checklist](new-platform-acceptance-checklist.md)
- [Architecture & Design](architecture-design.md)
- [Data & Dependencies](data-dependencies.md)
- [Import Patterns and Lazy Loading](import-patterns.md)
- [TPC Binary Auto-Compilation Guide](tpc-compilation-guide.md)
- [BenchBox Testing Guide](testing.md)
- [Test tiers, duration budgets, and quarantine](test-tier-policy.md)
- [Pytest xdist Safety](pytest-xdist-safety.md)
- [Primitives Query Catalog](read-primitives-catalog.md)
- [Read Primitives: Platform Skip Reference](read-primitives-skips-reference.md)
- [Runtime Module Architecture Overview](runtime-modules.md)
- [Run Lifecycle Branch Map](run-lifecycle-map.md)
- [Data Sharing Between Benchmarks](data-sharing.md)
- [Dependency Compatibility](dependency-compatibility.md)
- [DB API 2.0: Foundation of BenchBox Platform Support](db-api-2.md)
- [BenchBox Test Quality Guidelines](test-quality-guidelines.md)
- [Result Execution Environment Contract](result-execution-environment.md)
- [Result Integrity Validation](result-integrity-validation.md)
- [BenchBox Platform Configuration Audit](../platform-config-audit.md)
