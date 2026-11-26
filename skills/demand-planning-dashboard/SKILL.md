---
name: demand-planning-dashboard
description: Build, rebuild, extend or validate a live TrueGradient demand-planning and inventory-health dashboard as a published claude.ai artifact (tabs Planner View, Accuracy, Top Movers, YoY, Anomalies, Pacing, ABC Segmentation, Forecast Outlook, Inventory Health, Forecast by Experiment) that reads data live through the TrueGradient connector. Use this skill whenever the user mentions TrueGradient experiments, Final DA Data, DOI Details, Supply Plan, Stock Transfer, forecast accuracy / bias / pacing / top movers / ABC-XYZ / inventory health dashboards, an S&OP or demand-planning artifact, or asks how any metric in such a dashboard is calculated — even if they don't say "skill" or "dashboard". This skill is the single source of truth for every formula, default and data rule used by that artifact.
compatibility: Needs the TrueGradient connector with the server-side tg_dp_* tools (tg_dp_context, tg_dp_accuracy_summary, tg_dp_table_page and the rest listed in references/runtime-and-connector.md) plus tg_whoami, tg_list_experiments_for_analysis and tg_experiment_details, and the Artifact tool with the runtime `mcp` capability.
---

# TrueGradient Demand Planning Dashboard

A recipe for one specific artifact: a dark/light themed, multi-tab planning cockpit that
reads a TrueGradient experiment **live in the viewer's browser** through the claude.ai `mcp`
runtime capability. **Every number is computed on TrueGradient's server by the `tg_dp_*`
tools** — inside the Query Engine, over all rows of the run — and the page only asks for
what it shows (a KPI block, a chart, one table page). The page never downloads a dataset and
never computes a metric, so it opens a 1,000-row run and a 1,000,000-row run in the same
time and memory.

The skill has two jobs:
1. **Build** — produce the published artifact with as few iterations as possible.
2. **Validate** — be the written-down logic a planner can audit. `references/calculations.md`
   states every rule; the `tg_dp_*` tools implement them and are verified against the
   TrueGradient app (Accuracy Deep Dive: overall, rolling, rolling aggregated, rolling bias,
   trust zone all equal to two decimals on a live run). If the dashboard and the app
   disagree, it is a bug.

## Reference map — read what the task needs

| File | Read when |
|---|---|
| `references/runtime-and-connector.md` | Always before writing data code. Manifest, every tool's arguments and answer shape, the gateway, size rules, paging, CSV, errors, build check. |
| `references/tab-tool-map.md` | Always. Which tool each tab calls on open and on each interaction. |
| `references/tabs.md` | When building UI. Layout, controls, charts and tables for the 3 tab groups (12 tabs) plus global chrome. |
| `references/calculations.md` | To explain or audit a number (tooltips, "how this is calculated", acceptance checks). The tools implement it; the page never re-implements it. |
| `references/data-model.md` | To understand the datasets behind the tools (grains, column naming, joins, quirks). |
| `references/design-system.md` | When styling. Dark + light tokens, type, chart palette, component rules. |
| `references/build-prompt.md` | When the user says "build the artifact using the skill / the prompt". The full build prompt, ready to follow. |
| `scripts/check_page.js` | Run on the finished HTML before publishing (`node scripts/check_page.js page.html`). |
| `scripts/tg_calc.js`, `scripts/test_tg_calc.js` | Reference implementation of calculations.md, kept for audits and parity checks. **Never inline it into the page.** |

## Build workflow

Follow these steps in order. Skipping step 2 is the most common cause of a broken page.

1. **Read** `runtime-and-connector.md`, `tab-tool-map.md`, then `tabs.md` and
   `design-system.md` (and the frontend-design skill if present).
2. **Observe the connector for real in this session** (never ship a guessed tool shape):
   - `tg_list_experiments_for_analysis` (no module filter) → pick the default source with
     the rule below.
   - `tg_dp_context` for that experiment → periods, grain, basis, compare list, dims, row
     counts. `tg_experiment_details` → run setup for the Source drawer.
   - One answer from each tool family the page uses: `tg_dp_accuracy_summary`,
     `tg_dp_table_page` (page_size 3), `tg_dp_series`, one review screen
     (`tg_dp_top_movers`, `top_n` 2) and `tg_dp_inventory_health` (page_size 2).
   Learn shapes from these, but never paste the observed values into the page.
3. **Load the `artifact-capabilities` skill** and follow its current `mcp`, `db`, `user`
   and `downloads` contracts.
4. **Write one self-contained HTML file**:
   - one gateway function through which every call goes (runtime-and-connector.md §4) —
     size rules, 6 in flight, debounce, shared in-flight calls, stale-answer drop, a small
     result cache keyed by the run's `updatedAt`;
   - the tabs from `tabs.md`, each getting its data exactly as `tab-tool-map.md` says;
   - no row loops, no sums, no metric formulas in page code — formatting and layout only;
   - dark + light themes from `design-system.md`.
5. **Self-check** — run `node scripts/check_page.js <file>`, then walk the checklist below.
6. **Publish** with the Artifact tool, declaring the full capability set (manifest in
   `runtime-and-connector.md` §1, plus `db`, `user`, `downloads`). Tell the user in one line
   that the first open asks them to allow the TrueGradient connector.

## Non-negotiables (why they matter)

- **Live, never embedded.** No TrueGradient values in the HTML. The page always reads the
  connector, so it stays current and can be shared without leaking a snapshot.
- **The server computes; the page shows.** Every number comes from a `tg_dp_*` answer. The
  manifest does not declare `tg_fetch_dataset`, `tg_dataset_info` or `tg_resolve_datasets`,
  so the page cannot pull rows in bulk; `check_page.js` fails if their names or any
  client-side metric code appears. If a view needs a number no tool returns, add an argument
  (or use `tg_dp_compute`), don't compute it in the page.
- **Ask small questions.** The tools never truncate; the skill sets the limits (page size
  10–100, ≤ 12 series per chart, ≤ 2,000 rows held per tab — runtime-and-connector.md §5).
  Tables page, sort, search and total on the server; CSV comes from `tg_dp_export_csv`.
- **Accuracy is bottom-up at the ts_id grain** (each Final DA Data row scored on its own,
  errors summed), exactly as TrueGradient's all-level report — `tg_dp_accuracy_summary` does
  this. The scored forecast, window and rolling horizon come from the run's configuration
  (`meta.basis` / `tg_dp_context.basis`: original Locked ML Forecast if positive, else
  `Lag_<global_lag_n>`, else the validation test split, else stored values). Always show the
  basis line on Accuracy. Periods up to the run's activity end are scored, including the
  current one, as the app does.
- **Granularity = the `level` argument.** as in the TrueGradient app: any number of columns (ts_id columns
  first); nothing ticked = Overall; exactly the ts_id columns = each ts_id; on every
  tab where grouping applies. At a column level the tools group first and also return the
  ts_id value beside it, so the TrueGradient match stays visible.
- **Trust zones use the company's own thresholds** (`tg_dp_trust_zones.thresholds`, from the
  run's `scenario_plan.trust_zone_thresholds`, else 80/70/60/40/20) on rolling accuracy.
  Never hard-code cut-offs in the page.
- **The run's own configuration is the source of truth for its shape** — ts_id, grain,
  periods, activity end, horizons all come from `tg_dp_context` and `tg_experiment_details`.
  Experiments can be daily, weekly or monthly: use the period words for the grain, never
  "Month"/"MTD" literally.
- **Matching TrueGradient is the top priority.** Accuracy and Forecast show the
  reconciliation line from `tg_dp_accuracy_summary {reconcile: true}`: "✓ Matches
  TrueGradient: N ts_ids scored · stored errors match k/k periods". Only checks that move a
  headline number warn.
- **Review screens are TrueGradient's own.** Top Movers, Anomalies, Pacing and Needs
  Attention come from the same Query Engine computation the app's Review List uses; show
  their `meta.notes` (the planner review queue is not available to the connector).
- **Labels come from Final DA Data column names** (`tg_dp_dimensions.columns[].label`).
  Never "SKU", "Platform", "Region" or "Category". The viewer can rename any label in
  Settings; each filter label has an ⓘ that names its column.
- **Units and revenue come from twin datasets** — the toggle only changes `unit`. Never
  multiply units by a price in the page.
- **Say what's missing instead of inventing it.** A tool's `E_NOT_FOUND` (e.g. no Stock
  Transfer), `E_NO_BASIS` or a `meta.notes` line is shown as a one-line note on the tab.
- **Degrade per section.** A failed call greys out its own section with the code-specific
  copy; the rest of the page keeps working.

## Default source experiment (user rule)

Sort the roster by `createdAt` descending first — the connector's archived fallback list is
**not** sorted. **"Live" = `isArchive: false`** — every completed, non-archived run is live.
`isProduction` does **not** mean live: it is a separate "Production" flag, shown as its own
label, and only decides which live run is the default inside a pipeline (its live production
run, else its newest live run). An archived run is never live, even with the production
flag. If only archived runs exist (`used_archived_fallback: true`), nothing is live: prefer
the newest full `inventory-optimization` run (it carries all six datasets), mark the badge
"Not a live run · Archived", and say a run may be re-computing.
If live experiments span more than one pipeline (`tag`), show a Pipeline selector; each
pipeline defaults to its first (newest) live experiment, and the page opens on the pipeline
of the newest live experiment. With one pipeline, default to that pipeline's live production
run, else its newest live run. If nothing is live, fall back to the first completed
experiment in the roster and label the badge "Not a live run". The user can switch
pipeline/experiment at any time; remember the choice per viewer in `localStorage` and offer
"Reset to default". Full rule: `calculations.md §1`.

## Pre-publish checklist

Data path
- [ ] `node scripts/check_page.js <file>` passes: no `tg_fetch_dataset` / `tg_dataset_info`
      / `tg_resolve_datasets`, no row cache, no client-side metric code, manifest = §1.
- [ ] Every call goes through the gateway: size rules enforced, ≤ 6 in flight, debounced
      input, shared in-flight calls, stale answers dropped, cache keyed by run `updatedAt`.
- [ ] Each tab makes the calls in `tab-tool-map.md` and nothing else; hidden tabs make none;
      returning to a tab is served from the gateway cache.
- [ ] Tables page / sort / search / total through the tool (cursor or page number); totals
      cover every matched row; "n of N" from `meta.page.total`.
- [ ] Every table: ⤓ CSV via `tg_dp_export_csv` (same columns, labels, filters, level,
      search, sort), saved through the downloads capability.
- [ ] Each section shows the tool's typed error (`E_TIMEOUT`, `E_COLUMN`, `E_NOT_FOUND`, …)
      with its fix; never a half-rendered answer.

Numbers
- [ ] With no filters, Overall / Rolling / Rolling aggregated / Rolling bias / each period equal
      TrueGradient's Accuracy Deep Dive for the same run; combos = its row count.
- [ ] The reconciliation line reads "✓ Matches TrueGradient …" on real data.
- [ ] The basis line names the scored column, `global_lag_n`, the window up to activity end and
      the rolling horizon (`meta.basis`); fallback paths show their note.
- [ ] Trust-zone chips use the tool's thresholds and counts; at a column granularity they count
      groups by their own zone.
- [ ] Contribution of all rows sums to 100%.
- [ ] Units ⇄ Revenue changes every tab's numbers, labels and formats (only `unit` changes).
- [ ] Inventory tiles reconcile with the detail-table totals (both from `tg_dp_inventory_health`).

Interface (unchanged from the previous version)
- [ ] No observed data values hard-coded; loading, empty and error states render for every tab.
- [ ] Source badge: experiment label, pipeline tag, run date, live / not live, separate
      "Production" label; Run setup from `tg_experiment_details` with chips.
- [ ] Filter labels are column labels with ⓘ; Settings lists label → column, rename,
      add/remove, reorder, Reset; global filters apply to every tab that has the column,
      others show "Not used on this tab".
- [ ] Granularity on Accuracy (Summary + Month-end), Top Movers, YoY, Pacing, ABC, Outlook,
      Anomalies and Forecast by Experiment; saved per tab.
- [ ] Accuracy Summary: Compare forecast (≤ 4, scored one pinned first), From / To, Metrics
      picker, trust-zone chips, trend with ▼ drops, "All in filter" pinned row.
- [ ] Pacing measured at the data-through date ("Data through" dashed, "Today" solid, stale
      notice > 2 days); inventory cap control (Off · On hand · + in transit); weights calendar.
- [ ] Entity tables default-sorted by Contribution %; ranked lists keep their ranking.
- [ ] Every table: Columns menu (show/hide, reorder, freeze), header sort, settings saved per table.
- [ ] Forecast by Experiment starts with the current run only; runs are added (≤ 6) with an
      editable "forecast as of" date; consistency, revisions and accuracy-by-lag render.
- [ ] Tabs in three groups; Settings → Tabs shared per TrueGradient company in db
      `orgs/<company_id>` (editors write, others read-only).
- [ ] Inventory at its own level (item × location); Locations tab only with a location column.
- [ ] Title "<company_name from tg_whoami> Integrated Business Planning".
- [ ] Weekly and daily runs render with their period words ("3 wk", "WTD").
- [ ] Dark and light themes pass contrast; mobile filter bar wraps; tables scroll in their own
      container; every chart and KPI has a "how this is calculated" ⓘ worded like calculations.md.
- [ ] Granularity works like the TrueGradient app: a multi-select of the ts_id columns first, then
      every other column, any number combined; nothing ticked = Overall (each ts_id on tabs that
      need a grouping); exactly the ts_id columns = `["@ts_id"]`; the label shows the count.
- [ ] Dropdown lists: clicks inside an open list never reach the page's outside-click handler
      (stop propagation on the list), so ticking keeps it open until Done; the list is anchored to
      its button in page coordinates (scrolls with it), its height fits the visible space (opens
      upward when there is more room above), and a resize or inner scroll repositions it, never closes it.
- [ ] A new grouping, filter, sort or run sends every table back to page 1.
- [ ] Controls that depend on a loaded answer go into a slot made once per render, never appended
      from inside a loader (reloads must not duplicate them or leak them onto another tab).
- [ ] Table search keeps the caret while the table reloads; charts are only drawn into boxes still
      on the page; switching run clears the previous run's error.
- [ ] Money (stock value at cost, lost sales at price, money at risk) always shows the currency sign.
- [ ] The skill and the page carry no client data: no company, item, warehouse or run names from
      any real account; examples use placeholders (ITEM-A1, Web store, WH_US_1, Acme).
