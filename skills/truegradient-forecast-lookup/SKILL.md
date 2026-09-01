---
name: truegradient-forecast-lookup
description: Look up the final forecast, actual sales, or forecast uncertainty interval for a specific product, SKU, variant, category, brand, channel, customer, region, or time period from TrueGradient demand planning data. Use this when the user asks what the forecast or actual IS for something specific — "what's the forecast for SKU X next month", "how many units for the North region in Q3", "show me the forecast range for this category", "what did we actually sell last month". Also use to compare a single entity's forecast against its own actuals. Do NOT use for accuracy, error or bias metrics across many entities — use truegradient-forecast-accuracy. Do NOT use for ranking items by risk — use truegradient-forecast-risk. Do NOT use for comparing two forecast versions — use truegradient-forecast-change.
---

# Forecast Lookup

Answer "what is the number" for a specific entity or period, from final data, with
its uncertainty interval.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop and say so — produce no numbers.
2. Use only `Final DA Data` (units) or `Final DA Data Value` (money) from an
   experiment returned by `tg_list_experiments_for_analysis`.
3. Never use a column name that did not come from `tg_resolve_datasets`.
4. **Name the forecast family** you used — and for a lock family, its **lag** too.
   There is no single "the forecast" column.
5. **Include the uncertainty interval** if bound or quantile columns exist for that
   period. If none exist, say so explicitly.
6. Missing means unknown. **Never report a missing value as zero.** Never
   interpolate, never carry a value across periods.
7. If the roster returns `used_archived_fallback: true`, lead with that caveat.
8. End with the provenance footer (§5).

Full detail: `../../references/SAFETY-CONTRACT.md`

## Procedure

**1. Identify the workspace.**
`tg_whoami` → note `company_name`. Not authenticated? Stop.

**2. Pick the experiment.**
`tg_whoami` → `tg_list_experiments_for_analysis()` → `tg_resolve_datasets(experiment_ids=["<id>"])`.

**Do not filter the roster by `module="demand-planning"`.** Forecast data does not
only live in demand-planning experiments: in an IBP workspace every experiment is
`inventory-optimization`, and `Final DA Data` — Sales, the lock families, the
stored accuracy and bias columns — sits inside those. Filtering on
demand-planning there returns `count: 0` and the skill would report no data while
the data is present.

Call the roster **unfiltered** and pick by what the experiment actually holds.
If you do pass a module and get `count: 0`, read
`diagnostics.distinct_modules_seen` before concluding anything, and retry
unfiltered.
Default to the newest. If the user names a cycle or month, match it against
`label` and `createdAt`. If `count: 0`, show the diagnostics and stop.

**3. Discover the schema.**
`tg_resolve_datasets(experiment_ids=["<id>"])`.
Read `columns` and `sample_row`. Determine:
- the grain columns (do not assume SKU/Site — see `../../references/COLUMN-DISCOVERY.md`)
- which forecast families exist and **which months each one covers**
- whether `Lower Bound` / `Upper Bound` / `P10`–`P99` exist for the target period
- whether `Imputation Flag` exists

**4. Choose the dataset.**
Units, quantity, volume → `Final DA Data`.
Revenue, value, money → `Final DA Data Value`.
Never mix the two in one calculation.

**5. Choose the forecast family.**
Default to `<date> Forecast` (the operational view) and say so. If the user asks
for the baseline, model output, or a planner-reviewed view, use that family
instead and name it.

If the user asks for the **consensus** forecast, use `<date> Consensus Forecast`
and name it as the planner-agreed number. It is absent in many workspaces — if
the column is not in the live list, say that this workspace records no consensus
forecast and offer `<date> Forecast`; never pass off the operational forecast as
consensus.

If the user asks for the **locked or frozen** forecast, that is a lock family:
default to the global lock, `<date> Locked ML Forecast Lag_N`, and state the lag.
`Lock ...` (secondary, per-lag) and `Multi_Lock ...` (rest-of-year) are separate
families — read them only when named, and label them as not the basis for any
metric. They usually share a ` Lag_N` suffix — a bare `Locked ML Forecast` with no
lag token is also a live form — so the leading word is the only reliable
discriminator: `contains "Lock"` matches `Locked` too. See
`../../references/LOCK-FAMILIES.md`. If `Forecast` has no column for the requested month, say
which families do cover it and use the closest match the user would want —
naming it.

**5b. The interval may not contain the forecast — say so when it does not.**

`Lower Bound` / `Upper Bound` / `P10`–`P99` are the **model's** interval. `Forecast`
is the operational number and may have been edited by a planner, so the point can
sit outside its own band. Observed live: a SKU with `2026-09-30 Forecast` of 101
against a Lower/Upper Bound of 38–70, and in that workspace `Forecast` was
identical to `Table Edited Forecast` for every row — the edits moved the point off
the model's distribution.

So before printing a point and a range together, **check that the point is inside
the range**. When it is not:

- print both anyway — suppressing either one hides the disagreement;
- say plainly that the interval is the model's and does not contain the
  operational forecast, which means the plan sits outside what the model
  considered likely;
- name the families, and show `ML Forecast` alongside if it exists — the interval
  contains *that*. Verified on 12 live rows: every `ML Forecast` sat inside its
  Lower/Upper Bound, while `Forecast` sat **exactly at the Upper Bound** on 5 of
  them and above it on 2. That pattern — an edited forecast pinned to or pushed
  past the model's ceiling — is worth stating when you see it, because it says the
  plan is at the optimistic edge of the model's range rather than in the middle of
  it.

Never widen, clip or recentre the interval to make it contain the point, and never
present the band as the uncertainty around an edited forecast.

**6. Read the data.**
Always filtered and projected — never a plain read.

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "filters": [{"column": "<grain column>", "operator": "=", "value": "<entity>"}],
  "select_columns": ["<grain columns>", "2026-09-30 Forecast",
                     "2026-09-30 Lower Bound", "2026-09-30 Upper Bound",
                     "Imputation Flag"],
  "page_size": 100
}
```

For a group total (a category, a region, all channels), aggregate instead:

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "filters": [{"column": "Category", "operator": "=", "value": "Beverages"}],
  "aggregations": [
    {"function": "sum", "column": "2026-09-30 Forecast",     "alias": "fc"},
    {"function": "sum", "column": "2026-09-30 Lower Bound",  "alias": "lo"},
    {"function": "sum", "column": "2026-09-30 Upper Bound",  "alias": "hi"}
  ]
}
```

Note when aggregating an interval: summing bounds across many items gives a
*range of the total*, which is wider than a properly combined interval. Say that
you summed the bounds.

**7. Multi-period requests.**
"Last 6 months" or "next quarter" means selecting several columns. Batch them into
one call. Report each period separately — never average a forecast across periods
unless the user asked for a total, and if you total it, say so.

**8. Entity not found.**
Say so. Show what values do exist in that grain column (a `distinct` read on it,
limited), and offer to search with `contains`. **Never estimate the entity's
number.**

## Output shape

Lead with the number. Then context. Then the footer.

```
Forecast for <entity>, <period>: 1,240 units
Range: 980 – 1,610 (Lower Bound – Upper Bound)

What the data says
  Operational forecast (2026-09-30 Forecast): 1,240 units
  Uncertainty range: 980 to 1,610 units
  Most recent actual (2026-07-31 Sales): 1,105 units

What to consider
  The forecast sits about 12% above the most recent actual. The range is
  wide relative to the point value, so treat 1,240 as a mid-point rather
  than a firm number.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data
  Forecast:    2026-09-30 Forecast (operational)
  Actual:      2026-07-31 Sales
  Period(s):   2026-09-30
  Caveats:     none
```

For a mixed audience: lead with a plain sentence, then the numbers. Do not bury
the figure in prose, and do not present numbers with no interpretation.

## Boundaries

Hand off rather than answering:

- accuracy, error, bias, WAPE, MAPE → **truegradient-forecast-accuracy**
- ranking by risk, "where to focus" → **truegradient-forecast-risk**
- comparing two forecast families → **truegradient-forecast-change**

Hand off to **truegradient-supply-inventory**:

- inventory (stock on hand, days of inventory, reorder, stock transfer, excess,
  stockout timing)

Out of scope entirely — say so:

- pricing and promotion (elasticity, markdown)
- building or tuning forecast models
- anything requiring another company's data

## References

- `../../references/COLUMN-SEMANTICS.md` — which forecast family to read, and
  which family the uncertainty band belongs to
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/DATA-CONTRACT.md` — column families, grain, what varies
- `../../references/COLUMN-DISCOVERY.md` — runtime discovery, the AB-class rule
- `../../references/TOOL-GUIDE.md` — tool args, errors, worked example
- `../../references/METRICS.md` — deviation sign convention (§6)
- `../../references/LOCK-FAMILIES.md` — lock families and lags, if asked for the
  locked forecast
