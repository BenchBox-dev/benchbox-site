<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Flat Demo 3a

```{tags} reference, query-template, flat
```

> [Flat Demo](../../flat-demo.md) benchmark · [all Flat Demo queries](index.md)

## Representative SQL

Rendered for **datafusion** with default parameters.

```sql
SELECT 3
```

## Representative DataFrame

Pandas family, default parameters.

```python
def q3a_pandas_impl(df):
    return df.head(1)
```

## Get the exact query for your run

The blocks above are representative. To get the precise statement a specific platform runs at a specific scale, substitute your own values:

```python
from benchbox import FlatDemo

bench = FlatDemo(scale_factor=0.01)            # your scale factor
queries = bench.get_queries(dialect="datafusion")   # your platform's dialect; drop dialect= for native SQL
print(queries['3a'])
```

For the DataFrame form:

```python
from benchbox.core.query_catalog import get_dataframe_render

print(get_dataframe_render('flat', '3a', family="expression").source)  # or family="pandas"
```
