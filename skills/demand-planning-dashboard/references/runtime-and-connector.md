# Runtime & connector — how the page reads TrueGradient live

The page never downloads a dataset. Every number is computed by TrueGradient's server-side
`tg_dp_*` tools (inside the Query Engine, over all rows) and the page asks only for what it
shows: one KPI block, one chart, one table page. This is what lets the same page open a run
of 1,000 or 1,000,000 rows in the same time and memory.

## Contents
1. Capability manifest
2. Calling a tool (unwrap, errors, meta)
3. Tool contracts (observed live)
4. The gateway (the only way the page calls a tool)
5. Size rules (the skill's limits)
6. Paging, sorting, exporting
7. Freshness and caching
8. Error handling by code
9. Things that do NOT work in a published page
10. Build check

---

## 1. Capability manifest

Publish with exactly these tools. `tg_fetch_dataset`, `tg_dataset_info` and
`tg_resolve_datasets` are **not** declared: the runtime enforces the manifest, so no bug in
page code can pull rows in bulk.

```json
{ "mcp": { "servers": [ { "server": "TrueGradient", "tools": [
  "tg_whoami", "tg_list_experiments_for_analysis", "tg_experiment_details",
  "tg_dp_context", "tg_dp_dimensions", "tg_dp_filter_options", "tg_dp_scope",
  "tg_dp_aggregate", "tg_dp_series", "tg_dp_compute", "tg_dp_period_compare",
  "tg_dp_accuracy_summary", "tg_dp_accuracy_by_period", "tg_dp_accuracy_by_group",
  "tg_dp_trust_zones", "tg_dp_table_page", "tg_dp_row_detail", "tg_dp_export_csv",
  "tg_dp_top_movers", "tg_dp_anomalies", "tg_dp_pacing", "tg_dp_needs_attention",
  "tg_dp_segmentation", "tg_dp_outlook",
  "tg_dp_inventory_health", "tg_dp_supply_plan", "tg_dp_transfers",
  "tg_dp_experiment_compare"
] } ] } }
```
`server` is the connector **display name** ("TrueGradient"); tool names have no `mcp__…`
prefix inside the page. At load, `mcp.listTools("TrueGradient")` confirms the names; a
missing tool greys out only the tabs that need it with "Connector update needed: <tool>".
Before every build, load the `artifact-capabilities` skill and follow the current runtime
contract; it is authoritative over this file. The full set also declares `db`, `user` and
`downloads` (tabs.md "Organisation tab layout", "Shared components").

## 2. Calling a tool

- Results arrive wrapped. Unwrap until an object with a known key appears: inside a page the
  payload can be `{result: "<json string>"}`, `{data: …}`, `structuredContent` or a text block.
  `tg_dp_*` answers always carry `meta` (or `error`).
- **Errors are typed, never partial.** `{error: {code, message, fix}}` with `code` in
  `E_COLUMN` (unknown column or period), `E_BAD_ARG`, `E_NO_BASIS`, `E_NOT_FOUND`,
  `E_ENGINE` (engine failed), `E_TIMEOUT` (too slow; narrow the question),
  `E_UNSUPPORTED`. Show `message` and `fix` in the section; never show half an answer.
- **Every answer has `meta`**: `run {id, updatedAt, grain}`, `dataset`, `basis` (scored
  forecast, window, rolling window, lockedAhead), `source` (parquet or csv), `cost {queries,
  ms, cache: "hit"|"miss"}`, `complete: true`, `scope` (the filters and level applied) and,
  for paged tools, `page {number, size, returned, total, hasMore, nextPage, nextCursor,
  prevCursor}`. The page uses `meta.run.updatedAt` as the cache stamp and `meta.basis` for
  the Accuracy basis line; it never re-derives either.
- Common arguments, same on every `tg_dp_*` tool:
  - `experiment_id`; `unit`: `"units"` (Final DA Data, default) or `"value"` (the Value
    twin datasets). **The Units ⇄ Revenue toggle only changes `unit`.**
  - `filters`: `[{column, op, values}]`, `op` = `in | not_in | eq | between | contains |
    is_null`; a blank value is written `"—"`. Search: `{op: "search", columns, text}`.
    Unknown columns are `E_COLUMN`, never ignored.
  - `level`: `{by: []}` overall, `{by: ["@ts_id"]}` each ts_id, or any number of columns combined —
    this is the Granularity control.
  - `window`: `{from, to}` inclusive ISO dates.

## 3. Tool contracts (observed live, Nov 2026)

Discovery
- **tg_whoami** `{}` → `{company_id, company_name, …}`. Page title prefix.
- **tg_list_experiments_for_analysis** `{module?, include_archived?}` → roster
  `{experiments:[{id, label, tag, module_name, createdAt, updatedAt, isProduction,
  isArchive, …}], used_archived_fallback}`. Default-source rule: calculations §1.
- **tg_experiment_details** `{experiment_ids}` → run setup for the Source drawer (§ Run setup).
- **tg_dp_context** `{experiment_id, unit}` → `config {tsIdColumns, grain, frequency,
  globalLagN, pastAccuracyHorizon, validationHorizon, activityEnd, perYear,
  trustZoneThresholds, timestampColumn}`, `periods {history, current, future, latestClosed,
  closedSales, lockedAhead, contributionPeriods}`, `measures {name: {from, to, count}}`,
  `basis {path, measure, label, window, rollingN, rollingWindow, lockedAhead,
  hasStoredAbsError}`, `compare [{measure, periods}]`, `dims {columns, leading}`, `run`,
  `datasets {name: {present, rows, columns}}`, `tsIdDuplicates`. **Call once per run**; it
  drives every period word, window, basis line and the compare-forecast list.
- **tg_dp_dimensions** `{columns?, filters?}` → `columns [{column, label, tier, distinct,
  nulls, leading, recommended}]`, `rows`. Builds the filter bar and Settings (labels, the
  recommended four).
- **tg_dp_filter_options** `{column, filters, search, page, page_size}` → `values [{value,
  rows, contribution}]` ordered by contribution. The column's own filter is ignored, so
  dropdowns cascade.
- **tg_dp_scope** `{filters, level}` → `{tsIds, tsIdsInRun, shareOfRun, groups,
  estimatedExportRows}`. Size a selection before a heavy call; drives "n of N ts_ids".

Numbers and charts
- **tg_dp_aggregate** `{measures [{id, measure, agg?, periods|window|last_closed|next,
  by_period?}], group_by, derived ["contribution", "share:<id>"], contribution_base,
  sort, having, page, page_size, include_total}` → `rows [{key, parts, <id>…}]`, `total`.
  `measure` may be `"@rows"` with `agg: "count"`.
- **tg_dp_series** `{measures [{id?, measure, kind: plain|ly|quantile}], window,
  periods_shown, split_by, top_n_series, sort_measure}` → `periods [{p, class:
  history|current|future, partial?}]`, `series [{id, measure, kind, group?, others?,
  values}]` aligned with `periods`. The current period's Sales is period-to-date.
- **tg_dp_period_compare** `{mode: series|ytd|l3m|n3m|leaders, window, level, min_base,
  top_n}` → series: `points [{p, class, ty, ly, yoy, mtd?}]`; ytd: `{ty, ly, ytdYoy}`;
  l3m / n3m: `{periods, ty, ly, change, yoy}`; leaders: `leaders`, `laggards`.
- **tg_dp_outlook** `{horizon, level, page, page_size}` → `periods`, `series` (Forecast, ML
  Forecast, RL Unconstrained Forecast, LY Sales, P10…P99), `bandNote`, `uplift`,
  `overrideShare`, `kpis {next3, nextYear: {forecast, ly, vsLy}}` (fixed spans, not the
  horizon), `quarters`, `patternMix`, `byGroup` (with a level).
- **tg_dp_compute** `{outputs [{id, expr}], group_by, filters, sort, page, page_size,
  include_total}` → `rows`. Safe expression tree for metrics no other tool has; a bare
  `{field}` output returns text.

Accuracy
- **tg_dp_accuracy_summary** `{forecasts (≤ 4), level, window, contribution_base,
  reconcile}` → per forecast `{overall, rolling, rollingAggregated, rollingBias, bias,
  trustZone, combos, window, rollingWindow, sums, months [{period, accuracy, actual,
  forecast, absError}], zones, contribution}`; one matching row also returns `stored`;
  `reconcile: true` adds `reconcile {rowsInRun, ok, months [{period, recomputed, stored,
  ok}]}` — this feeds the "✓ Matches TrueGradient" line.
- **tg_dp_accuracy_by_period** `{forecasts, level, window}` → `forecasts [{measure,
  periods [{period, accuracy, bias, absError, actual, forecast, cells, drop}]}]` (▼ marks).
- **tg_dp_accuracy_by_group** `{forecast, level, window, search, zones, sort, page,
  page_size, months}` → `rows [{key, parts, trustZone, contribution, overall, rolling,
  rollingAggregated, rollingBias, bias, combos, months?}]`, `allInFilter` (the pinned row).
- **tg_dp_trust_zones** `{level, forecast, window}` → `zones [{zone, count, contribution}]`
  in the app's order, `zoneBasis`, `thresholds` (the company's own cut-offs).

Tables
- **tg_dp_table_page** `{columns [{id, kind: dim|stored|measure|derived, …}], level,
  search, sort, page | cursor, page_size, include_totals, contribution_base}` →
  `rows [{key, parts, cells {<id>: value}}]`, `totals`. Derived columns: contribution,
  overall_accuracy, rolling_accuracy, bias, rolling_bias, trust_zone, combos.
- **tg_dp_row_detail** `{key, level, window}` → `attrs`, `series {measure: {period:
  value}}`, `accuracy` block, `cells`, `partial`; for a group also `rows` and `notSummed`
  (percentages are never added up).
- **tg_dp_export_csv** → `{status: "ready", url, filename, rows, expiresAt}`; the link expires
  in about 4 minutes and no exported row passes through the page. Two forms:
  - a `tg_dp_table_page` table: the same arguments plus `label` per column and `filename`;
  - **any other table**: `source` (the tool the table shows: aggregate, accuracy_by_group,
    accuracy_by_period, filter_options, series, compute, segmentation, outlook, period_compare,
    inventory_health, supply_plan, transfers, experiment_compare, top_movers, needs_attention,
    anomalies, pacing), `args` (that tool's arguments without paging — the server pages it over
    every row), `rows` (dotted path of the row list, e.g. `result.rows`, `revisions.rows`; a
    mapping becomes one row per key), `pin` (e.g. `allInFilter`) and `columns: [{field, label}]`
    with dotted fields (`cells.acc`, `months@2026-11-08.accuracy`, `lags.0.accuracy`).

Review screens (computed by TrueGradient's own Review List engine — same request as the app)
- **tg_dp_top_movers** `{group_by, top_n, period, member_rows}` → `result
  {overPerformers, underPerformers (with memberRows, memberCount), meta}`.
- **tg_dp_anomalies** `{group_by, code, page, page_size, group_page, group_page_size}` →
  `result {rows, chips, groupSummary, totalFlags, …}`.
- **tg_dp_pacing** `{group_by, inventory_cap, day_weights, statuses, page, page_size}` →
  `result {rows, statusCounts, overall, cumulative, …}`.
- **tg_dp_needs_attention** `{group_by, direction, top_n}` → `result {rows}`.
  These four accept only `{column, op: in|eq, values}` filters and page sizes 1–50, and
  carry `meta.notes` (the planner review queue is not available to the connector).

Segmentation, inventory, runs
- **tg_dp_segmentation** `{level, a_cut, b_cut, x_cut, y_cut, cell, pareto_points, page,
  page_size}` → `matrix`, `pareto`, `rows` (members of `cell`), `window`, `cuts`.
- **tg_dp_inventory_health** `{level: native|item|base_warehouse, group_by, include_kpis,
  sort, search, page, page_size, as_of}` → `kpis`, `groups`, `rows`, `columns {item,
  location}`, `locationKind`, `notes`.
- **tg_dp_supply_plan** `{level, pick, variables, include_identity, include_oos}` →
  `periods`, `variables`, `safetyStockUnits`, `aggregatedDays`, `identity`, `oos`.
- **tg_dp_transfers** `{group_by: lane|region, include_rows, page, page_size}` → lanes,
  totals, rows. `E_NOT_FOUND` when the run has no Stock Transfer — show the tab's empty state.
- **tg_dp_experiment_compare** `{runs [{id, asOf?}] (1–5), baseline_id, level, page,
  page_size}` → `runs`, `excluded`, `totals`, `actual`, `consistency`, `tiles`, `revisions`,
  `accuracyByLag`, `notes`.

## 4. The gateway (the only way the page calls a tool)

All calls go through one function, `tg(tool, args, {priority})`:
1. **Checks the request against the size rules** (§5) before it is sent; a request that
   breaks a rule is refused on the page with a developer error.
2. **6 requests in flight**, foreground (the open tab) before background.
3. **Debounces** filter and search input by ~250 ms and **shares identical in-flight calls**.
4. **Drops stale answers**: if the viewer changed the filter while a call was out, the old
   answer is not rendered.
5. **Result cache** of ~200 entries keyed by `(tool, canonical args, run updatedAt)`; a run
   update (new `updatedAt` in the roster or in any `meta.run`) clears that run's entries. The
   server caches too (`meta.cost.cache`), so repeats are cheap either way.
6. **Counts rows held per tab** and, in development, throws when a tab holds more than the
   limit — that would mean something is pulling too much.
7. Unwraps the payload and turns `{error}` into a typed exception for the section.

## 5. Size rules (the skill's limits — the tools never truncate)

| Rule | Value |
|---|---|
| Table page size | 10–100 rows (default 50; Accuracy report 50; review screens ≤ 50) |
| Points per chart line | ≤ 156 (3 years of weeks); use `window` / `periods_shown` |
| Series per chart | ≤ 12; use `split_by` + `top_n_series` (the rest becomes "Others") |
| Compared forecasts | ≤ 4 per accuracy call |
| Rows held per tab | ≤ 2,000 |
| Grouped member rows (Top Movers) | `member_rows` ≤ 10 on screen; expand on demand |
| Runs compared | ≤ 6 including the current run |

Before a heavy grouped call at a 2–3 column granularity, call `tg_dp_scope` and, when
`groups` is large, ask for top N with an "Others" row instead of every group.

## 6. Paging, sorting, exporting

- Tables page on the server: send `page` + `page_size`, or the `nextCursor` /
  `prevCursor` from the previous answer (a cursor only works for the same question; a stale
  one is `E_BAD_ARG` → restart at page 1). `meta.page.total` gives "n of N".
- Sorting, search and column totals are arguments (`sort`, `search`, `include_totals`); the
  page never sorts or totals rows itself. Totals are over **every** matched row, not the page.
- **CSV, every table**: `tg_dp_export_csv` with the table's own tool as `source` (or the
  table-page form), its current arguments, filters, sort and search, and one `{field, label}` per
  column; show the returned `url` as a link (it expires in ~4 minutes). The file holds every row
  the table pages through, not just the page on screen. Never build a CSV from the rows the page
  holds.

## 7. Freshness and caching

- `cache: false` on every connector call (the gateway and the server cache instead, both
  keyed by `updatedAt`).
- Reload icon: `mcp.invalidate("TrueGradient")`, clear the gateway cache, reload the roster
  (a newer run may now be the default) and the open tab.
- No IndexedDB, no row cache, no memory budget, no background preload of datasets: the page
  holds only what is on screen. Hidden tabs make no calls.
- "Last loaded" = receipt time of the newest answer; "Sales data through" and the run dates
  come from the roster and `tg_dp_context`.

## 8. Error handling by code

| Code | Copy (in the affected section) | Action |
|---|---|---|
| `needs_reauth` | "Reconnect TrueGradient in claude.ai Settings → Connectors." | none |
| `server_not_connected` | "Add the TrueGradient connector in claude.ai Settings → Connectors." | none |
| `selection_required` | "Choose which TrueGradient connection to use in the prompt claude.ai shows." | none |
| `not_in_manifest` / `approval_required` | "This page needs permission to read TrueGradient." | button → call once |
| `server_unavailable` | "TrueGradient didn't answer. Retrying…" | one retry after jittered delay |
| `E_TIMEOUT` | "This question took too long. Narrow the filters or pick a coarser granularity." | none |
| `E_COLUMN` | the tool's `message` + `fix` (a filter or saved setting names a column this run lacks) | reset that setting |
| `E_NO_BASIS` | "This run has nothing to score accuracy against." | none |
| `E_NOT_FOUND` | the tab's empty state (e.g. "This run has no Stock Transfer data") | none |
| `E_ENGINE`, other | "Couldn't load <section> (<code>)." + `message` | "Try again" |
If every section fails with the same code, show one page-level banner instead. Authorisation
failures clear rendered data.

## 9. Things that do NOT work in a published page

- `window.storage`, `fetch("https://api.anthropic.com/...")`, `window.fs`.
- Scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com,
  cdn.tailwindcss.com, code.jquery.com, with exact versions (Chart.js 4.4.1 from cdnjs);
  fonts only from Google Fonts.
- `localStorage` works per viewer (wrap in try/catch): layouts, filters, labels, weights.
- Only plain `#name` hashes route.

## 10. Build check

Run `node scripts/check_page.js <page.html>` before publishing. It fails if the page source
contains any of: `tg_fetch_dataset`, `tg_dataset_info`, `tg_resolve_datasets`,
`fetchAllRows`, `indexedDB`, `cellBudget`, `memTrim`, `demandDims`, `filterOptions(`,
`accuracySummary(`, `lockedCells(`, or a tool name not in §1 — and if the manifest in the
page differs from §1.
