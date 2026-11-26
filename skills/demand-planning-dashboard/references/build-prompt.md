# Build prompt — Demand Planning artifact

Use this when the user asks to "build the artifact using the skill" or "use the prompt in
the skill". Follow it as written. If anything here conflicts with another file in this
skill, the other file wins.

<role>
You are building a production planning tool for a demand & supply planning team. Act as a
senior front-end engineer who is also a demand planner: every number must be right,
explainable and reproducible, and the page must keep working when data is missing or a
call fails.
</role>

<goal>
Build and publish ONE live, multi-tab artifact — "Demand Planning" — that reads
TrueGradient experiment data live through the TrueGradient connector and lets planners
move between three groups of views — Demand Planning: Forecast (plan & history + outlook),
Accuracy, Top Movers, Anomalies, Pacing; Inventory Planning: Reorder & Health, Supply Plan,
Transfers, Locations; General Analysis: YoY, ABC Segmentation, Forecast by Experiment. Dark and light
themes. Ship it in one turn without questions; where something is ambiguous follow the
skill's defaults and list your assumptions in two or three lines after publishing.
</goal>

<source_of_truth>
This skill is the single source of truth for data rules, formulas, tab layouts, design
tokens and the connector runtime. Every number comes from TrueGradient's server-side
`tg_dp_*` tools; the page shows answers and never computes a metric. Before writing code:
1. Read SKILL.md, then references/runtime-and-connector.md, tab-tool-map.md, tabs.md,
   design-system.md (calculations.md and data-model.md to word tooltips and checks).
2. Do NOT inline scripts/tg_calc.js. It is the audit reference for the tools, not page code.
   If a number looks wrong, report it after publishing; don't patch it in the page.
</source_of_truth>

<steps>
1. Read the skill files above (and the frontend-design skill if available).
2. Observe the connector for real in the conversation:
   a. tg_list_experiments_for_analysis (no filter) → apply the default-source rule.
   b. tg_dp_context for the chosen experiment → periods, grain, basis, compare list,
      dimensions, dataset row counts; tg_experiment_details → run setup.
   c. One small answer from each family the page uses: tg_dp_accuracy_summary,
      tg_dp_table_page (page_size 3), tg_dp_series, tg_dp_top_movers (top_n 2),
      tg_dp_inventory_health (page_size 2).
   Learn shapes only. Never copy an observed value into the page.
3. Load the artifact-capabilities skill; follow its mcp, db, user and downloads contracts.
4. Write one self-contained HTML file (demand-planning.html) with one gateway for every
   call and each tab wired as tab-tool-map.md says.
5. Run `node scripts/check_page.js demand-planning.html`, then the acceptance self-check
   below (ideally headlessly with a mock connector that returns the observed shapes); fix
   what fails.
6. Publish with the Artifact tool, title "Demand Planning", declaring the full capability
   set: db (orgs rules), user, downloads, and mcp with exactly the tools in
   runtime-and-connector.md §1.
</steps>

<data_source_rule>
- Sort the roster by createdAt, newest first (the archived fallback list is unsorted).
- "Live" = isArchive false (not archived) — every completed non-archived run is live.
  isProduction is a separate "Production" flag, never "live"; it only picks the default run
  inside a pipeline (live production run, else newest live run). If only archived runs exist (used_archived_fallback), nothing is
  live: default to the newest full inventory-optimization run, badge "Not a live run ·
  Archived", and a notice that a run may be re-computing.
- Several pipelines (tag) with live runs → Pipeline selector; each defaults to its newest
  live run; the page opens on the pipeline of the newest live run. One pipeline → newest
  live run.
- The viewer can change pipeline/experiment from the source badge; remember it in
  localStorage (try/catch) with "Reset to default". A saved choice that no longer exists
  falls back to the default with a one-line notice.
- As-of date = UTC date of the experiment's createdAt, shown in the badge.
</data_source_rule>

<global_layout>
Header: title "<organization> Integrated Business Planning" (organization = tg_whoami.company_name,
loaded at start, non-fatal; fallback "Integrated Business Planning") + subtitle "Live TrueGradient · pick a view, set filters, refresh",
connection pill, reload icon (right of the pill), Settings gear icon, source badge
(experiment · pipeline · as of · live flag), Units ⇄ Revenue toggle, theme toggle
(System / Dark / Light).
Tab bar in three captioned groups (tabs.md "Navigation"), hash-routed: #forecast #accuracy #movers
#anomalies #pacing | #inv-health #inv-supply #inv-transfers #inv-locations | #yoy #abc #experiments
(old #planner / #outlook → #forecast, #inventory → #inv-health).
Global filter bar built from the **dimension columns of Final DA Data** (tabs.md "Filter
bar and Settings"): by default the four most relevant — Product Variant ID
(product_variant_code, type-ahead), Channel Name (channel_name), Region Name (Region_name),
Product Category (product_category) — then Months shown (Last 12 | Last 24 | All) and
Clear filters. Filters apply instantly; there is no Apply/Refresh button. Every label is
derived from the column name and carries an ⓘ naming the column.
Settings panel (whole page, saved per viewer): every dimension column with an on-bar
checkbox, editable label → column name, Recommended badge, distinct-value count, reset
label, ↑ ↓ order; "Reset to recommended". Renames flow to every tab.
Filters a tab cannot use are disabled with "Not used on this tab".
All dropdowns are custom searchable comboboxes; no native <select>.
A tab-specific control row sits under the bar (month picker, Top N, grain, view
switches). Never repeat a global filter (e.g. a second product/channel/region picker)
inside a tab.
</global_layout>

<tabs>
Build every tab as references/tabs.md specifies, with its data exactly as
references/tab-tool-map.md lists:
- Planner View: one ts_id (when one product_variant_code, channel_name and Region_name are
  picked in the global filters) or the filtered aggregate; badges; KPI cards Overall
  accuracy · Rolling accuracy (3 mo) · Rolling bias (3 mo) · Contribution; history +
  24-month chart with series toggles and P10–P90 band; Monthly Metrics table.
- Accuracy: Summary (trend, an "Accuracy summary" table in TrueGradient's report layout —
  Combos, Contribution %, Overall, Rolling, Rolling aggregated, Rolling bias, one column per
  locked month, first row "All in filter" — breakdowns, trust-zone mix) and Month-end
  Accuracy (per row: Sales, Lag-1 forecast/accuracy/bias, prior-run consensus columns when a
  previous run exists).
- Top Movers, YoY, Anomalies, Pacing, ABC Segmentation, Forecast Outlook, Inventory Health
  (Reorder & Health | Warehouse & Region | Supply Plan | Transfers), Forecast by Experiment
  — as tabs.md describes, with column labels everywhere.
- Forecast by Experiment starts with the current run; the viewer adds runs (live and
  archived, up to 6 in all) and each added run defaults to the production run of its
  period, else its latest run; tg_dp_experiment_compare returns totals, consistency,
  revisions and accuracy by lag.
</tabs>

<calculation_rules>
- The server computes every number; the page passes arguments and formats answers. No row
  loops, sums, rankings or formulas in page code. A number no tool returns → add an argument
  or use tg_dp_compute, never page math.
- Run shape (ts_id, grain, periods, activity end, horizons, scored basis) comes from
  tg_dp_context / meta.basis and tg_experiment_details. Use period words for the grain
  (month / week / day); nothing assumes months.
- Accuracy numbers come from tg_dp_accuracy_summary / _by_period / _by_group /
  tg_dp_trust_zones: bottom-up at ts_id, the run's own scored locked forecast, periods up to
  activity end (current one included, as the app does), rolling = last past_accuracy_horizon
  periods. Trust-zone cut-offs = the tool's `thresholds`.
- Granularity = the `level` argument; Units ⇄ Revenue = the `unit` argument.
- Reconciliation line from tg_dp_accuracy_summary {reconcile: true} and tg_dp_context row
  counts: "✓ Matches TrueGradient: N ts_ids scored · stored errors match k/k periods".
- Single ts_id: tg_dp_row_detail gives attrs (stored trust_zone, AB_Class, …) and the
  accuracy block; tg_dp_accuracy_summary returns `stored` for one matching row.
- Divide-by-zero shows "—". Never NaN, Infinity or undefined.
</calculation_rules>

<runtime_rules>
- `const mcp = await claude.use("mcp")`; if null render "Open this in claude.ai with the
  TrueGradient connector". Paint the shell first; never block on the connector.
- One gateway for every call: size rules (page size 10–100, ≤ 12 series per chart, ≤ 2,000
  rows held per tab), ≤ 6 in flight, ~250 ms debounce, shared identical in-flight calls,
  stale answers dropped, ~200-entry result cache keyed by run updatedAt. `cache: false` on
  the connector call itself.
- Unwrap payloads ({result: "<json>"}, {data}, structuredContent, text block); a `{error:
  {code, message, fix}}` answer becomes a typed section error.
- Tables page on the server (page number or nextCursor); sorting, search and totals are
  arguments. CSV = tg_dp_export_csv → save the url via downloads.
- Reload icon = mcp.invalidate("TrueGradient") + clear the gateway cache + reload roster
  and the open tab. No IndexedDB, no row cache, no background preload.
- Published-page limits: no window.storage, no api.anthropic.com; scripts only from cdnjs
  / jsDelivr / unpkg with pinned versions (Chart.js 4.4.1 UMD from cdnjs); Google Fonts only.
</runtime_rules>

<design>
references/design-system.md: warm olive-dark palette, mint / clay-orange / periwinkle,
Source Serif 4 titles, IBM Plex Sans, tabular figures. Full light theme from the same
tokens; theme follows the viewer with a manual override; charts re-render on theme
change. Tables scroll in their own container with sticky headers. Visible focus,
reduced motion, safe-area insets, works at 380px. Every KPI and chart has an ⓘ tooltip
from one EXPLAIN map worded like calculations.md.
</design>

<avoid>
- Hard-coding any TrueGradient value, SKU, channel, date column, experiment id or trust-zone
  cut-off.
- tg_fetch_dataset, tg_dataset_info, tg_resolve_datasets, row caches, or any metric math in
  page code (check_page.js fails on them).
- UI labels "SKU", "Platform", "Region", "Category" — use column labels.
- Guessing a tool's argument names instead of the observed shape.
- A generic "Something went wrong" for every failure.
- Inventing daily sales, promo calendars or a "multi locked" forecast.
- Fade-in animations on every card, ALL-CAPS labels, emoji in the UI (favicon is fine).
</avoid>

<acceptance>
1. check_page.js passes; the manifest lists exactly the tools in runtime-and-connector.md §1.
2. No filters: Overall, Rolling, Rolling aggregated, Rolling bias and each period equal the
   TrueGradient app's Accuracy Deep Dive for the same run; combos = its row count.
3. The reconciliation line reads "✓ Matches TrueGradient" on real data.
4. Contribution over all rows = 100%.
5. Units ⇄ Revenue changes every tab's numbers, axis labels and formats.
6. Inventory tiles reconcile with the detail-table totals.
7. Changing the source reloads data and updates the badge; Reset returns to the default.
8. Each tab has loading, empty and error states; a tool error shows its code-specific copy.
9. Opening any tab makes only the calls in tab-tool-map.md and holds ≤ 2,000 rows; a run of
   10,000+ rows opens as fast as a small one.
10. Every table pages, sorts, searches and exports through the tools; the CSV equals the table.
11. Dark and light both readable; no colour outside the token block.
12. No observed data value anywhere in the HTML.
13. Filter labels = column labels with ⓘ; Settings add/remove/reorder/rename/reset work and
    renames appear in every tab; no tab repeats a global filter.
14. Pacing is measured at the sales data-through date, never today: "Data through" (dashed)
    and "Today" (solid), stale notice when more than 2 days old.
15. The source drawer shows "Run setup" from tg_experiment_details; the ts_id and grain in use
    match tg_dp_context.
</acceptance>

<after_publishing>
One line saying the first open asks to allow the TrueGradient connector; up to three
assumptions; any formula the skill should revisit. Nothing else.
</after_publishing>

## Flexible granularity (calculations §4.10, tabs.md "Granularity control")
- Every demand tab where grouping applies has a Granularity multi-select (as the app: any number of
  columns; none = Overall; the ts_id columns alone = each ts_id), sent as the tool's `level` (or `group_by` on the review screens). The
  tools group on the server; the page never groups rows.
- Accuracy Summary follows TrueGradient's Accuracy Deep Dive: Compare forecast (`tg_dp_context.compare`,
  ≤ 4), From / To (`window`), Metrics picker, trust-zone chips (`tg_dp_trust_zones`), trend with
  ▼ markers (`tg_dp_accuracy_by_period` `drop`), report table (`tg_dp_accuracy_by_group`) with the
  pinned "All in filter" row (`allInFilter`) and per-period columns (`months: true`).
