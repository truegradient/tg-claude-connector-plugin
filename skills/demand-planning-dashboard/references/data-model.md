# Data model — TrueGradient inventory-optimization experiment

The page never reads these datasets directly: the `tg_dp_*` tools read them on the server
(Parquet first, CSV fallback) and return answers. This file explains what lies behind those
answers — dataset names, grains, column naming, joins and quirks — so tooltips, notes and
empty states are worded correctly. Shapes of the tools' answers: `runtime-and-connector.md`.

## Contents
1. Experiments roster
2. Datasets at a glance
3. Final DA Data / Final DA Data Value (demand)
4. DOI Details (inventory snapshot)
5. Supply Plan / Supply Plan Value (time-phased inventory)
6. Stock Transfer
7. Warehouse → region / channel mapping
8. Joins between demand and inventory
9. Known quirks (read before trusting a number)

---

## 1. Experiments roster

`tg_list_experiments_for_analysis` (optional `module`: `demand-planning`,
`inventory-optimization`, `pricing-promotion-optimization`) returns completed,
non-archived experiments, **newest first**:

```
{ id, label, exp_description, module_name, tag, createdAt (epoch ms),
  experimentStatus, isProduction (bool), isArchive (bool) }
```

- `tag` = pipeline name (e.g. "Baseline").
- `isArchive` = the live flag: **live = `isArchive: false`**. Every non-archived run is live.
- `isProduction` = TrueGradient's "Production" flag. It does **not** mean live; it only picks
  the default run inside a pipeline and is shown as a separate "Production" label.
- `used_archived_fallback: true` at top level means only archived runs exist — say so.
- **As-of date** of an experiment = UTC date of `createdAt`. It matches the DOI
  `TG Reorder Date` and the day-0 of `Current_OOS_Date` (verified: createdAt
  2026-11-02, OOS 21 days later = 2026-11-23 = `DOI_Current_Stock` 21).

Inventory-optimization experiments carry the demand datasets too; a separate
demand-planning experiment is not required. Demand-planning-only experiments expose
the `Final DA Data*` datasets and not the inventory ones — tabs that need missing
datasets show "This experiment has no <dataset>".

## 2. Datasets at a glance

| Dataset | Grain | Size (reference run) | Used by tabs |
|---|---|---|---|
| Final DA Data | sellable SKU × channel × region | ~2,000 rows × 632 cols | all demand tabs |
| Final DA Data Value | same, currency | same | Revenue toggle |
| DOI Details | component SKU × warehouse | ~1,100 × 76 | Inventory Health |
| Supply Plan | component SKU × warehouse × Variable | ~12,000 × 42 (11 Variables) | Inventory Health › Supply plan |
| Supply Plan Value | same, currency | same | Revenue toggle |
| Stock Transfer | component SKU × to-warehouse × from-warehouse | tens of rows | Inventory Health › Transfers |

The column set changes every run (date columns roll forward), so never hard-code a date
column name: periods, measures and their dates come from `tg_dp_context` (`periods`,
`measures`), dimension columns from `tg_dp_dimensions`.

## 3. Final DA Data / Final DA Data Value

### Key and attribute columns
`product_variant_code` (label "Product Variant ID"), `channel_name` ("Channel Name"),
`Region_name` ("Region Name"), `product_name`, `variant_name` (display name; fall back to
product_name, then product_variant_code when "UNKNOWN"), `product_category` ("Product Category"),
`Lifestage` (Existing, Transition, New_product, New_60days, New_60_90days),
`sales_pattern_category`, `forecast_pattern_category`, `cluster` (e.g. clusterAX),
`AB_Class` (A/B), `% Contribution Last 3 Months`, `Attention` (High/Medium/Low),
`trust_zone` (Highly Trusted, Trusted, Review, Planner Review, Low Trust, Critical,
Not Available), `overall_accuracy`, `rolling_accuracy`, `Imputation Flag` (0/1),
`SnOP Comments`, `0_Sales_Lag_1_Months`, `0_Forecast_Horizon_1_Months`.

UI labels are derived from these column names (tabs.md "Filter bar and Settings");
never relabel them as SKU / Platform / Region / Category.

Date columns are `<YYYY-MM-DD> <measure>` at the experiment's **grain**: month ends for
monthly runs, one date per week (week end or week start — see calculations §0.1) for
weekly runs, one per day for daily runs. Detect the grain from the dates; never assume
months. `Locked ML Forecast Lag_1` is the forecast frozen one **period** earlier.

**ts_id comes from the run's configuration** (`tg_experiment_details` →
`series.ts_id_columns`), not from a hard-coded list; the tools apply it on the server and
report it as `tg_dp_context.config.tsIdColumns` (only when every column exists in Final DA
Data, else the default product_variant_code, channel_name, Region_name). Row keys in tool
answers (`key`, "col1|col2|col3") follow it.

One row = one ts_id. A product × channel pair is **not** unique: it can have one row per
region (US / UK / ROW), each with its own forecast. Accuracy is scored per row.
A run can be re-computed under the **same experiment id** (row count can change, e.g.
2,057 → 681) — never reuse cached rows across page loads.

`comboKey = product_variant_code | channel_name | Region_name`. Rows with SKU "UNKNOWN" are kept in totals and
listed as "Unmapped SKU" in tables.

### Date columns — parse, never hard-code
Pattern: `"YYYY-MM-DD <Measure>"` where the date is a month-end.
Parse with `/^(\d{4}-\d{2}-\d{2}) (.+)$/` → `{monthEnd, measure}`.

| Measure | Months present | Meaning |
|---|---|---|
| `Sales` | history + current + future placeholders | Cleaned actuals. **Actuals for all metrics.** Current month = month-to-date. Future = 0 placeholders, ignore |
| `Raw Actual` | history only | Unadjusted actuals. Shown for transparency only |
| `Locked ML Forecast Lag_1` | a rolling window of closed months (6 in reference run) | ML forecast frozen 1 month before each month — the back-test forecast |
| `Locked ML Forecast Lag_1 Abs Error` | same window | Stored \|Locked − Sales\| (use to self-check) |
| `Forecast` | horizon (24 months) | Final / consensus forecast. Label it **Consensus Forecast** |
| `Forecast Abs Error` | horizon | Stored \|Forecast − Sales\|; only meaningful for the current month. Ignore otherwise |
| `ML Forecast` | horizon | Statistical forecast (= P50) |
| `RL Forecast`, `RL Time Forecast`, `RL Unconstrained Forecast` | horizon | Reinforcement-learning variants (RL Forecast = a chosen quantile; RL Time ≈ final; Unconstrained = no constraints) |
| `Graph Reviewed Forecast`, `Table Edited Forecast` | horizon | Planner-edited layers |
| `Offset Forecast` | horizon | Offset-adjusted variant (logic not documented — label as such) |
| `Lower Bound`, `Upper Bound` | horizon | Prediction interval |
| `P10`…`P90`, `P99` | horizon | Quantile forecasts |
| `LY Sales` | horizon | Same month last year, as stored by TG |

### Month classes (derive from columns)
- `historyMonths` = sorted month-ends that have a `Raw Actual` column.
- `currentMonth` = earliest month-end that has a `Forecast` column. Its `Sales` is MTD.
- `futureMonths` = all `Forecast` months (includes `currentMonth`).
- `lockedMonths` = months with `Locked ML Forecast Lag_1`.
- `closedMonths` = historyMonths (all are complete).
- `latestClosedMonth` = last historyMonth.

### Value twin
Same columns in currency. `Sales` there is revenue. Accuracy / contribution recomputed
on value data is value-weighted and will differ from unit-weighted stored values —
label "value-weighted".

## 4. DOI Details

Grain `component_sku × Warehouse` (allocation, suffix = channel). Columns and meaning
are listed in `calculations.md §9`. Key facts:
- `ts_id` = `SKU_Warehouse_Region_Channel`.
- Quantities in units; `*_value` columns: `soh_value`, `Reorder_now_value`,
  `Excess_Stock_value`, `Dead_Stock_value`, `potential_stock_wastage_value` are
  **at cost** (qty × `cost_price`); `Potential_Sales_Loss_value` is **at selling
  price** (qty × `unit_price`). Verified on reference rows.
- `Stock_Risk_Level` ∈ {StockOut, CriticalStock, LowInventory, Stable, ExcessStock}.
- `stock_transfer_dict`, `reorder_transfer_dict` are Python-dict strings
  (`"{'WH_US_1_FBA': 1083.0}"`) → parse with `tg_calc.parsePyDict`.
- `OOS_Episode_Details` is a `" | "`-separated list of `"YYYY-MM-DD to YYYY-MM-DD (N days)"`.

## 5. Supply Plan / Supply Plan Value

Long format: one row per SKU × warehouse × `Variable`, monthly columns
`YYYY-MM-DD` (no measure suffix). Variables:
Beginning Inventory, Forecast, In Transit, Open Purchase Orders, Reorder Plan,
Reorder Received, Total Inbounds, End Inventory, Days On Inventory,
Days On Inventory With Pending, Safety Stock Days.
Pivot to `{key → {variable → {month → value}}}` with `tg_calc.pivotSupplyPlan`.
Do not sum `Days On Inventory`/`Safety Stock Days` across rows (they are ratios);
aggregate days as Σ End Inventory ÷ Σ (Forecast ÷ days in month).

## 6. Stock Transfer

`component_sku`, `Warehouse` (receiving), `From_Facility` (sending),
`sales_loss_stock_transfer`, `reorder_stock_transfer`, `total_stock_transfer`.
Quantities can be fractional (ratio-split) — display rounded, sum unrounded.

## 7. Warehouse → region / channel mapping

`baseWarehouse` = Warehouse with the suffix `_(SH_Sub|SH|CS|IO|FBA|TT)$` removed.

| Base warehouse | Region |
|---|---|
| WH_US_1, FBA-US, FBT-US | United States |
| WH_UK_1, FBA-UK, FBT-UK | United Kingdom |
| WH_ROW_1 | ROW |
| anything else | UNKNOWN (show raw) |

| Suffix | Platform (channel_name) |
|---|---|
| `_SH` | Web store |
| `_SH_Sub` | Web store subscription |
| `_CS` | CS activities |
| `_TT` | Social shop |
| `_IO` | Influencer Order |
| `_FBA` (or base FBA-*) | Marketplace US / Marketplace UK by region |

The names above are an illustrative example only: every company has its own warehouse names
and suffixes, so take the mapping from that company's data, never from this table. Keep it in one
constant (`tg_calc.WAREHOUSE_REGION`) so it is editable in one place.

## 8. Joins between demand and inventory

Demand is at sellable SKU (bundles included); inventory is at component SKU after the
bill of materials is exploded. A direct join works only where the codes coincide.
In the Inventory tab, the global SKU filter matches `component_sku` **or**
`variant_name` text; show "Inventory is tracked at component level — bundles appear
through their components" under the filter when a demand-only SKU is selected.

## 9. Known quirks

- The raw datasets store many numbers as text; the tools convert them on the server, so
  `tg_dp_*` answers carry real numbers (or null). The page does no coercion.
- `count` needs a `column`; without it the engine returns 0 rows.
- The tools page every answer on the server (any page is reachable, cursor or page
  number) and never truncate; the page asks for 10–100 rows at a time.
- `trust_zone = "Not Available"` covers most sparse combos (≈80% of rows in the
  reference run) — default tables sort by volume so these don't crowd the top.
- Transition SKUs: stored `LY Sales` can be launch-aligned rather than a plain
  12-month shift. Use stored `LY Sales` for forecast months; for history months
  compute LY as `Sales[t-12]`.
- `Locked ML Forecast Lag_1` window does not reach the latest 1–2 closed months.
  Those months take their forecast from earlier experiments (§3 of calculations) or
  show "no forecast on record".
- Current-period `Sales` is period-to-date (`tg_dp_series` marks it `partial`). Accuracy
  scores every period up to `activity_end_date`, which can include the current one — the
  TrueGradient app does the same (verified Nov 2026), so a week whose sales are not loaded
  yet scores 0 and pulls rolling accuracy down. Say so in the basis note when the last
  scored period has no sales.

## Accuracy settings (tg_experiment_details)
- `accuracy.global_lag_n` — which locked lag is scored (`Locked ML Forecast Lag_<n>`); the original
  `Locked ML Forecast` wins when it has positive values. Also in `raw_sections.dashboard_settings`.
- `accuracy.past_accuracy_horizon` — periods in "rolling"; `forecast.validation_horizon` — fallback window;
  `data_window.activity_end_date` — last date that may be scored.
- Locked columns may run past activity end (locked ahead) and `Sales` columns exist for future dates
  (partial or 0): never score them. a sample weekly run has no locked columns at all → validation fallback.
