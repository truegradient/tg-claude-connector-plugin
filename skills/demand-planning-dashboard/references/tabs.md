# Tabs — UI specification

Each tab lists: purpose, tab-specific controls, sections (top → bottom), interactions,
empty/limit notes. Formulas live in `calculations.md`; never restate math here.

**Data.** Every number, list and table row on every tab comes from a `tg_dp_*` answer —
which call feeds which element is in `tab-tool-map.md`. Where this file says a table is
sorted, searched, totalled, paged or grouped, that is an argument to the tool, not page
code. Where it names a TrueGradient field (stored trust zone, AB class, …), it arrives in a
tool answer (`tg_dp_row_detail.attrs`, `tg_dp_table_page` `stored` columns).

**Naming in this file vs on screen.** "SKU", "Platform", "Region" and "Category" below are
shorthand for the columns `product_variant_code`, `channel_name`, `Region_name` and
`product_category`. The UI never shows the shorthand: it shows each column's label
(see "Filter bar and Settings"), e.g. a grain switch reads "By Product Variant ID |
By Product Variant ID × Channel Name × Region Name".

## Contents
- Global chrome
- **Demand Planning:** Forecast (1 Planner View + 8 Forecast Outlook) · 2 Accuracy · 3 Top Movers · 5 Anomalies · 6 Pacing
- **Inventory Planning:** 9 Inventory — Reorder & Health · Supply Plan · Transfers · Locations
- **General Analysis:** 4 YoY · 7 ABC Segmentation · 10 Forecast by Experiment
- Shared components

---

## Global chrome (always visible)

Header row:
- Title "<organization> Integrated Business Planning" — the organization is `company_name` from
  `tg_whoami` (e.g. "Acme Integrated Business Planning"); never hard-code it. Until
  it loads, or if the call fails, the title is "Integrated Business Planning". The browser tab
  title matches. Subtitle "Live TrueGradient · pick a view, set filters, refresh"
  (company name configurable via a `TITLE` constant; default no company).
- Right side: **connection pill** ("TrueGradient connected" green / "Connecting…" /
  error copy by code), **reload icon** (circular arrow, right of the pill: clears the
  connector cache and reloads roster + current tab; spins while loading — there is no
  "Refresh" button in the filter bar, because filters apply instantly), **Settings icon**
  (gear: opens the Settings panel below), **source badge** (experiment label · tag · "as of <date>" ·
  Live / Not a live run) that opens the Source drawer, Units ⇄ Revenue toggle,
  theme toggle (System / Dark / Light).

Source drawer: Pipeline select (only if >1 pipeline), Experiment select (label,
created date, description, live flag), "Reset to default", "Last loaded <time>".

## Navigation
Tabs come in three captioned groups, in this order (hash = tab id):
| Group | Tabs (hash) |
|---|---|
| Demand Planning | Forecast (`#forecast`) · Accuracy (`#accuracy`) · Top Movers (`#movers`) · Anomalies (`#anomalies`) · Pacing (`#pacing`) |
| Inventory Planning | Reorder & Health (`#inv-health`) · Supply Plan (`#inv-supply`) · Transfers (`#inv-transfers`) · Locations (`#inv-locations`, labelled "By <location>", hidden when the run has no location column) |
| General Analysis | YoY (`#yoy`) · ABC Segmentation (`#abc`) · Forecast by Experiment (`#experiments`) |
Each group = a small caption (11px, 600; accent when the active tab is in it) over its tabs; groups are
separated by a hairline and wrap as whole groups on desktop (horizontal scroll on mobile). Old hashes
redirect: `#planner`, `#outlook` → `#forecast`; `#inventory` → `#inv-health`.
### Organisation tab layout (Settings → Tabs)
Which groups and tabs show, and in what order, is **one shared setting per TrueGradient company**, the same for
everyone in the claude.ai organisation who opens the artifact.
- Hierarchical editor at the top of Settings: one card per group (checkbox = show the group, ↑ ↓ = group
  order, "n of m tabs"), and inside it its tabs (checkbox = show, ↑ ↓ = order within the group). Hidden items
  are struck through; at least one tab always stays visible. "Reset to default". Tab names follow the run
  (the Locations tab reads "By <location>").
- Stored in the artifact's shared store (`db` capability) at `orgs/<company_id>` =
  `{ groups: [{ id, hidden, tabs: [{ id, hidden }] }], updatedAt }`; group ids `demand`, `inventory`,
  `analysis`. **Isolated:** each TrueGradient company (`company_id` from the roster) has its own document,
  and the store belongs to this artifact only. Subscribed once with `onSnapshot` (10 s timeout → "couldn't
  reach the shared settings", default layout), writes debounced 400 ms, one at a time.
- Who changes it: db rules `{ path: "orgs", read: "view", write: "admin" }` — Editors and the owner
  (`user.canEdit()`); everyone else sees the editor read-only with "only editors can change it". A refused
  write turns the editor read-only.
- Status line: "Shared with everyone in your organisation for <company> · saved <time> · last changed <time>".
- Without the shared store (chat preview) the layout is saved in this browser per company
  (`localStorage["tgdp.tabs.<company_id>"]`) and the status says so.
- Tabs or groups added in a later version keep their default place; a hidden tab opened by link (#pacing)
  falls back to the first visible tab.
- Publish declares the full capability set: `{ db: { rules: [{ path: "orgs", read: "view", write: "admin" }] },
  mcp: { servers: [{ server: "TrueGradient", tools: [...] }] }, user: {} }` (a non-empty declaration
  replaces the stored one, so mcp must be restated).

**Forecast** has a View switch: **Plan & history** (the former Planner View, §1) | **Outlook** (the
former Forecast Outlook, §8 — forward totals, fan, quarters, breakdown, uplift / override share).

Global filter bar: one filter per chosen Final DA Data dimension column (default the
recommended top 4 — see "Filter bar and Settings"), then Months shown (Last 12 | Last 24 |
All) and **Clear filters** (outline). Filters apply as they change. Every label is the
column's label with a small ⓘ whose tooltip reads "Column: <column> (Final DA Data)".
Filters a tab ignores render disabled with tooltip "Not used on this tab". Active filter
chips summarise below on mobile. All dropdowns are custom searchable comboboxes (no native
`<select>`): search box, keyboard ↑ ↓ Enter Esc, 300-item cap with "keep typing", multi-
selects with checkmarks + Clear / Done, list rendered in a floating layer so it is never
clipped.

### Filter bar and Settings
- **Dimension columns, tiers, labels and the recommended four** come from
  `tg_dp_dimensions` (one call per run): `columns [{column, label, tier, distinct, nulls,
  leading, recommended}]`. The rules it applies: non-date, non-numeric, non-free-text
  columns, metric-like names excluded, leading key columns always in; tier 0 = key columns,
  1 = category / class / segment, 2 = planning attributes, 3 = names or > 50 values; labels
  in Title Case with acronyms upper-cased and "Code" → "ID". The same label is used in
  breakdown selectors, table headers, grain switches, scope text and chips on every tab.
- **Dropdown values** come from `tg_dp_filter_options` (values ordered by contribution, the
  column's own filter ignored so lists cascade, search on the server, 50 per page).
- **Settings panel** (gear icon; applies to the whole page, saved per viewer in
  `localStorage` keys `tgdp.filterBar`, `tgdp.labels`): one row per dimension column with
  [on-bar checkbox] [editable label] → `column_name` [Recommended] [n values] [↺ reset
  label] [↑] [↓]. Ticking adds the filter to the bar, unticking removes and clears it,
  ↑ ↓ order the bar, typing renames everywhere live (the ⓘ then says "renamed from …").
  "Reset to recommended" restores the default bar and labels.
- **Inventory Health** can filter only on columns that map to DOI Details:
  product_variant_code (→ component_sku or name), channel_name and Region_name (→ via
  warehouse allocation), product_category. Other filters show "Not used on this tab".
- Every active filter is passed to the tools as `{column, op: "in", values}` (the review
  screens accept only `in` / `eq`).

Below the bar: a tab-specific control row (month picker, Top N, granularity, view switch…).

### Granularity control (every demand tab where grouping applies)
A searchable multi-select labelled "Granularity (n) ⓘ", matching the TrueGradient app: the run's
ts_id columns first (marked "ts_id"), then every other column (label · n values). Any number of
columns combine (A × B × C × …), with no limit. Nothing ticked = **Overall (all filtered data)**
(on tabs that need a grouping, nothing ticked = each ts_id); ticking exactly the ts_id columns =
each ts_id (sent as `["@ts_id"]`).
Saved per tab in `localStorage["tgdp.gran"]` = `{tab: [columns]}`; a saved column the run
doesn't have falls back to the tab default. The choice is sent as the tool's `level`
(`group_by` on Top Movers, Anomalies, Pacing and Needs Attention); the server groups. Tables show one column per granularity column
(labels from Settings), a "ts_ids" count, and group values with "UNKNOWN" shown as "Unmapped".

| Tab | Default | Overall allowed | What it groups |
|---|---|---|---|
| Accuracy › Summary | Overall | yes | report table, chart focus |
| Accuracy › Month-end | ts_id | no | per-period table (+ "aggregated" column when not ts_id) |
| Top Movers | item column | no | movers; non-ts_id rows expand to their ts_ids |
| YoY | Overall | yes | breakdown table; leaders/laggards (Overall → item) |
| Pacing | first breakdown dimension | no | breakdown table |
| ABC Segmentation | item column | no | items (stored AB_Class/cluster compared only at ts_id) |
| Forecast Outlook | first breakdown dimension | no | stacked chart + "Outlook by" table |
| Anomalies | ts_id | no | "Flags by <granularity>" summary (flags still detected per ts_id) |
| Forecast by Experiment | item column | no | server `group_by` = granularity columns; revisions, run accuracy |
Not applicable: Forecast › Plan & history (one ts_id or the aggregate) and the Inventory Planning tabs (own level, §11;
warehouse; DOI Details has no demand dimension columns).

## 1 Planner View

Purpose: inspect one combo (or the filtered aggregate) end-to-end.
Controls: SKU / Platform / Region selects scoped to the global filter (pre-filled
when the global filter pins one value).
Sections:
1. Card header "<SKU> / <Platform> / <Region>" (or "Aggregate · N combos"), badges:
   sales pattern, forecast pattern, "Trust: <zone>", Lifestage, AB class.
2. KPI row (4): Overall accuracy, Latest-month accuracy, Rolling bias (3 mo),
   Contribution. Each with ⓘ tooltip.
3. Main line chart (history + 24-month horizon) with series toggles (checkbox legend),
   P10–P90 band, current-month divider, hover crosshair tooltip listing all series.
4. Monthly Metrics table: metric rows × months (Months shown governs history columns;
   all future months), sticky first column, horizontal scroll, highlight current month
   "(MTD)", YoY rows coloured by sign.
5. S&OP comments (if any) as a quiet note block.
6. Footnote describing data sources of each row.

## 2 Accuracy

View switch: **Summary** | **Month-end Accuracy**.
Summary (TrueGradient "Accuracy Deep Dive" layout, calculations §4.10):
- **The scored locked forecast always leads.** Compare forecast's first entry is the run's scored locked
  forecast (calculations §4.12: original Locked ML Forecast, else Lag_<global_lag_n>), marked "scored (always
  shown)", and cannot be removed; KPI tiles, trust zones and the headline always use it, like TrueGradient.
  Other forecasts (Consensus, other lags, Budget) are added after it for comparison only. A saved selection
  from an older version is reordered so the scored one comes first.
- **Every ts_id is scored**, as TrueGradient does — no row-scope switch. ts_ids with trust zone "Not
  Available" (no sales in the window) add no cells, so they don't move the numbers; on the Acme US run
  all 1,718 rows give TrueGradient's 25.5% / 34.8%.
- Controls: Granularity · **Compare forecast (n)** (multi-select, ≤ 4, `forecastMeasures`, saved
  `tgdp.cmpF`) · **From / To** (closed periods of the compared forecasts; "Full window" resets) ·
  **Metrics** (multi-select, saved `tgdp.accMetrics`): Trust zone, Combos, Contribution % (once per row);
  Overall, Rolling (3 <period>), Rolling aggregated, Rolling bias, Bias, Aggregated (errors net
  out), Sales, Forecast, Σ abs error, Share of error (per compared forecast); Accuracy by period,
  Bias by period. Default = Combos, Contribution, Overall, Rolling, Rolling aggregated, Rolling
  bias, Accuracy by period.
1. Reconciliation line, then KPI row (first compared forecast, window) at the granularity level
   (calculations §4.11): Overall accuracy, Rolling accuracy (3 <period>), Rolling bias, Combos
   scored. Overall / ts_id → TrueGradient's headline. Column granularity → titles gain
   "· <granularity>", qualifiers read "at <granularity> level · ts_id x%", bias says "same at every
   level", the 4th tile becomes "<granularity> groups scored · of N groups · M ts_ids".
2. Trust-zone chips "Trust zone · by <granularity>": per zone a count (ts_ids, or groups at a
   column granularity) and contribution %; a note lists the cut-offs. Overall / ts_id: ticking
   filters every tab (`trust_zone`). Column granularity: ticking keeps only groups in those zones
   on this tab; resets when the granularity changes. "Show all zones".
3. Trend chart: one line per compared forecast (Accuracy | Bias switch), ▼ drop markers, pills
   "Overall x%" "Rolling (3) y%". Shows "All in filter", or the group whose table row was clicked
   ("Show all in filter" resets).
4. Report table: "All in filter" pinned first (when granularity ≠ Overall), one row per group,
   sorted by contribution; grouped header row = forecast name over its metric columns, then one
   column group per period (newest first) with one column per compared forecast. Periods shown
   as columns are capped (24 months / 26 weeks / 31 days) with a note to use From / To.
   50 rows per page, sortable.
Month-end Accuracy:
- Inline controls: Month (closed months), Platform, Region, Find SKU.
- Table per combo: SKU, Name, Platform, Region, Sales, Lag-1 forecast, Lag-1 accuracy,
  Lag-1 bias, Prior-run consensus, Consensus accuracy, Consensus bias (consensus
  columns only when a previous experiment exists). Sorted by Sales desc; paginated
  50 rows; sortable headers; colour rules from calculations §14.

## 3 Top Movers

Controls: Month, Top N (5 | 10 | 25), Granularity (default the item column).
Sections:
1. "Top Movers — <scope>": diverging bar chart (green over, orange under), subtitle
   names the forecast-of-record source.
2. Over-Performers table: Product ID, Product title, Lifestage, LY-month Sales,
   Month Sales, Forecast, Deviation, Deviation %, Streak.
3. Under-Performers table: same.
Row click expands an inline sub-table with the Platform × Region breakdown.

## 4 YoY

Controls: Month range follows Months shown; Granularity (default Overall).
1. KPI row: YTD TY, YTD LY, YTD YoY%, next-3-months forecast vs LY %.
2. Grouped bar chart TY vs LY per month + YoY% line; forecast months hatched/lighter.
3. Breakdown table (rows = chosen dimension, columns: YTD TY, YTD LY, YoY%, L3M YoY%,
   N3M YoY%).
4. Leaders and laggards (two compact tables).

## 5 Anomalies

1. Counter chips per anomaly code with severity colour; click filters the table.
2. Table: Severity, Code (human label), SKU, Name, Platform, Region, Detail (e.g.
   "Oct'26 sales 3.1σ above 6-mo mean"), sparkline of last 12 months + next 6 forecast.
3. Row click → opens Planner View for that combo (sets filters, switches tab).
Empty state: "No anomalies for these filters."

## Source drawer — layout
Single column, three blocks, nothing side by side that can overlap:
1. **Top row** (flex, wraps): Pipeline picker (if several), Experiment picker (flexible width,
   max 640px, label truncates with ellipsis), then "Reset to default" + "Last loaded" right-aligned.
2. **About this run** (label above value, auto-fill grid): Description (full width), Module,
   Pipeline, Status (Live / Not live · Archived · Production), **Created** (exact time,
   "2 Nov 2026, 08:29 UTC"), **Last updated** (exact time when the connector returns one of
   `UPDATED_FIELDS`, else "Not provided by the TrueGradient connector yet"), **Sales data
   through** (date · source, calculations §1.2).
3. **Run setup** (below), then a footer note on how the default run is chosen.

## Source drawer — About this run
Experiment (name + chips) · Experiment ID (monospace, copy) · Description (only when set) · Tag chip ·
Module chip · Created at / Updated at (two-line timestamps) · Sales data through ("Oct 31, 2026" ·
source). No separate Status row — the chips carry it. The experiment picker uses rich options.

## Source drawer — Run setup
Below the description: "Run setup (TrueGradient configuration)" from `tg_experiment_details`:
ts_id (labels and column names), frequency, forecast horizon, validation horizon,
**accuracy lag (global_lag_n)** ("Lag 4 — scores Locked ML Forecast Lag_4"; "not set — Lag 1"),
**rolling horizon (past_accuracy_horizon)**, test horizon, activity end date, **accuracy scored on**
(the resolved basis, calculations §4.12; highlighted chip, or a warning chip on the validation
fallback), **locked forecast columns** in the run (chip per column with its period count; the
scored one highlighted), target, date column, history used, accuracy metric, models, ensemble,
column mapping, drivers, input datasets (de-duplicated). If details are unavailable: "Not
available from TrueGradient — grain and ts_id are read from the data."
Every list value renders as **chips** (`.tag` pills: label + muted small text), never as a
comma- or "·"-separated string; scalars stay plain text. Long lists span the full row.

## Accuracy basis line (Accuracy › Summary, Month-end)
Below the reconciliation line, a chip row "Accuracy basis": scored column (highlighted),
`global_lag_n = n`, window first–last + period count, activity end, "Rolling = last n <periods>
· past_accuracy_horizon", "Error = Abs Error column, else |Sales − locked|", then ⓘ. On the
validation fallback: a warning chip "Validation-period fallback", window, activity end,
"Window = latest n Sales <periods> · validation_horizon", "Rolling = overall", and the forecast
source (Final DA ML Forecast, or "Rebuilt from stored accuracy × Sales" as a warning chip).

## 6 Pacing

Grain-aware (calculations §0.1, §8). Daily experiments: no period picker — the card
paces the current calendar month from real daily sales against the daily plan, the chart
shows the real cumulative actual, there is no weights calendar, and the lead note says
"This experiment is daily, so pacing uses the real daily sales of this month against the
daily plan". Weekly experiments: the picker lists weeks, the subtitle names the week's
dates, totals are "WTD", and the weights calendar shows the week's 7 days.

Dates (calculations §1.2, §8): pacing is measured at "Sales data through" = the run's last
update (daily refresh; inclusive), else the run date. The control row shows "Sales data
through <date> · <source>"; there is no "Include run day" checkbox. The
cumulative chart shows a dashed "Data through <date>" line and, if today falls in the period,
a solid "Today <date>" line; the summary lists both; a notice appears when the data is more
than 2 days older than today or the run's period has already ended.

Controls: Month / Week (current period default; past periods allowed), Units / Revenue (mirrors global).
1. "Pacing — <scope>" card: subtitle "N of D days elapsed. Expected pace today: X% of
   the month's forecast (flat calendar | weighted). MTD actual: …". Semicircle gauge
   0–150% (calculations §8) with legend; Summary list on the right: banked %, pace
   index, projected month-end, gap, revenue context.
2. Cumulative Pacing chart: expected cumulative line for the full month, actual MTD
   segment, dashed "today" line.
3. Breakdown table (dimension selector) with status pill per row. **Status filter chips** above it: "All n" ·
   Behind · Near · On pace · Ahead · No pace yet (only statuses present, each with its count and status colour;
   multi-select, "All" clears); when filtered, a line "n of m shown · MTD … · gap …" sums the shown rows. Kept for
   the session (`S.ui.paceStatus`); it filters the breakdown rows only, not the summary or gauge. with the inventory cap on it adds
   "Inventory available" and "Target" (a "capped" pill where stock is short), both with ⓘ.
   Inventory cap control (current monthly / weekly period): Off · On hand (default) · On hand + in transit.
   Summary list adds "Inventory available" (MTD sold + on hand [+ in transit]) and "Target (inventory-capped)"
   with "n of m capped"; **two gaps**: "Gap to target" (projected − capped target: what selling can still close)
   and "Gap to forecast" (projected − uncapped forecast: the full shortfall, incl. what stock can't cover); the
   breakdown has both columns too; the cumulative chart draws the expected line to the target plus a
   dashed grey "Forecast, uncapped" line when the cap bites; the guide card explains how many series are capped.
   The pacing explainer artifact (PACING_EXPLAINER_URL) has an "Inventory cap" section with a worked example.
4. "Pacing weights" disclosure: a **compact month calendar** (Sun–Sat, cells ~38px, max ~430px wide).
   Every date always shows its weight under the day number ("×1", "×3", "×30"); weight ≠ 1 is accented with
   a fill proportional to the weight, ×0 faded, weekends shaded. **Clicking a date opens a small popover**
   anchored to it: the date, a **vertical slider 0–50**, a number box for any value 0–999 (decimals allowed)
   and presets ×0 ×1 ×2 ×3 ×5 ×10. Dragging updates the box and the cell live; saved on release, on leaving
   the box or on a preset; the popover stays open on that date until ×, Esc or a click outside. 1 = normal
   day (default), 3 = typical promo, 0 = closed. One-line note + ⓘ (formula). **Default: Black Friday ×10** in any period that contains it (summary
   reads "default: Black Friday ×10"; the guide says "weighted by the default Pacing weights"). Editing any day
   starts from what is in effect (defaults included) and saves the whole set. Buttons: "Reset to default (Black
   Friday ×10)" (clears saved weights) and "Flat calendar" (saves `{}`); periods without Black Friday show "Reset
   to flat calendar".
   Saved per viewer in localStorage `tgdp.pacing.<grain>.<period end>` as `{ day: weight }` (1 not stored).

## 7 ABC Segmentation

Controls: Granularity (default the item column), A-cut, B-cut, X-cut, Y-cut (number inputs with defaults).
1. 3×3 ABC × XYZ matrix: count, value share; click a cell filters the table.
2. Pareto chart (bars per item sorted, cumulative % line, 80/95 guides).
3. Table: item, name, 12-mo value, share, cumulative share, ABC, CoV, XYZ, stored
   AB_Class, stored cluster, "differs" flag.

## 8 Forecast Outlook

Controls: Horizon (6 | 12 | 24 in the run's grain), Granularity (default first breakdown dimension).
1. KPI row: next-3-months forecast, next-12 forecast, vs LY %, Planner/RL uplift vs ML,
   override share.
2. Fan chart: Consensus line, ML dashed, RL Unconstrained dotted, LY grey, P10–P90 band;
   band caveat note.
3. Quarterly table with growth vs LY.
4. Breakdown stacked area/bar by chosen dimension.
5. Forecast-pattern mix (horizontal stacked bar by volume).

## 9 Inventory Planning (four tabs)

**Inventory is shown at its own level, never the forecast granularity** (calculations §11).
- Level = DOI Details' item column (component SKU, else the run's 1st ts_id column) and, when the
  run has one, its **location** column: a real `Warehouse` / `Location` column, else the run's 2nd
  ts_id column (e.g. `sku_standard` × `Channel`). `Fulfillment Node` is the supply source,
  shown as "Fulfilled by", never as a location.
- Context strip on every inventory tab: "Inventory planned at" chips — `<item> × <location>` (DOI
  Details), As of, "<location> = stock location · the run's 2nd ts_id column" when inferred, or "No
  location column · item level only"; plus a note listing global filters that don't apply.
- **Inventory level** control (Reorder & Health, Supply Plan) when a location exists:
  `<item> × <location>` (native) | `<item> × base warehouse` (only real warehouses with allocation suffixes;
  Reorder & Health) | `<item> only` (`inventoryByItem`, `pivotSupplyPlanByItem`). Roll-ups follow the
  inventory report: quantities summed, DOI from the largest location(s) (calculations §11).
- Global filters apply when the inventory dataset has the same real column; warehouse→region /
  channel allocation applies only when locations are real warehouses.

Tabs, by importance:
1. **Reorder & Health:** KPI tiles (§9) · risk chart + summary · detail table at the chosen level
   (table id `invHealth`), columns in a planner's reading order, groups divided by a vertical rule:
   - identity: item (frozen), location (or "<location>s" count at item level), Name (wraps), region (only
     real mapped warehouses), Fulfilled by;
   - stock: On hand · In transit · Open PO;
   - demand: Sales, 7 days · Sales, 30 days (when DOI has `sales_last7days` / `sales_last30days`) ·
     Sales / day · Forecast, next 30 · Forecast, next 60 (Supply Plan Forecast, first / first two months) · Forecast / day;
   - coverage & risk: Days on inventory · DOI, current stock · **DOI, 7-day sales** · **DOI, 30-day sales**
     (all red < 30 days, amber > 365) · OOS date · Risk. The two sales-based DOIs use actual sales, not the
     forecast: on hand ÷ (sales_last7days ÷ 7) and on hand ÷ (sales_last30days ÷ 30), rounded; no sales in the
     window → "—". Totals row = Σ on hand ÷ Σ daily sales rate. Shown only when the run has those columns;
     at item level the 7 / 30-day sales are summed over locations first.
   - replenishment: Reorder now (+ Due) · Reorder date · Reorder point · Safety stock · MOQ · Lead time;
   - exposure: Excess · Lost sales · Cost price (COGS / AVG COGS) · Selling price · On-hand value ·
     Reorder value · Excess value · Dead value · Lost-sales value;
   - **Contribution %** at the right end (all tables put it there).
   Hidden by default (Columns menu): Sales / day, Forecast / day, Dead value, Selling price. A column only
   appears when the run has data for it. Search box "Search <item> or name" (item, name, location; "n of m
   match"). Totals row for every quantity and value. Default sort: contribution; Risk header = stock-risk
   ranking. Dates as "Nov 9, 2026". Quick filters.
2. **Supply Plan:** level control + picker "<level>" ("All in filter (n <level>)"), combo chart,
   variable table, identity badge, OOS timeline.
3. **Transfers:** "Transfers by lane — from <location> → to <location>" (To = the row's location
   column; "not given" if missing) + recommended transfers (item · From <location> · To <location>).
4. **Locations** ("By <location>"): grouped table, risk heatmap, value bars. Group-by offers base
   warehouse / region / channel allocation **only** for real warehouses with a region mapping; the
   warehouse-mapping card shows only then. Hidden (empty state) when the run has no location.

## 10 Forecast by Experiment

Motive: compare runs (planning cycles) to see how consistent the forecast and its accuracy are.
Controls: Runs from (This pipeline | All pipelines) · **Frequency** (Monthly | Weekly | Daily |
All — only grains present, default the current run's) · **Add a run to compare** (searchable
picker: label · created date · pipeline (all-pipelines scope) · Production · Archived; live and
archived runs) · **+ Previous <frequency> run** button · Granularity. Metric follows Units | Revenue.
1. **Runs to compare** card ("n of 6"), TrueGradient's columns: swatch · **Experiment** (name, monospace
   ID with copy, chips) · **Tag** · **Module** · **Created at** · **Updated at** (two-line timestamps) ·
   Forecast as of · Remove. Chips:
   Current source, Live/Archived, Production, frequency, "Other frequency · rolled up",
   "Different ts_id/target · not like-for-like". Forecast as of = date input (default created_at;
   Reset when changed). Remove is not offered on the current source. The add-run picker uses rich
   options (design-system principle 4). Note explains the default, archived runs and any mixed-frequency roll-up.
2. Line chart: total forecast by target period per run + actual Sales.
3. **Forecast consistency across runs**: 3 KPI tiles + period × run table with spread and CoV.
4. **Revisions — current vs baseline** with a Baseline picker.
5. **Accuracy of each run by lag**: run · as of · All lags · Lag 0…n.
With only the current run: runs card + chart + empty state "Add a run to compare" pointing to the
picker and the Previous-run button.

## Shared components

- **KPI tile**: label, big number, small delta/qualifier, ⓘ tooltip with formula text.
- **Table** (`dataTable`, every table on every tab): sticky header, numeric right-aligned with tabular
  figures, 50-row pages, and a **⤓ CSV** button in every table's toolbar (beside Columns).
  - CSV = what the table shows: every matched row (not just the loaded page), the visible columns in their
    current order with their labels as headers, the current sort and search, the totals row last. It is built on
    the server by `tg_dp_export_csv` with the table's arguments, which returns a signed link valid ~4 minutes.
    File name = card title + tab + date (`Reorder_health_by_SKU_Standard_inv-health_2026-11-17.csv`).
  - The link is saved through the `downloads` capability (or opened directly where it is unavailable, e.g. chat
    preview); declined / rate-limited / expired shown on the button. Tables built from a non-table tool (accuracy
    report, review screens) export the rows the page holds. Publish declares `downloads` in the full set.
  Every table can be **sorted, reordered, hidden and frozen** by the viewer:
  - a toolbar above the table: "n columns · m hidden · k frozen · sorted by <col> ↑/↓" + **Columns ▾**;
  - **Columns** menu (popover, kept on screen): per column a show/hide checkbox (the last visible column
    can't be hidden), 📌 freeze up to this column (click the last frozen one to unfreeze it), ↑ ↓ move;
    Show all · Reset table · Done; closes on Esc / outside click;
  - drag a header onto another to move it; click a header to sort (again to reverse);
  - frozen columns stick to the left while scrolling sideways, with a shadow on the last one; left
    offsets are measured after render;
  - totals rows are per column (`footerCells`), so they follow reordering and hiding; the values come from the
    tool's `totals` / `total` (over every matched row), never from summing the loaded page;
  - **column ⓘ** (`tip` on a column): every calculated or TrueGradient-derived column carries its formula
    in a small ⓘ next to the header label (hover / focus shows it; clicking it doesn't sort). The card
    subtitle stays one short line — formulas live in the column ⓘ, not in paragraphs above the table.
    Contribution % always has one. Reorder & Health: On hand, Sales 7 / 30 days, Forecast next 30 / 60,
    Days on inventory, DOI current stock (= days until on-hand runs out against the forward forecast, the
    same as days to the OOS date), DOI 7 / 30-day sales, OOS date, Risk, Reorder now, Reorder point, Safety
    stock, Excess, Lost sales, every value column, locations count;
  - optional `search` (text box in the toolbar filtering rows, "n of m match") and `defaultHidden` columns
    (used until the viewer saves their own choice);
  - saved per table in `localStorage["tgdp.tbl.<id>"]` = { order, hidden, freeze, sort, dir }; new columns
    keep their default place; Reset clears it. Default freeze = the table's sticky first column.
  - Tables with grouped header rows (Accuracy report) keep their order (groups span fixed columns) but
    can be sorted and frozen.
  - **Contribution % by default.** Every table whose rows are entities (groups, items, ts_ids, locations)
    gets a "Contribution %" column (the tool's `contribution` value or `derived: ["contribution"]`, placed
    at the **right end** of the table) and is sorted by it on the server, largest first: demand rows = Σ Sales of the
    last 3 closed periods ÷ the table's scope total; inventory rows = Σ recent sales ÷ scope total. Applies to Accuracy report, Month-end, YoY breakdown, Pacing breakdown, ABC, Outlook by
    group, Anomalies by group, Reorder & Health, Locations. Ranked lists keep their ranking and only add
    the column (`keepSort`): Top Movers (deviation), Anomalies list (severity), Leaders / Laggards,
    Revisions. Period tables (quarters, consistency) have no contribution.
  - The toolbar names the active sort; **"<source> order"** (e.g. "DOI Details order") or **Original order**
    shows rows exactly as the dataset lists them (saved as sort "__none").
- **Pills**: status colours from design-system.
- **Section error**: inline panel with code-specific copy + "Try again" (reads only).
- **Skeletons** while loading; never a blank card.
- **"How it's calculated"** ⓘ: text pulled from a single `EXPLAIN` map so wording stays
  identical to calculations.md.
