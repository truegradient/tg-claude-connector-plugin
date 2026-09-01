---
name: truegradient-forecast-accuracy
description: Measure TrueGradient forecast accuracy, bias, or error trend over past months — accuracy percentages computed as 1 − WMAPE, whether the forecast systematically over- or under-forecasts, and which products, categories, channels or regions are improving or worsening. Use this for "how accurate is our forecast", "what's our forecast bias", "which categories have worsening WAPE", "what's the error trend", "are we over-forecasting", "how good was last quarter's forecast". Measures only months where both actual sales and the frozen baseline forecast exist; the current incomplete month is kept out of the pooled figure but still shown as a partial month-to-date point so the direction of travel is visible. Do NOT use for a forward-looking forecast value — use truegradient-forecast-lookup. Do NOT use for ranking items by business risk — use truegradient-forecast-risk.
---

# Forecast Accuracy & Bias

Measure how good the forecast has actually been, using TrueGradient's own
formula, over only the months where that measurement is legitimate.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. The forecast side must be a **lock family** — a frozen baseline. Measuring
   against a since-edited forecast measures nothing.
   **Every figure is computed on the global lock,
   `<date> Locked ML Forecast Lag_N`** — not as a default, as the only basis.
   Never compute a metric on a secondary `Lock ...` or `Multi_Lock ...` family,
   even if the user names one; you may read and show its values, labelled as not
   the calculation basis.
   Lock families usually carry a ` Lag_N` suffix, so the leading word is the only
   reliable discriminator: anchor on the trailing space (`"Locked "` vs `"Lock "`), because
   `contains "Lock"` matches both. See `../../references/LOCK-FAMILIES.md`.
3. The actual side is **`<date> Sales`** unless the user explicitly asks for raw.
   The forecast side is the global lock — the one exception is an explicit
   **consensus** question, which uses `<date> Consensus Forecast` and must be
   labelled as not a frozen baseline. See "Consensus questions" below.
4. **Never send** `wmape`, `accuracy`, `bias`, `mape`, `mae`, `rmse` or
   `sum_columns` as aggregation functions. They are broken in this connector —
   they silently lose the actual-column argument. Compute from `sum`. See
   `../../references/METRICS.md` §0.
5. **Keep the current calendar month out of every pooled figure** — headline
   accuracy, bias, ranking. It is incomplete, so its actuals are month-to-date
   while the forecast covers the whole month; pooling it drags the number down
   for a calendar reason, not a forecast-quality reason.
   **But do not hide it.** Show it in the per-month trend as a separate point
   labelled *partial / month-to-date*, preferring a stored `<date> Accuracy`
   column when one exists. Never let it set the trend verdict on its own. See
   step 4a.
6. Exclude any month lacking either `Sales` or the chosen lock column.
   **Keep one lag only** — never blend lags into one figure — and pair the abs
   error column from the **same family and lag**. A Lag_4 error against a Lag_2
   forecast fails silently.
   **Name the family and the lag in the answer.** An accuracy figure without them
   is not an answer. If the column carries no lag token — a bare
   `Locked ML Forecast`, which is a real live form — name the family and say the
   lag is unstated in the column name. Never refuse to answer for want of a lag
   token, and never invent one.
7. **Always report the exact month window used and every month excluded, with the
   reason.** An accuracy figure without its window is not an answer.
8. **Never assign trust-zone labels** ("Critical", "Trusted", …). Thresholds are
   configured per workspace and no tool can read them. Report raw percentages.
9. Fewer than 3 eligible months → say the figure is not yet meaningful.
10. End with the provenance footer.

Full detail: `../../references/SAFETY-CONTRACT.md`

## Procedure

**1–3. Identify, pick, discover.**
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

**4. Build the eligible set — the step that determines everything.**

```
Parse every column with  ^(\d{4}-\d{2}-\d{2})\s+(.+)$

Per month, collect:
  actual    = "<date> Sales"
  baseline  = "<date> <chosen lock family>"
  absError  = "<date> <chosen lock family> Abs Error"    (optional)
  consensus = "<date> Consensus Forecast"                (optional)

  consensus is NOT the baseline. Record it; use it as the forecast side only
  for an explicit consensus question -- see "Consensus questions" below.

The lock family is FIXED — the global lock:
  classify by leading word, anchored on the space: "Locked " / "Multi_Lock " / "Lock "
  take the "Locked " family; keep a single lag
  if several global lags exist, report them, use the widest paired coverage,
    say which you used, and offer the alternatives

DROP the month if:
  - it is in the current calendar month   (→ hold it aside as PARTIAL, step 4a)
  - Sales is missing
  - the chosen lock column is missing for that month

Sort ascending → the ELIGIBLE SET.
```

Expect this to be much smaller than the number of `Sales` months. Baseline
coverage of 5 months against 24 months of actuals is normal.

**Eligible set empty?** Say no accuracy can be measured, and why — usually the
workspace has no lock columns at all, or none at the chosen lag. Do not fall back
to `Forecast`, `ML Forecast` or `Consensus Forecast` to produce a number anyway —
they are not frozen baselines. (Answering a consensus question on consensus is
step 4b; it is not a fallback for a missing lock.) Offering the user a different **lock** family that
does exist is fine, named as such.

**4a. The current month — held aside, not discarded.**

The current month leaves the eligible set but stays in the answer. Report it as a
partial data point beside the pooled figure:

- If `<date> Accuracy` (and `<date> Bias`) exist for the current month, **quote
  the stored value** — it is TrueGradient's own number, computed against this
  workspace's configuration. Label it stored, and label it partial. Do not
  recompute it into a competing figure.
- If no stored column exists but `Sales` and the lock column both carry
  current-month values, you may compute it — and must then say the actual side is
  month-to-date against a full-month forecast, so the figure reads worse than the
  month will finally settle at.
- If neither exists, say the current month is not yet measurable.

Whether a stored current-month accuracy was computed on a full-month or a
to-date basis is **not recoverable from the column name**. Say that rather than
asserting either.

Never add the partial month to `Σ err` / `Σ act`, and never include it in a group
ranking — one item's partial month against another's full month is not a
comparison.

**4b. Consensus questions.**

When — and only when — the user explicitly asks about consensus ("how accurate is
the consensus forecast", "is consensus over-forecasting", "consensus vs actuals"),
swap the forecast side to `<date> Consensus Forecast` and run the identical
procedure: same month-eligibility test with the consensus column in the lock
column's place, same formulas, current month still held out of the pooled figure
(and still shown as partial, per step 4a).

- Detect the column first. It is **absent in many workspaces** — say so rather
  than answering on a different family.
- Check for `<date> Consensus Forecast Abs Error` first — it is in the documented
  schema, though absent from both observed workspaces. Present → use it, same as
  the lock's own abs-error column. Absent → the numerator is the netted fallback
  `|Σactual − Σconsensus|`, and say that you used it.
- Consensus is **not frozen** — it can be edited after the fact, so say the figure
  is not a frozen-baseline measurement, and name the family in the answer and the
  footer.
- Show the global-lock figure alongside whenever a `Locked ...` family exists.
- **Never** use consensus because the lock is missing. A missing lock still means
  no accuracy can be measured; you may then offer a clearly-labelled consensus
  figure, but only after saying that.

Full detail: `../../references/METRICS.md` §1a.

**4c. Where the current month's actuals actually live.**

Step 4a assumes a dated column for the current month. Often there is none:
observed live, `Sales` ran 2024-08-31 to 2026-07-31 with no column for either the
current month or the one before it, while month-to-date sat in two **non-dated**
columns — `current_month_sales_tilldate` in `Final DA Data`, and
`Current Month Sales till Date` in `DOI Details`.

So before reporting a partial month:

```
if a "<current month> Sales" column exists:
    use it, labelled partial

elif current_month_sales_tilldate exists AND its sum > 0:
    use it, and say the figure is month-to-date from a non-dated column with
    no matching forecast column to pair it against

else:
    say the current month is not measurable in this dataset
```

**Check that the column is populated — do not trust its presence.** Measured live,
`current_month_sales_tilldate` was present and non-null on all 2,379 rows and
summed to **exactly 0**. Reporting it as the month-to-date actual would have
published a zero as fact. `sum` it first; if the total is 0, the column is a
placeholder in this workspace and the current month is simply not measurable —
say that rather than printing the zero. The same caution applies to
`Current Month Sales till Date` in `DOI Details`.

A month-to-date total with **no forecast column for that month** cannot yield an
accuracy figure at all — report the actual and say that plainly. And check the
gap between the last `Sales` month and today: if actuals stop two months back,
the answer's real limitation is data age, not the current-month rule. Report the
experiment's `createdAt` next to it.

**5. Read the precomputed columns — then still compute. Report both.**

If `overall_accuracy` or `rolling_accuracy` exist, read them and cite them as
precomputed: they reflect this workspace's own configuration and window. **But do
not stop here, and do not use a bare average of them as the headline.** Steps 6–10
still run. Three reasons, all measured:

- **They are not the same statistic.** On one live dataset the portfolio figure was
  `avg(overall_accuracy)` **1.47%**, volume-weighted **13.04–13.87%**, and computed
  from sums **26.38%**. A bare `avg` published as portfolio accuracy is a
  25-point error, because it weights a 3-unit SKU like a 30,000-unit one.
- **Their window is not readable.** No tool exposes it, so a stored figure cannot
  satisfy rule 6 ("name the family and the lag") or rule 7 ("report the exact month
  window"). A computed figure can.
- **Their scale is not always documented.** `overall_accuracy` and
  `rolling_accuracy` had different ranges and a median of 0 on the same rows.

So the deliverable is: **the computed figure as the headline, with its window,
family and lag** — and the stored figures quoted beside it as the workspace's own
numbers, labelled precomputed, with the note that their window is not readable and
the two are not expected to match. If they disagree sharply, say so; that
disagreement is information, not an error to hide.

Only when the lock family is missing entirely — so nothing can be computed — does a
stored figure stand alone, and then say plainly that it could not be verified
against a window you can name.

**6. Fetch the sums — one batched call.**

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "group_by": ["Category"],
  "aggregations": [
    {"function": "sum", "column": "2026-03-31 Sales",                        "alias": "a_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4",           "alias": "f_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4 Abs Error", "alias": "e_2026_03"},
    {"function": "sum", "column": "2026-04-30 Sales",                        "alias": "a_2026_04"},
    {"function": "sum", "column": "2026-04-30 Locked ML Forecast Lag_4",           "alias": "f_2026_04"},
    {"function": "sum", "column": "2026-04-30 Locked ML Forecast Lag_4 Abs Error", "alias": "e_2026_04"}
  ],
  "page_size": 1000
}
```

Omit `group_by` for one overall figure. Omit an `e_*` entry when that month has no
abs-error column. If `returned == page_size`, the result was truncated — say so.

**7. Compute.**

```
Per month m, per group:
  # No month is skipped. Pooled WMAPE sums numerator and denominator across
  # the window, so dropping a month drops its error with it:
  #   forecast 0, sold 5,000  → a 100% miss, keep it
  #   forecast 5,000, sold 0  → 5,000 into Σerr, 0 into Σact — this is what
  #                             makes accuracy negative, keep it
  act_m = |Σactual_m|
  err_m = |Σ absError_m|                   if that column exists and its sum > 0
          |Σactual_m − Σbaseline_m|        otherwise

if Σ act_m == 0:  accuracy is UNDEFINED — report it as not computable, not as 0
                  (only when the WHOLE window sold nothing)
else:
  WMAPE    = Σ err_m / Σ act_m             # textbook WMAPE / WAPE
  accuracy = (1 − WMAPE) × 100
```

Higher is better, 100 is perfect. **No cap and no floor.** Accuracy goes
**negative** whenever total absolute error exceeds total actuals — `−38.4%` means
error ran 1.384× actuals. Report the negative number and say what it means in
words; never clamp it to 0 or call it "0% accurate". A result above 100 is
impossible from this formula: if you see one, the inputs are wrong — say so
instead of capping.

**Placeholder grain values.** If a grain column carries `UNKNOWN` (or `NA`,
`Unmapped`, `Other`, empty string), that is unmapped master data, not a real
group. Measured live, `Category = UNKNOWN` held 603 of 2,379 rows and **24.9% of
one month's absolute error** against a locked forecast of 56 units on 1,370 units
of actuals. Keep the volume in the total — it is real — but always break the group
out on its own line, named as unmapped master data, and say what it does to the
figure. Portfolio accuracy for that month read 16.0% with it and 19.6% without.
Folding a mapping gap into a model-accuracy number blames the forecast for
something it did not do. See `../../references/COLUMN-DISCOVERY.md` step 4e.

**If you used the fallback numerator, say so** — netting totals lets one item's
over-forecast cancel another's under-forecast, so the figure reads slightly better
than a row-level calculation would.

**8. Bias, when asked or when it explains the accuracy.**

**Two scales — name the one you used.** The stored `<date> Bias` column is a signed
percentage error, **unbiased at 0** (verified: `Sales` 41 vs locked 21 stored as
`-48.78`). A bias you compute as a ratio is **unbiased at 100**. They differ by
exactly 100.

```
signed % error = (Σ baseline − Σ actual) / Σ actual × 100      0   = unbiased
ratio × 100    =  Σ baseline / Σ actual × 100                  100 = unbiased
                                            signed = ratio − 100
```

Prefer the signed form, because it matches the stored column and is directly
comparable with it. Measured over the 10 eligible months: ratio 78.16, signed
−21.84 — the baseline ran ~22% below actuals.

Positive = over-forecasting, negative = under-forecasting (signed scale).
Undefined if the actual total is 0 — say so, don't print zero.
Never put a stored `<date> Bias` and a computed ratio in the same table.

Full detail: `../../references/METRICS.md` §3.

**9. Trend, when asked.**
Compute accuracy per month rather than pooled, then describe the direction. Needs
at least 2 eligible months; with fewer, say a trend cannot be computed.

Prefer stored `<date> Accuracy` columns for the series when they exist — they are
the workspace's own per-month numbers. If you mix stored and computed months, mark
which is which; a step in the line caused by a change of method is not a change in
accuracy.

**Append the current month as the last point, marked partial** (step 4a). It is
usually the point the user actually wants — where accuracy is heading — so show it
and let them read the caveat, rather than ending the line a month early. State the
direction on the completed months, then say what the partial month suggests
without treating it as settled.

For "which groups are worsening": compute per-group accuracy for an earlier window
and a later window, and rank by the change. State both windows.

**10. Ranking.**
`sort_by` an aggregation alias. Remember: for accuracy, **ascending** puts the
worst first. Say which direction you sorted and what "worst" means.

## Output shape

```
Forecast accuracy has been running at 34.2% across the 5 months we can
measure — meaning roughly two-thirds of demand volume was mis-forecast.

What the data says
  Eligible months:    2026-03-31 to 2026-07-31 (5 months)
  Excluded:           19 months lacked a Locked ML Forecast Lag_4 column
  Total actuals:      412,500 units
  Total abs error:    271,400 units

Current month so far — partial, not in the figure above
  2026-08-31          41.8%   (stored 2026-08-31 Accuracy column)
  The month is 19 days in, so this is month-to-date and will move. Whether
  TrueGradient computed it on a to-date or full-month basis is not
  recoverable from the column, so read it as indicative only.

Month by month
  2026-03   28.1%      2026-06   36.9%
  2026-04   31.4%      2026-07   39.2%
  2026-05   34.0%      2026-08   41.8%  ← partial
  Direction across the five completed months is improving, about
  +11 points. The partial month is consistent with that, not proof of it.

What was calculated
  WMAPE    = 271,400 / 412,500 = 65.8%
  accuracy = (1 − 0.658) × 100 = 34.2%
  Numerator from Locked ML Forecast Lag_4 Abs Error columns (row-level),
  the same family and lag as the baseline.
  bias = (321,700 / 412,500) × 100 = 78.0 → under-forecasting by ~22%

Worst categories (ascending accuracy)
  Snacks       18.4%    31% of volume
  Beverages    29.1%    24% of volume
  Dairy        51.7%    18% of volume

What to consider
  The consistent under-forecast suggests the baseline is not capturing
  recent demand growth. Snacks combines the lowest accuracy with the
  largest volume share, so it is where a review would pay off most.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data
  Forecast:    Locked ML Forecast Lag_4 (global lock, lag 4)
  Actual:      Sales
  Period(s):   2026-03-31 .. 2026-07-31 (5 eligible months)
  Caveats:     19 months excluded for missing baseline; 2026-08 shown as
               partial (month-to-date) and excluded from the pooled figure
```

## What to say about metric names

Always print the formula beside the number.

- Accuracy here is `(1 − WMAPE) × 100`, where `WMAPE = Σ|actual − forecast| / Σ|actual|`
  is the textbook definition. Higher is better — the opposite direction from
  WMAPE and MAPE themselves, which are lower-is-better. Never let a number be read
  in the wrong direction.
- Asked for **WAPE / WMAPE**: give `Σ err / Σ act` directly, or say
  `WMAPE = 100 − accuracy` in percentage points.
- Asked for **MAPE, MAE or RMSE**: they are row-level averages and cannot be
  recovered from the batched sums, which have already collapsed the rows. Say
  that, and give WMAPE named as WMAPE. Never relabel a WMAPE figure as MAPE —
  MAPE weights every row equally regardless of volume, so the two genuinely
  disagree.

Full detail: `../../references/METRICS.md` §7.

## Boundaries

- a forward-looking forecast value → **truegradient-forecast-lookup**
- ranking by risk, prioritisation → **truegradient-forecast-risk**
- comparing two forecast families → **truegradient-forecast-change**
- inventory, supply, stock or reorder → **truegradient-supply-inventory**
- pricing, markdown or promotion → out of scope, say so

## References

- `../../references/COLUMN-SEMANTICS.md` — what each column means and which
  forecast family answers which question
- `../../references/LOCK-FAMILIES.md` — **choosing the baseline: global vs
  secondary locks, lags, and the silent pairing trap**
- `../../references/METRICS.md` — exact formulas, the broken-function list
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/COLUMN-DISCOVERY.md` — eligible-set construction
- `../../references/TOOL-GUIDE.md` — batching, truncation, errors
- `../../references/DATA-CONTRACT.md` — why coverage is ragged
