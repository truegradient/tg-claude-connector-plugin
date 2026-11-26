# Tab → tool map

How every tab gets its data. **On open** calls run in parallel through the gateway
(runtime-and-connector.md §4); **on interaction** calls run only when the viewer acts.
Arguments shared by all calls — `experiment_id`, `unit` (Units ⇄ Revenue), `filters` (the
global filter bar, plus the trust-zone chips as a `trust_zone` filter at Overall / ts_id) —
are omitted below. `level` is the tab's Granularity control (`{by: []}` Overall,
`{by: ["@ts_id"]}`, or any number of columns, as the app).

The page holds only these answers. It never loops over rows, never sums, never ranks: when a
number is needed that no call returns, add an argument to a call (or use `tg_dp_compute`),
don't compute it in the page.

## Always present (every tab)

| Element | Call | When |
|---|---|---|
| Title | `tg_whoami` | page load |
| Source badge, pickers | `tg_list_experiments_for_analysis` (+ `include_archived: true` lazily for Forecast by Experiment) | page load, reload |
| Run setup (Source drawer) | `tg_experiment_details {experiment_ids: [id]}` | source chosen |
| Periods, basis, compare list, dims, row counts | `tg_dp_context` | source chosen (once per run × unit) |
| Filter bar + Settings | `tg_dp_dimensions` (all columns, once per run) | source chosen |
| A dropdown's values | `tg_dp_filter_options {column, search, page_size: 50}` (cascades: its own filter ignored) | dropdown opened / typing |
| "n of N ts_ids · x% of run" | `tg_dp_scope {level}` | filters change |
| Trust-zone chips | `tg_dp_trust_zones {level}` | filters / level change |

## Demand Planning

**Forecast › Plan & history** (one ts_id when the filters pin one, else the filtered aggregate)
- On open: `tg_dp_series {measures: [Sales, Forecast, <basis.measure>, {measure: "Sales",
  kind: "ly"}, P10, P90], periods_shown: <Months shown>}` · `tg_dp_accuracy_summary
  {level: {by: []}}` (KPI tiles; one row → `stored` values) · `tg_dp_aggregate
  {derived: ["contribution"], contribution_base: "run"}` (Contribution tile).
- Monthly Metrics table: `tg_dp_row_detail {key}` for one ts_id, else `tg_dp_series` with
  every row measure.
- Badges (pattern, trust, lifestage, AB class): `tg_dp_row_detail.attrs` for one ts_id.

**Forecast › Outlook**
- On open: `tg_dp_outlook {horizon, level, page_size: 10}`.
- Horizon / Granularity change → re-call. "Outlook by" table pages → `page`.

**Accuracy › Summary**
- On open (4 calls): `tg_dp_accuracy_summary {forecasts, level, window, reconcile: true}` ·
  `tg_dp_accuracy_by_period {forecasts, level, window}` · `tg_dp_trust_zones {level,
  window}` · `tg_dp_accuracy_by_group {level, window, sort, page_size: 50, months}`.
- Compare forecast, From / To, Granularity, Metrics → re-call the first three (and the
  group table). Zone chip at a column granularity → `tg_dp_accuracy_by_group {zones}`.
  Row click → `tg_dp_accuracy_by_period` filtered to that group (chart focus).
- Basis line = `meta.basis`; reconciliation line = `reconcile` + `combos` +
  `tg_dp_context.datasets["Final DA Data"].rows`.

**Accuracy › Month-end**
- On open: `tg_dp_table_page {columns: [dims…, {kind: "measure", measure: "Sales",
  periods: [m]}, {kind: "measure", measure: <basis>, periods: [m]}, …], level, sort,
  page_size: 50, include_totals: true}`; per-cell accuracy / bias from
  `tg_dp_accuracy_by_group {months: true}` for the same page keys, or `tg_dp_compute`.

**Top Movers**
- On open: `tg_dp_top_movers {group_by: <Granularity>, top_n, period, member_rows: 5}`.
- Row expand → re-call with `member_rows: 50` for that group's filter, or `tg_dp_row_detail`.

**Anomalies**
- On open: `tg_dp_anomalies {group_by, code: "ALL", page_size: 25, group_page_size: 10}`.
- Chip click → `code`; next page → `page`; row click → `tg_dp_row_detail` (or switch to
  Forecast with that ts_id pinned).

**Pacing**
- On open: `tg_dp_pacing {group_by, inventory_cap: "onHand", day_weights, page_size: 25}`.
- Cap control, weights calendar, status chips (`statuses`), Granularity → re-call.

**Needs Attention** (optional card on Forecast or Pacing)
- `tg_dp_needs_attention {group_by, direction, top_n}`; show `meta.notes`.

## Inventory Planning

**Reorder & Health**
- On open: `tg_dp_inventory_health {level, include_kpis: true, sort, page_size: 50}`.
- Inventory level, search, sort, next page → re-call; risk chart from `kpis.risk`.

**Supply Plan**
- On open: `tg_dp_supply_plan {level, pick: "all", include_identity: true}`.
- Item picker (values from `tg_dp_inventory_health` rows or `tg_dp_filter_options` on the
  item column) → `pick: "<item>|<location>"` with `include_oos: true`; variable picker →
  `variables` (derived fields are still computed from all variables).

**Transfers**
- On open: `tg_dp_transfers {group_by: "lane", include_rows: true, page_size: 50}`;
  `E_NOT_FOUND` → empty state "This run has no Stock Transfer data".

**Locations** (only when `tg_dp_inventory_health.columns.location` is set)
- On open: `tg_dp_inventory_health {group_by: "location"|"region"|"channel", include_kpis:
  false}` · `tg_dp_transfers {group_by: "region"}`.

## General Analysis

**YoY**
- On open: `tg_dp_period_compare {mode: "series", window}` (chart) · `{mode: "ytd"}` ·
  `{mode: "n3m"}` (KPI tiles) · `tg_dp_period_compare {mode: "leaders", level, top_n: 10}`.
- Breakdown table: `tg_dp_aggregate` with LY / TY measures at the Granularity, or
  `tg_dp_period_compare {mode: "l3m", level}` per row group.

**ABC Segmentation**
- On open: `tg_dp_segmentation {level, a_cut, b_cut, x_cut, y_cut, pareto_points: 60,
  page_size: 50}`.
- Matrix cell click → `cell: {abc, xyz}` (members, paged); cut inputs → re-call.

**Forecast by Experiment**
- On open: `tg_dp_experiment_compare` is called only once a run is added (it needs ≥ 1
  other run); until then show the current run's `tg_dp_series {measures: [Forecast]}` and
  the empty state "Add a run to compare".
- Add / remove run, "forecast as of", Granularity, Baseline → re-call with `runs`,
  `baseline_id`, `level`; revisions page → `page`.

## Table CSV (every table)

`⤓ CSV` → `tg_dp_export_csv` for every table: the table-page form for `tg_dp_table_page`
tables, otherwise `source` = the table's tool, `args` = its current arguments, `rows` = the
row list's path, `pin` = the pinned row, `columns` = one `{field, label}` per column. The server
pages the tool over every row and writes the file; the page shows the returned link.
