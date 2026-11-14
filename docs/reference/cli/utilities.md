---
tags: [reference, cli]
---

# Utility Commands

This page covers smaller utility commands for dependency checking, system profiling, benchmark discovery, and configuration validation.

<span id="cli-check-deps"></span>

## `check-deps` - Check Dependencies

Check dependency status and provide installation guidance for different platforms.

### Options

- `--platform TEXT`: Check dependencies for specific platform
- `--verbose`, `-v`: Show detailed dependency information
- `--matrix`: Show installation matrix and exit

### Usage Examples

```bash
benchbox check-deps

benchbox check-deps --platform databricks

benchbox check-deps --matrix

benchbox check-deps --verbose
```

The commands, in order, give an overview of all platform dependencies, check one platform, show the detailed installation matrix, and give verbose output with recommendations.

<span id="cli-profile"></span>

## `profile` - System Profiling

Profile the current system to understand hardware capabilities and provide recommendations.

### Usage

```bash
benchbox profile
```

This command analyzes:

- CPU cores and architecture
- Memory capacity and availability
- Disk space
- Operating system details
- Python environment

Provides recommendations for:

- Appropriate scale factors
- Concurrency settings
- Platform selection

<span id="cli-benchmarks"></span>

## `benchmarks` - Manage Benchmark Suites

Manage and browse available benchmark suites.

### Subcommands

#### `benchmarks list`

Display all available benchmark suites with descriptions.

```bash
benchbox benchmarks list
```

Shows information about:

- TPC-H, TPC-DS, TPC-DI (official TPC benchmarks)
- ClickBench, H2ODB (industry benchmarks)
- SSB, AMPLab (academic benchmarks)
- ReadPrimitives, WritePrimitives, TPC-Havoc (testing benchmarks)

<span id="cli-validate"></span>

## `validate` - Validate Configuration

Validate BenchBox configuration files for syntax and completeness.

### Options

- `--config TEXT`: Configuration file path (optional)

### Usage Examples

```bash
benchbox validate

benchbox validate --config ./custom-config.yaml
```

The first command validates the default configuration and the second validates a specific configuration file.

<span id="cli-validate-results"></span>

## Result Integrity Validation

Result integrity validation checks benchmark result JSON files for structural
integrity, completeness, and statistical believability. It runs 21 checks
across three tiers against hardcoded benchmark specifications.

Run it with [`benchbox results validate`](results.md#cli-results-validate),
which accepts one result file or a directory of result files and exits 5 when a
file has a FAIL finding. `benchbox validate` is a different command: it checks
configuration files, not result bundles. The `validate_results` tool of the
[MCP server](../mcp.md) returns the same findings. Contributors working from a
source checkout can also run the standalone `validate_results.py` script, which
wraps the same validator.

See the [Result Integrity Validation](../../development/result-integrity-validation.md)
developer guide for the full check list.

**Notes:**

- Automatically excludes `.plans.json`, `.tuning.json`, `.applied.json`, `.override.json` and `.manifest.json` companion files
- Specs cover 21 of 22 benchmarks with 8 legacy alias mappings (e.g., `star_schema` → `ssb`); `ai_primitives` is not yet covered

## Related

- [Result Integrity Validation](../../development/result-integrity-validation.md) - Architecture and check details
- [Configuration](configuration.md) - Configuration file format and options
- [Platforms](platforms.md) - Platform management commands
