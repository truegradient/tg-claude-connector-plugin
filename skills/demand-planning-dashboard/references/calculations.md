# Calculations — source of truth

Every number on the dashboard is defined here. Function names in `code` refer to
`scripts/tg_calc.js`. "Verified" means the formula reproduces TrueGradient's stored
value on real rows (see `scripts/test_tg_calc.js`).

**Who computes it.** The page does not run these formulas. TrueGradient's server-side
`tg_dp_*` tools implement them inside the Query Engine over all rows (which tool computes
which number: `tab-tool-map.md`). This file is the written rule for tooltips, audits and
acceptance checks, and `tg_calc.js` is its reference implementation for parity tests. When
the TrueGradient app and an older line here disagree, the tools follow the app; the
differences found when the tools were checked against the app (Accuracy Deep Dive,
Nov 2026: overall, rolling, rolling aggregated, rolling bias and zone equal to 2 decimals)
are noted where they apply:
- trust-zone cut-offs are the company's configured thresholds (§4 Trust zone rule);
- single-row rolling accuracy covers the run's `past_accuracy_horizon` periods (§4);
- periods up to `activity_end_date` are scored, including the current one (§4.12).

## Contents
0. Conventions
1. Source selection (pipeline / experiment)
2. Filtering and aggregation
3. Forecast-of-record for a closed month
4. Accuracy, bias, error (Accuracy tab, Planner View) · 4.10 Granularity, compare forecasts, date window
5. Planner View
6. Top Movers
7. YoY
8. Pacing
9. Inventory Health
10. ABC / XYZ Segmentation
11. Forecast Outlook
12. Anomalies
13. Forecast by Experiment
14. Formatting rules

---

## 0. Conventions

### 0.1 Time grain — daily, weekly or monthly experiments
Experiments can be **daily, weekly or monthly**. Never assume months: read the grain from
the data. `parseColumns(columns).grain` = `detectGrain(dates)` = median gap between the
dates in `<YYYY-MM-DD> <measure>` columns: ≤ 1.5 days → `day`, ≤ 10 days → `week`, else
`month`. Everything below that says "month" means **one period of the experiment's grain**.

| | month | week | day |
|---|---|---|---|
| periods per year (`cols.perYear`) | 12 | 52 | 365 |
| LY of a period (`lyOf`) | −12 months | −364 days (same weekday) | −364 days (same weekday) |
| "Periods shown" options | 12 / 24 / All | 13 / 26 / 52 / All | 30 / 90 / 365 / All |
| Outlook horizons | 6 / 12 / 24 | 13 / 26 / 52 | 30 / 90 / 180 |
| ABC window, "next year" KPIs | last / next 12 | last / next 52 | last / next 365 |
| Rolling accuracy / bias, contribution, L3/N3 | last 3 periods | last 3 weeks | last 3 days |
| Pacing period (§8) | current month | current week | calendar month of the as-of date, from daily data |
| Runs grouped by (§13) | creation month | creation ISO week (Mon) | creation day |
| Label (`periodLabel`) | Aug'26 | Wk 30 Aug'26 | 30 Aug'26 |

- **Weekly date anchor** (`periodAnchor(cols, asOf)`): TrueGradient's current period (first
  Forecast date) contains the as-of date. If that date is on/after the as-of date the dates
  are **week ends**, otherwise **week starts**. `periodRange(p, grain, anchor)` gives the
  calendar days a period covers. Monthly dates are month ends.
- Other datasets keep **their own** grain (Supply Plan may stay monthly in a weekly run):
  detect it from that dataset's own date columns (`safetyStockUnits`/`aggregatedDays` take
  the grain).
- UI words follow the grain ("Weeks shown", "Rolling accuracy (3 wk)", "Week-end
  Accuracy", "week-to-date", "WTD"). Tooltip text from EXPLAIN is rewritten for the grain.
- Assumption to confirm with TrueGradient: for weekly/daily runs, its rolling accuracy and
  contribution windows are the last 3 **periods** (as they are for monthly).

- `A` = actual (`Sales` measure), `F` = a forecast, both for the same row and month.
- Sums are over the rows in scope **after** filters, unless stated.
- "Combo" = SKU × channel × region row of Final DA Data.
- Percentages are stored as numbers ×100 (e.g. 64.1), formatted with 1 decimal.
- Divide-by-zero → `null` (rendered "—"), never 0 or Infinity.
- Units vs Revenue: switch the dataset (`Final DA Data` ↔ `Final DA Data Value`). The
  formulas are identical. Revenue figures are labelled "$" (currency symbol configurable).

## 1.1 Run configuration — `runConfig(details)`
- **ts_id**: `series.ts_id_columns` → `setTsIdColumns`. Reconciliation adds
  `tsIdCheck(rows)`: every ts_id must be exactly one Final DA Data row; duplicates raise the
  warning "N ts_ids appear on more than one row — TrueGradient scores accuracy per ts_id".
- **Grain**: `grainFromFrequency(series.frequency)` (D/B → day, W… → week, M/MS/ME → month)
  overrides the date-spacing detection: `parseColumns(columns, {grain})`. Fallback =
  `detectGrain`.
- **Data through**: see §1.2 — the run's last update, not `activity_end_date` alone.

## 1.2 Run dates — sales are complete through the run's last update
TrueGradient refreshes experiments **daily**, so a run's sales are complete through the date
it was **last updated**, and that day counts in full (no "include run day" choice).
- `lastUpdatedDate(exp)` reads the connector's last-update field under any of `UPDATED_FIELDS`
  (`updatedAt`, `updated_at`, `lastUpdatedAt`, `last_updated_at`, `modifiedAt`, …) from the
  roster entry or `tg_experiment_details.experiments[].experiment` (copy it onto the roster
  entry). `prepareRoster` keeps it as `lastUpdated`.
- `asOfDate(exp)` = last-updated date, else creation date. The badge's "as of", the current
  period, prior-run and run-month logic all use it.
- `dataThroughDate(exp, cfg)` = the **latest** of last-updated date, creation date and
  `activity_end_date` → `{date, source}`; this is pacing's `dataThrough` (elapsed = days from
  the period start through it, inclusive). The UI names the source: "the run's last update",
  "run date — the connector doesn't provide the last-update time", or "TrueGradient
  activity end date".
- **Connector gap (observed):** the roster and `tg_experiment_details` currently return only
  `createdAt` — no last-update field — so the page falls back to the run date. Once the
  connector adds one, nothing in the page changes.
- **Comparing runs**: `setupDiff(a, b)` lists ts_id / frequency / target differences;
  Forecast by Experiment flags such runs as not like-for-like.
- **Metric**: TrueGradient's configured accuracy metric is WMAPE, i.e. the bottom-up WAPE
  used here (accuracy = 1 − WMAPE).
- Shown to the viewer in the source drawer as "Run setup".

## 1. Source selection — `pickDefaultSource(experiments)`

```
live = experiments.filter(e => e.isArchive !== true)   // LIVE = NOT ARCHIVED
pool = live.length ? live : experiments          // fallback: nothing live (archived-only roster)
pipelines = unique(pool.map(e => e.tag || "Untagged")) in roster order
defaultPipeline = pool[0].tag                    // roster is newest-first → newest live run's pipeline
defaultExperiment(pipeline) = live production run in that pipeline (isProduction true)
                              else newest e in pool with e.tag === pipeline
result = { pipeline, experimentId, isLive, isProduction, anyLive, multiPipeline: pipelines.length>1 }
```
- **Live means `isArchive: false`, nothing else.** `isProduction` is a separate TrueGradient
  flag ("Production"): it never makes a run live or not live. It is only used to pick the
  default run inside a pipeline, and is shown as its own "Production" label.
- Pipeline selector is shown only when `multiPipeline`.
- A viewer override (`localStorage["tgdp.source"] = {pipeline, experimentId}`) wins if
  that experiment still exists in the roster; otherwise fall back silently to default
  and show a one-line "Saved source no longer available — showing default".
- "Previous run" (for Forecast by Experiment and forecast-of-record) = the next older
  experiment in the roster with the **same tag** (any isProduction).

**Roster preparation** — `prepareRoster(experiments, usedArchivedFallback)` sorts newest
first and sets `isLive = isArchive !== true` on every run (archived runs are never live;
`isProduction` stays the raw flag, also copied to `tgProduction`). In an archived-only roster
nothing is live and full inventory-optimization runs come first. Call it before
`pickDefaultSource`.

## 2. Filtering and aggregation

Global filters are **per Final DA Data dimension column** (see tabs.md "Filter bar and
Settings" for which columns qualify and their order). `product_variant_code` is a
type-ahead: free text matches `product_variant_code`, `variant_name`, `product_name`
case-insensitive contains; picking a suggestion filters that exact code. Every other
dimension is a searchable multi-select on its own column (exact value match; empty value
shown as "—"). `channel_name`, `Region_name`, `product_category` feed
`tg_calc.applyFilters` as platforms / regions / categories; other columns are applied as
`column ∈ values`. Labels shown to the viewer are column labels, never "SKU",
"Platform", "Region" or "Category". "Months shown"
(Last 12 / Last 24 / All) limits **history** months in charts and tables; it never
changes accuracy windows (those are fixed by the locked window).

`aggregateSeries(rows, measure, months)` = Σ over rows of `num(row[month+" "+measure])`
per month, treating null as 0 **only when at least one row has a value** for that
month (else null).

## 3. Forecast-of-record for a closed month m — `forecastOfRecord`

Used whenever a closed month needs "the forecast" (Top Movers, Month-end Accuracy,
streaks, Pacing for a past month). In priority order:
1. `Locked ML Forecast Lag_1` for m in the current experiment (label "Lag-1 locked").
2. `Forecast` for m in the most recent **older** experiment of the same pipeline whose
   `createdAt` month is before m (label "Consensus from run <label>"). Requires the
   Forecast-by-Experiment loader; join on comboKey.
3. Otherwise null → row shows "No forecast on record" and is excluded from rankings.
The label of the source used is shown in the table header.

## 4. Accuracy, bias and error

Row level, one month: `err = |F − A|`.
- `accuracy(F, A) = (1 − |F − A| / A) × 100` when A > 0.
  A = 0 and F = 0 → 100; A = 0 and F > 0 → 0 (flag "no sales").
  Negative values are kept (TrueGradient does), display min −999.
- `bias(F, A) = F / A × 100` (100 = unbiased, >100 over-forecast, <100 under).
  A = 0 → null.

Aggregate over a set S of (row, month) cells — **bottom-up WAPE**:
- `wapeAccuracy = (1 − Σ|F−A| / ΣA) × 100`
- `aggBias = ΣF / ΣA × 100`
- Optional toggle "Aggregate first": compute `accuracy(ΣF, ΣA)` per month instead.
  Label it "Aggregated accuracy (errors net out)".

**Stored-field equivalences (verified):**
- `overall_accuracy` = `wapeAccuracy` over all `lockedMonths` for that row with
  F = Locked ML Lag_1. Example (ITEM-C1 / Social): Σerr 6,194, ΣA 10,101 → 38.68 ✓.
- `rolling_accuracy` = WAPE over the last `past_accuracy_horizon` locked periods for that row
  (the tools and the app). On a run whose horizon is 1 that is the latest locked month only —
  Example: Aug F 1,214, A 2,704 → 44.90 ✓. Weekly run with horizon 3: SKU ITEM-X,
  errors 34 + 17 + 63 over Sales 109 + 110 + 118 → 66.17 = stored ✓.

**Grain.** ts_id = one Final DA Data row (product_variant_code × channel_name ×
Region_name in the reference runs — a product × channel pair can have several region
rows, each with its own forecast). Aggregates are WAPE over (row × month) cells of the
rows in scope: `wape(lockedCells(rows, months))`. Never sum rows to a coarser level
before taking errors for any headline number.

**Aggregate rolling accuracy** = `wape(lockedCells(rows, last 3 locked months))`.

**Validated against TrueGradient's all-level report** (live run, 681 rows, no filters):
monthly WAPE Mar–Aug 9.94 · 5.94 · −3.65 · −15.56 · −50.18 · −58.73; overall (Mar–Aug)
1 − 240,628 / 211,939 = −13.54; rolling (Jun–Aug) 1 − 110,284 / 77,003 = −43.22;
rolling bias 107,217 / 77,003 = 139.24 — all equal to the report. A second run reproduced
the same way (−1.57 overall, −8.04 rolling, 68.64 bias). Use the stored
`… Locked ML Forecast Lag_1 Abs Error` columns with a computed `sum` to cross-check
quickly: Σ of that column = Σ|F − A| for the month.

**Functions.** `accuracySummary(rows, allRows, cols)` returns the whole report row:
`{combos, contribution, overall, rolling, rollingAggregated, rollingBias, months[{month,
accuracy, bias, absError, actual, forecast}], window, rollingWindow, sums}`. Planner View
(aggregate), the Accuracy KPIs and every row of the Accuracy summary table call it.
`rollingAccuracy3(rows, cols)` and `rollingBias3(rows, cols)` give the same rolling values.

### 4.9 Reconciliation with TrueGradient (runs on every load, unfiltered rows)
The tools run this check on the server: `tg_dp_accuracy_summary {reconcile: true}` returns
`reconcile {rowsInRun, ok, months [{period, recomputed, stored, ok}]}`.
- **Row count**: rows scored (`combos`) = the run's row count (`tg_dp_context.datasets
  ["Final DA Data"].rows`); else "the run may have changed while loading".
- **Stored error**: per locked month, Σ|F − A| recomputed = Σ stored
  `<m> Locked ML Forecast Lag_1 Abs Error` (tolerance ½ unit per row). Verified on live
  rows: the stored column is |Locked Lag-1 − **Sales**| (not Raw Actual).
- **Stored row accuracy**: each row's stored `overall_accuracy` / `rolling_accuracy` equals
  `overallAccuracy` / `latestMonthAccuracy` within 0.05. TrueGradient stores **nan** when
  the denominator is zero (Σ Sales = 0 over the window, or latest-month Sales = 0); nan is
  skipped, never compared. **Informational only — never raises a warning**: TrueGradient's
  stored row values can differ for a few rows (3 of 532 on the live run, e.g. stored
  −42.1 vs −47.4) without affecting any aggregate, which is built from Sales and Locked
  Lag-1 directly and is verified by the stored-error check.
- Functions: `reconcileAbsError(rows, cols)`, `reconcileRowAccuracy(rows, cols, tol)`.
- UI: one line "✓ Matches TrueGradient: …" above the KPIs. A warning box (with "Reload
  data") appears only when the row count or a month's stored error differs.

**Rolling aggregated accuracy** (TrueGradient report column; definition not yet
confirmed with TrueGradient): working definition = per row, Σ F and Σ A over the last 3
locked months first, then `wape` across rows. Shown in the Accuracy summary table with
an ⓘ saying it is a working definition. It must lie between rolling accuracy and the
total-first accuracy. Confirm with the user before treating it as verified.

Dashboard labels: "Overall accuracy" and, for a selection, "Rolling accuracy (3 mo)";
for a single row, "Rolling accuracy" (stored, latest locked month). Qualifier text names
the grain: "WAPE at ts_id (each Final DA Data row) · <window>".
For a single combo show stored values; for a selection show recomputed WAPE.

**Rolling bias (3 mo)** = aggBias over the last 3 locked months.

## 4.10 Granularity, compare forecasts, date window, trust chips, drops

**Granularity** (`normalizeGranularity`, `granularityKey`, `granularityParts`, `groupByGranularity`)
decides how rows are **grouped** for a tab's tables and charts. Values:
- `[]` = **Overall** (all filtered rows, one group "All");
- `[TS_GRAN]` (`"@ts_id"`) = **each ts_id** (one Final DA Data row, key = `comboKey`); exclusive;
- Any number of Final DA Data columns (no limit, as the app), combined: key = values joined `" | "`,
  blank → "—". Any dimension column qualifies (tabs.md "Filter bar and Settings"), not only ts_id columns.

**Table rows stay at ts_id.** Inside every group, numbers are computed bottom-up at the ts_id grain:
each row × period is scored on its own and errors are summed (`accuracyReport` → `lockedCells` →
`wape`). So Σ group abs error = total abs error and the headline KPIs are identical at every
granularity for the table. The table's "total-first" number is the labelled **Aggregated
accuracy (errors net out)** = `wape` of per-period group totals.

**Compare forecast** (`forecastMeasures(cols)`): every measure whose name matches
forecast|budget|lock (not abs error / deviation / accuracy / bias / YoY / bound / offset) and that
has **closed** periods (dates also in history). Order: `Locked ML Forecast Lag_1`, other locked
lags by lag number (e.g. `Lock ML Forecast Lag_3`), Consensus, then others (e.g. `Budget`).
Each forecast is scored only on its own closed periods. The first selected forecast drives the
KPI tiles (default Locked Lag-1, which reproduces TrueGradient's report).

**Locked ahead.** Some runs carry `Locked ML Forecast Lag_1` for open/future periods (`cols.lockedAhead`).
Those are never scored (Sales there is 0 or missing): `cols.locked` = locked dates that are also
history dates. If a run has only locked-ahead columns, Accuracy says nothing can be scored yet.

**Date window** (`periodWindow(periods, from, to)`, inclusive): limits every metric to periods in
[From, To]. Rolling = the **last `T.ROLLING_N` (3) periods of the window**, in the run's grain
(3 months / weeks / days). Default = the full closed window (matches TrueGradient).

**`accuracyReport(rows, allRows, cols, {measure, window})`** → `{measure, combos, contribution,
overall, bias, rolling, rollingAggregated, rollingBias, aggregated, months[], window,
rollingWindow, sums}`. With defaults it equals `accuracySummary` (tested).
**`granularReport(rows, allRows, cols, {by, measures, window})`** → one entry per group with a report
per compared forecast, sorted by contribution desc.
Single-row groups (ts_id granularity): the **Rolling accuracy** cell shows the latest period's
accuracy (= stored `rolling_accuracy`); groups of 2+ rows show 3-period WAPE.

**Trust-zone chips** (`trustZoneSummary(rows, cols, col)`): per stored `trust_zone`, ts_id count
and contribution (Σ Sales of the last 3 closed periods ÷ scope total; sums to 100). Order
`TRUST_ORDER` (Highly Trusted, Trusted, Review, Planner Review, Low Trust, Critical, Not
Available). Scope = filtered rows ignoring the trust-zone filter itself; ticking a chip sets the
`trust_zone` filter for every tab.

**Accuracy drops** (`accuracyDrops(values, minDrop = T.DROP_PTS = 10)`): index i is a drop when
value[i] is ≥ 10 points below value[i−1] and is a local low (≤ value[i+1] or last). Charted as ▼.

## 4.11 Accuracy at a level, trust zones at a level

**Level accuracy** (`levelCells`, `levelReport(rows, allRows, cols, {by, measure, window})`) is
what the Accuracy KPI tiles show:
- Overall or ts_id → identical to `accuracyReport` (TrueGradient's headline, each ts_id scored on
  its own).
- Column granularity → for each group g and period p: F_g,p = Σ F, A_g,p = Σ A over g's rows that
  have both; then overall = `wape` over all g × p cells of the window, rolling = over the last 3
  periods, rolling bias = ΣF ÷ ΣA (the same at every level). Groups scored = groups with ≥ 1 cell.
  The tile also prints the ts_id value ("· ts_id 25.5%").
- Example: two ts_ids of one customer forecast 150 and 50 against 100 each → ts_id accuracy 50%,
  customer level 100% (errors net out inside the customer).

**Trust zone rule** (`TRUST_CUTS`, `trustZoneOf(acc)`), verified: every stored `trust_zone` of the
live US run (622 rows with a zone) equals `trustZoneOf(stored rolling_accuracy)`, incl. edges 80.0,
70.03, 60.0, 40.05, 20.0, 19.72:

| rolling accuracy | zone |
|---|---|
| ≥ 80 | Highly Trusted |
| 70 – < 80 | Trusted |
| 60 – < 70 | Review |
| 40 – < 60 | Planner Review |
| 20 – < 40 | Low Trust |
| < 20 (incl. negative) | Critical |
| none (no sales in the window, stored nan) | Not Available |

These are the defaults. A company can configure its own cut-offs
(`scenario_plan.trust_zone_thresholds`: highly_trusted, trusted, review, planner_review,
low_trust); the app and the tools use them when set — e.g. 70 / 50 / 40 / 30 / 20 — with
"Highly Trusted" for accuracy above the first cut. `tg_dp_trust_zones.thresholds` returns
the ones in force; the page shows them in the chips' note and never hard-codes cut-offs.

**Zones at a granularity** (`granularTrust(rows, cols, {by, measure, window})`):
- Overall / ts_id → each ts_id's stored `trust_zone` (fallback `trustZoneOf(rolling_accuracy)`);
  chips count ts_ids and toggle the global `trust_zone` filter (every tab).
- Column granularity → each group's zone = `trustZoneOf` of the group's level rolling accuracy
  (group totals vs Sales over the last 3 periods of the window). Chips count **groups** (tooltip:
  ts_ids inside), contribution = Σ Sales last 3 closed periods of those groups ÷ scope; ticking
  filters this tab's groups (tiles, chart, table). The report table's "Trust zone" column shows the
  same zone; the "All in filter" row shows the zone of the total's rolling accuracy.

**Top Movers at any granularity**: `topMovers(rows, m, {by})` groups by the granularity; A, F and
LY are sums over the group's rows that have a forecast-of-record (as §6).

## 5. Planner View

- Selection = filtered rows (single ts_id when one product_variant_code, channel_name
  and Region_name are chosen in the global filters; no separate pickers on the tab).
- KPI cards: Overall accuracy, Rolling accuracy (3 mo) (single row: stored rolling_accuracy), Rolling bias (3 mo),
  Contribution (§5.1), Trust zone (single combo: stored; aggregate: share of volume
  by zone as a mini bar), pattern badges (`sales_pattern_category`,
  `forecast_pattern_category`, most common in selection).
- Chart series (monthly): Actuals (`Sales`, history only), Raw Actual (off by default),
  LY Sales (history: Sales[t−12]; future: stored LY Sales), Locked ML Lag-1,
  ML Forecast, Consensus Forecast (`Forecast`), RL Unconstrained (off by default),
  P10–P90 band (shaded). Vertical line at currentMonth.
- Monthly metrics table rows: Consensus Forecast, ML Forecast, Locked ML Lag-1,
  RL Forecast, RL Unconstrained, Graph Reviewed, Table Edited, P10, P50, P90,
  LY Sales, Consensus YoY % = (F − LY)/LY × 100, Actuals (Sales), Raw Actual,
  Actual − Locked (closed months) = A − Locked, Locked accuracy (closed months).
  Current month column header "<Mon'YY> (MTD)".

### 5.1 Contribution (verified)
`contribution(selection) = Σ Sales over the last 3 closed months for the selection
÷ Σ Sales over the same months for ALL rows of the dataset × 100`.
Stored `% Contribution Last 3 Months` matches (e.g. 6,434 / 155,789 = 4.13 ✓);
all rows sum to 100.

### 5.2 AB class (verified)
Rows sorted by contribution desc; cumulative share ≤ 80% → A, rest → B
(stored A rows sum to 79.9%). Use stored `AB_Class` per row.

## 6. Top Movers

Inputs: month m (default `latestClosedMonth` that has a forecast-of-record), Top N
(5/10/25), grain (By SKU | By SKU × Platform × Region).
- Per grain group: `A = Σ Sales[m]`, `F = Σ forecastOfRecord[m]` (rows without a
  forecast excluded from both sums), `LY = Σ Sales[m−12]`.
- `deviation = A − F`; `deviation% = deviation / F × 100` (F = 0 → null, shown "new").
  Matches screenshot logic: 5,514 − 4,024 = +1,490, +37.0% ✓.
- Over-performers: top N by deviation desc with deviation > 0.
  Under-performers: top N by deviation asc with deviation < 0.
- **Streak** (`streak`): starting at m and walking back up to 3 months (m, m−1, m−2),
  count consecutive months where sign(A − F) equals sign at m; stop at the first month
  with no forecast-of-record or a different sign. Show "▲ Nmo"/"▼ Nmo" for N ≥ 2,
  "—" for 1.
- Diverging bar chart: over-performers then under-performers, value = deviation.
- Row click → breakdown of that SKU by channel × region with the same columns.

## 7. YoY

- History months t: `TY = Σ Sales[t]`, `LY = Σ Sales[t−12]` (null if t−12 not loaded).
- Forecast months t: `TY = Σ Forecast[t]`, `LY = Σ stored LY Sales[t]`.
- Current month: TY = Forecast (full month), with MTD shown as a separate marker.
- `YoY% = (TY − LY) / LY × 100`.
- YTD: calendar year of `latestClosedMonth`, months Jan..latestClosed; LY-YTD the same
  months a year earlier. `YTD YoY% = (ΣTY − ΣLY)/ΣLY × 100`.
- Leaders/laggards: by SKU, `L3M` = last 3 closed months vs same 3 months LY;
  `N3M` = next 3 forecast months vs stored LY. Rank by absolute change; require
  LY ≥ 50 units (or $500) to avoid tiny-base noise.

## 8. Pacing

**Three dates — pacing is measured at data-through, never at today.**
- *Data through* = last day with sales in the run = `dataThroughDate(exp, cfg)` (§1.2: the
  run's last update, inclusive). Elapsed days, expected share, banked, pace index, projection
  and gap all use it.
- *Run date / last updated* = `asOfDate(exp)` (the badge's "as of").
- *Today* = the viewer's date (UTC). Passed as `today` to `pacing` / `pacingDaily`; it fills
  `result.clock = pacingClock(...)` = {todayDay, todayInPeriod, todayAfterPeriod, dataLagDays,
  stale} and **never changes a number**. Pacing against today with sales that stop earlier
  would make everything look behind (example: data through 1 Nov, today 9 Nov, 4,800 of
  81,000 sold → right 1 of 30 days, index 1.78; wrong 9 of 30 days, index 0.20).
- UI: chart marks **dashed "Data through <date>"** and **solid "Today <date>"** (when today
  is inside the period); the subtitle says "Expected by <data-through>"; the summary lists
  "Sales data through" and "Today · data N days old"; when `dataLagDays > PACE_STALE_DAYS`
  (2) a notice says "Sales data runs through <d>, N days before today … the next TrueGradient
  run moves it forward"; when today is after the period, the notice says the run's period has
  ended and to pick a newer run. Never label the data-through line "Today".

**Monthly and weekly experiments** have one total per period, so pacing uses the
period-to-date total, not a daily curve (`pacing({…, grain, anchor})`; the period is the
current month or the current week; `D` = days in that period; the weekly week runs over
`periodRange`). The rules below are written for months and apply to weeks unchanged.

**Daily experiments** have real daily sales, so they pace the **calendar month that contains
the as-of date** from the days themselves (`pacingDaily(rows, cols, asOf, {priorIndex,
includeRunDay})`):
- plan of a day = its forecast-of-record if the day is closed (Locked Lag-1, else the prior
  run's Forecast), its Forecast if not; days with no plan count 0 and are reported;
- elapsed days = every day of the month up to and including `dataThrough` that has sales
  (closed days, and the current day whose Sales column holds its sales);
- expected share = Σ plan of elapsed days ÷ Σ plan of the month (the forecast shapes the
  curve — no flat calendar, no manual weights);
- banked % = Σ actual of elapsed days ÷ Σ plan of the month × 100; pace index = banked ÷
  expected = actual to date ÷ plan to date; projected = actual to date ÷ expected share;
- cumulative chart draws the **real** cumulative actual against cumulative plan.

Monthly / weekly detail:
- `asOf` = `asOfDate(exp)` (last update, else creation date).
- Month default = currentMonth. `D` = days in month.
- `elapsed = days from the period start through dataThrough, inclusive` (0–D). Always pass
  `dataThrough`; the legacy fallback inside `pacing` (day before the run) is only for callers
  without a run. Show "Sales data through <date> · <source>".
- `MTD = Σ Sales[currentMonth]`, `MF = Σ Forecast[currentMonth]`.
- `banked% = MTD / MF × 100`.
- Expected share today:
  - flat: `exp = elapsed / D`;
  - **default weights:** when the period contains Black Friday (US: the day after the 4th Thursday of
    November — 2025-11-28, 2026-11-27, 2027-11-26), that day gets w = 10 (`BF_WEIGHT`), every other day 1, so
    the expected curve steps up at Black Friday instead of a flat line. Saved weights replace the defaults
    entirely; a saved `{}` = flat calendar chosen on purpose; deleting the saved weights brings the defaults back.
  - weighted (if planner saved day weights w_d, default 1, promo days e.g. 3):
    `exp = Σ_{d≤elapsed} w_d / Σ_{d≤D} w_d`.
- **Inventory cap (current monthly / weekly period; control "Inventory cap: Off · On hand (default) · On hand +
  in transit").** A series can't sell more than it has, so pacing runs against a **target** instead of the raw
  forecast: per series, `available = MTD sold + on hand now (DOI Details Stock_On_Hand) [+ In Transit]`,
  `target = min(forecast, available)`; series with no inventory record keep their forecast; the period
  target = Σ per series (`constrainedTarget`). Join: exact series when DOI's item × location are the run's ts_id
  columns (e.g. sku_standard × Channel); item level when inventory has the item only or a location that isn't
  a ts_id column (forecast and stock summed per item, then capped); otherwise unavailable (note shown).
  Banked = MTD ÷ target, expected curve = target × share(d), pace index and projected use the target; two gaps
  are shown — gap to target = projected − target and gap to forecast = projected − uncapped forecast; when
  every series has inventory the projection is capped at Σ available. Closed periods and daily runs are not
  capped (inventory is today's snapshot).
  Example: forecast 3,000 (A 2,000 / B 1,000), sold 700 (A 400 / B 300), on hand A 800 / B 2,500 → target
  1,200 + 1,000 = 2,200; on day 10 of 30 (expected 33.3%) banked 31.8%, index 0.95 On (vs 0.70 Behind uncapped).
- `paceIndex = banked% / (exp × 100)`.
- Status: < 0.85 Behind · 0.85–0.95 Near · 0.95–1.05 On · > 1.05 Ahead.
- Projected month-end `= MTD / exp`; gap to forecast `= projected − MF`.
- Gauge: 0–150% scale of banked%, needle = banked%, marker = exp×100; coloured bands
  relative to the marker: [0, 0.85·exp) behind, [0.85·exp, 0.95·exp) near,
  [0.95·exp, 1.05·exp] on, (1.05·exp, 150] ahead.
- Cumulative chart: Expected cumulative `MF × share(d)` for d = 1..D (full month);
  Actual drawn as a single straight segment from (0,0) to (elapsed, MTD) and labelled
  "MTD total (no daily data)". Don't fabricate daily actuals.
- Past month selected: banked = A / forecastOfRecord, exp = 100%.
- Breakdown table (by Platform, Region, Category, SKU): MTD, MF, banked%, paceIndex,
  projected, gap, status; sort by |gap|.
- Revenue context line: MTD and MF from the Value dataset regardless of toggle.

## 9. Inventory Health (DOI Details, Supply Plan, Stock Transfer)

Use stored TG fields; aggregate by summing quantities and values.
- Status = `Stock_Risk_Level`. Counts per level (bar chart), ordered
  StockOut, CriticalStock, LowInventory, Stable, ExcessStock.
- KPI tiles: Stock on hand (Σ`Stock_On_Hand`, Σ`soh_value`), Reorder now
  (Σ`updated_TG_Reorder_now`, Σ`Reorder_now_value`), Excess (Σ`updated_Excess_Stock`,
  Σ`Excess_Stock_value`), Dead stock (Σ`Dead_Stock`, Σ`Dead_Stock_value`),
  Potential lost sales (Σ`Final_Potential_Sales_Loss`, Σ`Potential_Sales_Loss_value`),
  SKUs with projected stock-out (count `OOS_Episode_Count` > 0) and
  Σ`Total_Projected_OOS_Days`.
  Note: `Potential_Sales_Loss_value` is priced on raw loss; show units from
  `Final_Potential_Sales_Loss` and value from `Potential_Sales_Loss_value`, and say
  "value before transfers" in the tooltip.
- Reorder now flag: `updated_TG_Reorder_now > 0` and `TG Reorder Date ≤ asOf`.
- Coverage (aggregate) = Σ(SOH) ÷ Σ(`Forecast_Per_Day`) days. Row level: stored
  `DOI_Current_Stock` (on-hand only) and `Days on Inventory` (incl. pipeline).
- Warehouse & Region view: group by baseWarehouse and region (data-model §7) and by
  allocation suffix (platform). Same sums as tiles + risk counts.
- Supply plan chart (one SKU × warehouse, or summed): bars Total Inbounds,
  line End Inventory, line Forecast, dashed line safety stock units =
  `Safety Stock Days × Forecast/days-in-month`. Identity check per month:
  `End ≈ Beginning + Total Inbounds − Forecast` (floor 0); flag months off by >1 unit.
- Transfers: table from Stock Transfer; summary Σ by From_Facility → Warehouse.
- Projected OOS timeline: parse `OOS_Episode_Details` into start/end/days bars.

## 10. ABC / XYZ Segmentation

- Grain: SKU (default) or combo. Window: last 12 closed months (fewer if less history).
- Value basis: Units or Revenue (global toggle).
- ABC (`abcClassify`): sort by window total desc; cumulative share before adding the
  item < A-cut → A; < B-cut → B; else C (the item that crosses a cut stays in the higher class). Defaults A-cut 80%, B-cut 95% (editable).
- XYZ (`xyzClassify`): CoV = population std / mean of the window's monthly values.
  X ≤ 0.5, Y ≤ 1.0, Z > 1.0; mean = 0 → "No demand".
- Matrix 3×3: item count and share of value per cell. Pareto chart (cumulative %).
- Table shows recomputed ABC-XYZ next to stored `AB_Class` and `cluster` at combo grain,
  with a "differs" marker. Stored `cluster` letters follow the same A/B/C × X/Y/Z idea.

## 11. Inventory level (Inventory Planning tabs)

Inventory keeps its own level; it is never regrouped by the forecast granularity.
- `aliasMap` for DOI Details / Supply Plan / Stock Transfer: `component_sku` ← component_sku, else
  the 1st ts_id column; `Warehouse` (location) ← Warehouse / Location / To_Facility, else the **2nd ts_id
  column** (e.g. Channel). `Fulfillment Node` is not a location (it was the cause of "Manufacturer" as
  the only warehouse and of "Web store → undefined" transfers).
- Location kind: "warehouse" (column Warehouse/Location → warehouse allocation to region/channel
  applies) | "dimension" (e.g. Channel; no region mapping) | none (item-level inventory).
- **Aligned with the organisation's inventory (DOI) report SQL** (validated column by column):
  | Column | Report | Dashboard |
  |---|---|---|
  | On hand, In transit, Open PO, Reorder now, Sales 7 / 30 days | SUM over the rows of the group | same (`INV_SUM`) |
  | Forecast next 30 / 60 | forecast file, first / first two future months (`fc_30`, `fc_60`) | **Supply Plan** `Forecast` variable, first / first two dated months, per item × location, summed (`supplyForecastNext`); forecast per day × 30 / 60 only while the Supply Plan is still loading (the ⓘ says which) |
  | Days on Inventory, DOI current stock (roll-up) | rank rows by SOH; 2nd < 70% of 1st (or none) → 1st row's value, else average of top two | same (`doiTopNodes`), never summed or recomputed; at the native location level the stored values |
  | Grain | component SKU × base warehouse (suffix `_SH_Sub/_SH/_CS/_IO/_FBA/_TT` removed) | Inventory level "<item> × base warehouse" (`inventoryByBase`) when locations are real warehouses with suffixes; also "<item> × location" (native) and "<item> only" (`inventoryByItem`, same rules) |
  | Cost price | product master `cost_price` (MAX) | DOI `COGS` / `AVG COGS` (the connector has no product master) |
  | Rows | `variant_name <> 'UNKNOWN'` only | all rows (tiles and other tabs must reconcile with TrueGradient); filter UNKNOWN with the global filters if needed |
  | Order | Stock on hand desc | contribution % desc (on-hand sort one click away) |
  DOI 7 / 30-day sales are dashboard additions (on hand ÷ actual daily sales), not in the report.
- `inventoryRollup(rows, keyFn, fill)`: the shared roll-up — quantities, values and sales summed; Days on
  Inventory and DOI_Current_Stock by `doiTopNodes`; worst risk (RISK_ORDER); earliest OOS and reorder dates;
  longest lead time; `_locations` = member locations; `_nodes` = rows the DOI came from.
- `pivotSupplyPlanByItem(rows)`: Supply Plan variables summed over locations; "Days …" variables left
  out (aggregated DOI = Σ End Inventory ÷ Σ (Forecast ÷ days), §9).
- Stock Transfer lane = `From_Facility → <location>`.

## 11b. Forecast Outlook (Forecast › Outlook)

- Horizon selector 6 / 12 / 24 months from currentMonth.
- Series totals per month: Consensus Forecast, ML Forecast, RL Unconstrained, LY Sales,
  P10 and P90 band.
- Band caveat (show it): Σ of row-level P10/P90 is wider than the true interval of the
  total; label "summed quantiles".
- Planner/RL uplift = (Σ Forecast − Σ ML Forecast) / Σ ML Forecast × 100.
- Override share = rows where Graph Reviewed or Table Edited ≠ ML Forecast in any
  horizon month (|diff| ≥ 0.5) ÷ rows.
- Quarter table (calendar quarters) with growth vs LY; breakdown by category, platform,
  region; mix of `forecast_pattern_category` by forecast volume.

## 12. Anomalies (`detectAnomalies`)

Evaluated per combo; thresholds are constants at the top of tg_calc.js.
| Code | Rule | Severity |
|---|---|---|
| SPIKE / DROP | latest closed month z = (A − mean₆)/std₆ over the prior 6 closed months; z ≥ 2.5 spike, z ≤ −2.5 drop; mean₆ ≥ 10 | by importance |
| CLEANED | Sales ≠ Raw Actual (> 0.5) in any of last 6 closed months, or Imputation Flag = 1 | Info |
| CLIFF | first forecast month ÷ mean of last 3 closed months < 0.5 or > 2.0; mean ≥ 10 | by importance |
| TO_ZERO | mean last 3 closed ≥ 10 and Σ next 3 forecast months = 0 | High |
| NO_HISTORY | Σ last 6 closed = 0 and Σ next 3 forecast > 0 and Lifestage not New* | Medium |
| SWING | any adjacent forecast months with \|F_t/F_{t−1} − 1\| > 1.0 while stored LY ratio is within ±50% (or LY missing), F_{t−1} ≥ 10 | Medium |
| ACCURACY | AB_Class A and (rolling_accuracy < 0 or overall_accuracy < 30) | High |
"By importance": High if AB_Class A or contribution ≥ 1%, else Medium.

## 13. Forecast by Experiment — comparing runs

Purpose: the consistency of the forecast and of its accuracy across planning cycles.

- **Which runs.** The current source run is always compared. The viewer adds up to 5 more
  (6 in all) from every completed run — live **and archived**
  (`tg_list_experiments_for_analysis` with `include_archived: true`, loaded when the tab opens;
  merged with the live roster). Scope "This pipeline" (same tag) or "All pipelines".
- **Frequency.** `runFrequency(label, cfgGrain)`: the run's configured grain
  (`tg_experiment_details`, fetched for the pool in one batched call), else a hint from its
  label (…_Monthly / …_weekly / …_daily). The add list is filtered by frequency, default = the
  current run's; "All" lists every run; unknown-frequency runs are always listed.
  "+ Previous <frequency> run" adds the newest older run of the current frequency.
- **Forecast as of** per run, default = `created_at` date; editable (date input, Reset). It is
  the origin for lags. Saved per current run in `localStorage["tgdp.expCmp.<current id>"]`
  = `{ runs: [ids], dates: {id: date}, base: id }`.
- **Comparison grain** = `coarsestGrain` of the compared runs. Finer runs are summed into it by
  period-end date (`rollupPeriod`: month → month-end; week → the week-ending Sunday;
  `rollupSeries`). Actuals (current run's Sales, dates ≤ activity end) roll up the same way;
  a rolled period is closed when its end ≤ the last closed date. A mixed comparison says so.
- **Reads.** Per run one computed read: `group_by` = the granularity's columns, `sum` of every
  `<date> Forecast` column, active filters as server `filters`. Runs lacking a granularity
  column are left out with a note; 1,000-group truncation is flagged.
- **Chart:** total forecast by target period, one line per run (current solid, others dashed,
  swatch colours match the runs table), actual Sales overlay.
- **Consistency** (`forecastConsistency`): per target period forecast by ≥ 2 runs —
  spread = (max − min) ÷ mean × 100, CoV = sd ÷ mean × 100. Tiles: median spread over the next
  12 open periods, least consistent target, runs compared. Table: period × run totals, actual
  (closed periods), spread, CoV; spread > 25% flagged.
- **Revisions:** current vs a **baseline** run (default the newest run older than the current;
  picker when > 1). Per group Σ forecast over the next 3 open periods both runs forecast; Δ, Δ%.
- **Accuracy of each run by lag:** for every compared run and every closed period m it
  forecast, lag = `lagBetween(as-of, m, grain)` (skip negative); WAPE across groups of
  |F_run − A_current| at that lag, plus "All lags" WAPE over all its scored cells.

## 14. Formatting

- Units: integer with thousands separators; ≥ 100k → "123.4k" in charts only.
- Revenue: currency, 0 decimals; ≥ 1M → "$1.23M" in tiles/charts.
- Percent: 1 decimal, signed for deltas (+3.4%).
- Accuracy colour: ≥ 85 good, 70–85 neutral, < 70 warn, < 0 bad.
- Bias colour: 90–110 neutral, > 110 over (orange), < 90 under (blue).
- Deviation colour: positive mint, negative orange.



### 4.12c Forecast Data fallback — runs without a locked forecast (verified on a sample weekly run, Nov 2026)
When Final DA Data has no positive locked forecast, the connector's **Forecast Data** dataset (TrueGradient's
`forecast_data.csv`: one row per ts_id × period with `split`, `actual`, `pred`, the run's TSID columns and its
timestamp column, e.g. `created_date`) is scored instead. This replaces the 4.12b "stored" path whenever the
dataset exists.
- Rows: `split = 'test'`, date ∈ the validation window (latest `validation_horizon` closed Sales periods ≤
  activity end), actual and pred clamped at ≥ 0 (null → 0), joined to Final DA rows on the TSID columns (Forecast
  Data's own `ts_id` string does NOT match Final DA). Forecast Data's `actual` is used, not Final DA Sales — they
  differ (sample week of Oct 11: Σ actual 1,040 vs Σ Sales 862).
- Overall accuracy = WAPE over every ts_id × validation period: 1 − Σ|pred − actual| ÷ Σ actual (pooled);
  per-period accuracy the same per period. **No rolling accuracy, no rolling bias** (rolling = overall, not shown).
- Per-ts_id accuracy = 100 − (Σ|pred − actual| ÷ Σ actual) × 100 (0 when Σ actual = 0); trust zone
  (`trustZoneFD`): **Highly Trusted > 80** (80.00 itself is Trusted) · Trusted ≥ 70 · Review ≥ 60 · Planner Review
  ≥ 40 · Low Trust ≥ 20 · Critical below. At a column granularity a group's zone = trustZoneFD of its pooled
  accuracy. The stored `trust_zone` column is not used on this path (it is not what TrueGradient shows here).
- Implementation: `applyForecastData(rows, fdRows, tsCols, dateCol, dates)` writes pseudo-measures
  `<d> @validation forecast` / `<d> @validation actual` onto Final DA rows; `applyAccuracyBasis(..., {forecastData})`
  sets `accPath "forecastData"`, `lockedMeasure = VALID`; every scorer reads the actual through `actOf(measure)`.
  `fdSeriesAccuracy` sets `_fdAcc` / `_fdZone` per row. Label "ML Accuracy (validation)".
- UI on this path: tiles Overall accuracy + Combos scored only; report table keeps Overall and the per-period
  columns (no rolling / aggregated / bias metrics); trust chips are the live zones (tab-local); basis chips
  "Forecast Data · split = test", "Overall only", "Trust zones from validation accuracy".
- **Verified exactly** against TrueGradient's Accuracy Deep Dive for `01012026_SKU_Channel_weekly` (718 series,
  2,850 test rows): overall 3.58%, weeks 5.58 / −9.43 / 1.54 / 15.04%, zones 27 / 23 / 36 / 81 / 26 / 525 —
  fixture `scripts/fixtures/sample_weekly_forecast_test.json`, test "§4.12c".
- Not matched yet: TrueGradient's chip contribution % on this path (it does not use last-3-period Sales).

### 4.12b Stored fallback — show only what can be matched (verified on a sample weekly run, Nov 2026)
Runs with no positive locked forecast AND no forecast inside the validation window in Final DA (`accPath
"stored"`, e.g. a sample weekly run: ML Forecast columns start 2026-11-08, validation weeks
Oct 11 – Nov 1) are scored by TrueGradient against forecast_data (validation predictions), which the connector
does not expose. TrueGradient's Accuracy Deep Dive showed Overall 2.5% (weekly 4.41 / −10.85 / 1.00 / 13.75%);
rebuilding from the stored per-ts_id `overall_accuracy` × window Sales gives 46.8% — not comparable (29 ts_ids
with zero sales in the window still carry a stored accuracy, and forecast_data errors on zero-sales rows are
invisible). Its chips were recomputed too (Critical 522 = stored Critical 123 + Not Available 399).
So on this path the dashboard shows:
- **Overall accuracy "—"** with the reason; a tile "ts_ids with a stored accuracy n of N";
- **no** rolling accuracy, rolling bias, bias, sums or per-period columns, and no trend chart;
- the report table limited to trust zone, combos, contribution and Overall accuracy, where a single ts_id row
  shows TrueGradient's stored `overall_accuracy` and group / total rows show "—";
- basis chips: "No rolling, bias or per-period accuracy", "Overall needs forecast_data · not exposed by the
  connector", "Per-ts_id accuracy = TrueGradient's stored values".
To match TrueGradient here, the connector must expose forecast_data (actual and prediction per ts_id × validation
period); with it this path becomes the "validation" path (scored like the locked path, rolling = overall).

## 4.12 Accuracy basis — which column, which window (TrueGradient's rule)

Run settings come from `tg_experiment_details` (`runConfig`): `accuracy.global_lag_n`
(dashboard_settings), `accuracy.past_accuracy_horizon`, `forecast.validation_horizon`,
`data_window.activity_end_date`. `colsOf` passes them to `parseColumns(columns, {accuracy})`;
`applyAccuracyBasis(rows, cols, {current: true})` confirms the choice on the loaded rows and sets
`C.LOCKED` (a live getter — never hard-code "Locked ML Forecast Lag_1").

**Path 1 — a locked forecast has positive mass (stay on Demand Alignment = Final DA Data / Value).**
Candidates in order: the original un-lagged `Locked ML Forecast`, then the locked column for
`global_lag_n` (`Locked ML Forecast Lag_<n>` or `Lock ML Forecast Lag_<n>`; `global_lag_n` unknown →
Lag_1, else the lowest lag present). The first with any value > 0 on a paired date wins.
- Window = every date that has both a dated `Sales` and a locked column, on or before
  `activity_end_date` (no activity end → the last Raw Actual date). `validation_horizon` is NOT used.
  Locked columns after the cut-off are "locked ahead" and never scored (Sales there is a partial or 0).
- Actual = dated `Sales`. Error = `<date> <locked> Abs Error` when > 0, otherwise |Sales − locked|
  (`lockedCells` sets `E`; `wape` uses it).
- Overall accuracy / bias = all window dates. Rolling accuracy / bias = the last
  `past_accuracy_horizon` dates (default 3). Overall / rolling aggregated = per ts_id Σ F and Σ A over
  the same dates, then WAPE across ts_ids (rolled up to the grain). Trust zones use rolling accuracy.
- Verified on a live sample monthly run (global_lag_n 4, horizon 3, activity end 2026-11-01):
  ITEM-A3 × Web store — 22 paired months Jan'25–Oct'26 → overall 50.08, rolling (Aug–Oct'26) −33.65,
  zone Critical, exactly the stored values (test §4.12).
- TrueGradient reads `dar_aggregated_backup.csv` at its view-1 grain; the connector exposes Final DA
  only, so every grain here is rolled up from Final DA (same Sales and locked columns).

**Path 2 — validation-period fallback (neither original nor lag-N has positive mass).**
- Window = the latest `validation_horizon` Sales dates on or before `activity_end_date` (missing or
  0 → every Sales date up to the cut-off). Rolling is not a separate window: every rolling metric
  equals its overall metric (`cols.rollingN = window length`); trust zones use that one accuracy.
- TrueGradient takes actual and pred from `forecast_data.csv` (split = test, actual ≥ 0, pred ≥ 0).
  The connector does not expose it, so:
  - `accPath "validation"`: Final DA's dated `ML Forecast` in the window has positive mass → scored
    like Path 1 against Sales (small differences from TrueGradient are possible);
  - `accPath "stored"`: no forecast in the window (e.g. a sample weekly run) → measure `C.STORED`: each
    ts_id's error = (1 − stored overall_accuracy / 100) × Σ Sales in the window, then WAPE across
    ts_ids. Totals are exact for one ts_id; bias, per-period accuracy and group netting are not
    available (the page hides them and says why).
- TrueGradient's time-series summary headline on the fallback publishes one overall accuracy and one
  signed bias Σ(pred − actual) / Σ actual; it has no separate rolling value.
