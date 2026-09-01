# Runtime Column Discovery

**Rule zero: the live column list is the only vocabulary.**

Never use a column name that did not come from `tg_resolve_datasets` for the
specific experiment you are reading. Not from this plugin's documentation, not
from a previous conversation, not from a naming pattern, not from a calendar.

Column sets are configured per experiment. Two experiments in the same workspace
can differ. Two workspaces almost always differ.

---

## The discovery procedure

### Step 1 — get the authoritative list

```
tg_resolve_datasets(experiment_ids=["<id>"])
  → experiments[].datasets[].columns      ← authoritative
  → experiments[].datasets[].sample_row   ← shows real value formats
  → experiments[].datasets[].doc_summary  ← routing hints
```

If `schema_error` is present instead of `columns`, you have no column list.
Report that and stop — do not proceed on assumed columns.

### Step 2 — split the columns

```
For each column name, test:  ^(\d{4}-\d{2}-\d{2})\s+(.+)$

  MATCH     → time-series column:  (month, family)
  NO MATCH  → dimension, attribute, or precomputed analytic
```

### Step 3 — build the family → months map

```
family "Sales"                    → [2024-08-31 ... 2026-07-31]   (24)
family "Forecast"                 → [2024-08-31 ... 2026-07-31]   (24)
family "Locked ML Forecast Lag_4" → [2026-03-31 ... 2026-07-31]   (5)   ← global lock
family "Lock ML Forecast Lag_2"   → [...]                                ← secondary lock
family "Upper Bound"              → [...]
...
```

**Expect ragged coverage.** Families covering different month ranges is the normal
case, not an error. In one observed workspace `Forecast` had 24 months while
the global lock had 5.

**Classify lock families as you go.** All lock families share the same ` Lag_N`
suffix, so the leading word is the only discriminator — anchor on the trailing
space: `"Locked "` (global), `"Multi_Lock "`, `"Lock "` (secondary). A loose
`contains "Lock"` conflates them. **Every calculation uses the global lock.**
Full procedure: `LOCK-FAMILIES.md` §7.

Before answering anything about a specific period, check that the family you need
actually covers that month.

### Step 4 — identify the grain

The grain is whichever non-date columns identify a row. Read it; never assume it.

```
Observed in one workspace:   product_variant_code, channel_name, Region_name
Documented elsewhere:        SKU Code, Site ID
```

Neither is universal. Use `sample_row` to confirm which columns look like
identifiers versus attributes.

If the user names an entity ("SKU ABC123"), match it against the grain columns
that actually exist. If you cannot tell which column holds it, ask, or use a
`contains` filter across the plausible identifier column and say what you did.

### Step 4b — the grain vocabulary is per-experiment. Never assume it.

**Two experiments in the same company shared no grain column at all.** Measured
live:

| CPG experiment | Retail experiment |
|---|---|
| `SKU Code`, `Site ID`, `Site Name` | `Store Num` |
| `Category`, `Sub-category` | `Product Type`, `Subtype` |
| `Brand name`, `Product Name`, `channel` | `Brand`, `Style Group Name` |

Every example in this plugin writes `group_by: ["Category"]`. In the Retail
experiment that column does not exist, and the call fails with a DuckDB binder
error. Read the grain columns from the live list for **each** experiment before
building any `group_by`, `filters` or `select_columns`, and name the grain you
used in the answer. `Lifestage` was the only shared descriptive column.

### Step 4c — month windows are per-experiment too

The same two experiments were a **full year apart**: CPG `Sales` ran
2024-08-31 → 2026-07-31 with `Forecast` from 2026-08-31; Retail `Sales` ran
2023-08-31 → 2025-07-31 with `Forecast` from 2025-08-31. A date that resolves in
one experiment is a `COLUMN_NOT_FOUND` in the other. Never carry a month list
between experiments, and re-derive the eligible set per experiment.

The binder error is actually helpful here — it lists `Candidate bindings`, which
names real nearby columns. Read them instead of guessing again.

### Step 4d — a column's presence does not mean it holds data

Three columns in one live workspace were present, non-null in the schema, and
carried nothing usable:

| Column | Presence | Reality |
|---|---|---|
| `current_month_sales_tilldate` | on all 2,379 rows | sums to **exactly 0** |
| `SnOP Comments` | in the column list | **null on every row** — `is_not_null` returned 0 rows |
| `Stock Transfer` (dataset) | `resolved: true` | 0 columns; reading it 502s |

So detection is two steps, not one: **the column exists**, and **it has values**.
For a numeric column, `sum` it and check the total is non-zero before reporting it.
For a text column, filter `is_not_null` and check the count. An empty result comes
back as `returned: 0` with `columns: []` — an empty column list on a filtered read
means no matching rows, not a failure.

Report "this workspace records none" rather than publishing the zero or the blank.
A zero that came from an empty column is indistinguishable, in the answer, from a
measured zero — and only one of them is a fact.

### Step 4e — placeholder grain values distort every portfolio figure

`UNKNOWN` is a real value in live grain columns, not a null. Measured: `Category`
= `UNKNOWN` on **603 of 2,379 rows** — the single largest group, 25% of the
portfolio — with `Product Name` and `Brand name` also reading `UNKNOWN`. These are
unmapped master-data rows, and they carry real sales.

They are not a rounding detail. For 2026-07-31 they held 1,370 of 6,364 units of
actuals (21.5%) and **1,332 of 5,346 units of absolute error (24.9%)**, against a
locked forecast of just 56 units. Portfolio accuracy for that month reads 16.0%
including them and 19.6% excluding them.

So:

- **Keep them in the total** — the volume is real and dropping it overstates
  accuracy.
- **Always break them out as their own line**, named as unmapped master data, and
  say what they do to the figure. Folding a mapping gap into a model-accuracy
  number blames the forecast for something the forecast did not do.
- Never treat `UNKNOWN` as a category, brand or product in a ranking narrative,
  and never silently exclude it. Do the same for any grain value that is
  obviously a placeholder — `UNKNOWN`, `NA`, `N/A`, `Unmapped`, `Other`, empty
  string — and say which convention you found.

### Step 5 — detect optional columns before relying on them

Check the live list for each of these. Presence changes your approach:

| Column | If present | If absent |
|---|---|---|
| `overall_accuracy` | read it; cite as precomputed | compute per `METRICS.md` |
| `rolling_accuracy` | read it; cite as precomputed | compute per `METRICS.md`; state your window |
| `<date> Accuracy` | read it for a per-month trend; cite as precomputed | derive from monthly sums |
| `<date> Bias` | read it; cite as precomputed | compute per `METRICS.md` §3 |
| `trust_zone` | may quote **with attribution** (`SAFETY-CONTRACT.md` §15) | never derive one |
| `% Contribution Last 3 Months` | may use; note its fixed 3-month window | compute contribution from sums |
| `Imputation Flag` | check it; surface flagged contributions | note that no imputation flag exists |
| `SnOP Comments` | quote verbatim for planner context | no human "why" is available |
| `AB_Class` | apply the AB-class rule below | segment filter unavailable |
| `Lifestage`, `cluster`, `sales_pattern_category`, `forecast_pattern_category` | usable as grouping dimensions | not available |
| `<date> Lower Bound` / `Upper Bound` / `P10`–`P99` | **must** be included with point forecasts | say no interval is available |
| `<date> <lock family> Abs Error` | preferred error numerator — **must match the chosen family *and* lag** | use the netted fallback and say so |
| `<date> Consensus Forecast` | the planner-agreed number; use it as the forecast side **only** for an explicit consensus question, labelled as not frozen (`METRICS.md` §1a) | say this workspace records no consensus forecast; never pass `Forecast` off as consensus |
| a `Locked ...` family | **the basis for every metric** — classify per `LOCK-FAMILIES.md` | no accuracy can be measured — say so |
| a `Lock ...` / `Multi_Lock ...` family | keep it **out** of metric calculations; readable on request | nothing to exclude |

### Step 6 — verify before you compute

Before sending aggregations, confirm every column name you are about to use
appears verbatim in the live list. One typo or one invented month produces
`COLUMN_NOT_FOUND` and wastes a round trip.

---

## The AB_Class rule

`AB_Class` holds one letter per row: `A`, `B`, or `C`.

| User says | Filter |
|---|---|
| "A class" | `AB_Class = 'A'` |
| "B class" | `AB_Class = 'B'` |
| "C class" | `AB_Class = 'C'` |
| **"AB class"** | **`AB_Class IN ('A','B')`** |

"AB class" is a business term meaning the important two-thirds — A and B
together, **excluding C**. It does not mean `= 'A'`.

The column may appear as `AB_Class`, `AB Class`, or with an `*_ABC_Class` suffix.
Use the exact token from the live list.

---

## Common failure modes and how to avoid them

| Failure | Cause | Avoidance |
|---|---|---|
| `COLUMN_NOT_FOUND` | column name built from a calendar or pattern | only use names from the live list |
| Wrong grain in the answer | assumed SKU/Site | read the grain from the live columns |
| Accuracy silently based on 1 month | ragged baseline coverage not checked | build the eligible set explicitly, report it |
| A whole segment missing from results | "AB class" read as `= 'A'` | apply the AB-class rule |
| Interval omitted | bound columns not checked | check for bounds/quantiles every time |
| Secondary locks folded into a global-lock answer | matched `contains "Lock"`, which also matches `Locked` | classify `Locked` before `Lock` (`LOCK-FAMILIES.md` §3) |
| Accuracy silently wrong, no error raised | Lag_4 abs error paired with a Lag_2 forecast | verify family **and** lag match on every column |
| `COLUMN_NOT_FOUND` on a lock column | lag or family reassembled from parts | copy the name verbatim from the live list |
| Trust band wrong for the workspace | default thresholds applied | never derive zones (`SAFETY-CONTRACT.md` §15) |
| Context flooded | unfiltered plain read of a 600-column table | always use `select_columns` or `aggregations` |
| Value/unit figures mixed | wrong dataset | `Final DA Data` = units, `Final DA Data Value` = money |
