<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Flat Demo x'y

```{tags} reference, query-template, flat
```

> [Flat Demo](../../flat-demo.md) benchmark · [all Flat Demo queries](index.md)

## Representative SQL

_This query could not be rendered as standalone SQL._

## Representative DataFrame

Expression family (Polars, PySpark, DataFusion), default parameters.

```python
def xy():
    return 1
```

## Get the exact query for your run

The blocks above are representative. To get the precise statement a specific platform runs at a specific scale, substitute your own values:

```python
from benchbox import FlatDemo

bench = FlatDemo(scale_factor=0.01)            # your scale factor
queries = bench.get_queries(dialect="datafusion")   # your platform's dialect; drop dialect= for native SQL
print(queries["x'y"])
```

For the DataFrame form:

```python
from benchbox.core.query_catalog import get_dataframe_render

print(get_dataframe_render('flat', "x'y", family="expression").source)  # or family="pandas"
```
