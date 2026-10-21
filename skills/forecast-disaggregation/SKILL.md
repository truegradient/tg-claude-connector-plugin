---
name: forecast-disaggregation
description: Break a TrueGradient forecast down below the SKU. Split the top SKUs' forecast across their individual time series (ts_ids — each site, channel, region, city or platform the SKU is planned at) with each series' share, or down to component SKU and warehouse from the Disaggregated Forecast dataset where the workspace produces one. Use this for "disaggregate the forecast for our top SKUs", "split SKU X's forecast by site, channel or city", "which locations carry our top products next month", "break the forecast down to component and warehouse", "does the disaggregated forecast add back up". Reads the stored split, never an invented one, checks that the pieces add back to the parent, and flags series outside their own interval. When wanted as Excel or an export, it builds a multi-tab workbook (Read Me, Summary, detail and exception tabs) whose tabs are chosen from the question. Do NOT use for one forecast value — use forecast-lookup. Do NOT use for accuracy — use forecast-accuracy.
---

# Forecast Disaggregation

Show where a SKU's forecast actually sits — which series, and, where the workspace
produces it, which components and warehouses — and prove the pieces add back up.

Two different splits answer "disaggregate the forecast". Pick from the question:

| The user wants | Split | Source |
|---|---|---|
| top SKUs down to their ts_ids: the sites, channels, regions, cities or platforms each SKU is forecast at | **series split** (the default) | `Final DA Data`: one row is one series |
| down to **component SKU and warehouse** | **component split** | `Disaggregated Forecast`, only where the workspace produced it |

"Default ts_ids" means the series the experiment is already forecast at — the
rows of `Final DA Data`. A series split reads them; it does not create them.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Read the split TrueGradient stored. Never invent one.** Every series and
   component figure is a stored value. Pushing a number the user supplies down
   by historical shares is a different, derived calculation: do it only when
   asked, name the share window, and label every figure derived.
3. **Name one forecast family and one month per split** — `Forecast` (the
   operational plan) by default; `ML Forecast`, a lock family or
   `Consensus Forecast` only when asked, and consensus only if the column exists.
   Never mix families in one split.
4. **Shares are ratios of sums within the parent.** A series' share is its value
   over the SKU's total for the same family and month. Never average shares.
5. **Prove the pieces add back up, and say so for every SKU.** For a series
   split this is a count check, not hand arithmetic: the series read returned
   exactly as many rows as the SKU's `n` from step 5, every series has `n` = 1,
   and `returned < page_size`. All three true means the series sum to the SKU
   total by construction. Any one false means the read was truncated or the grain
   is incomplete. Never write "I did not check the others". For a component
   split, see rule 6.
6. **Component units are not parent units.** A bundle becomes several component
   units, so component totals do not add back to SKU totals by simple addition.
   Measured live: one workspace's `Disaggregated Forecast` summed to 198,528
   units for a month whose parent `Forecast` was 121,849. Reconcile only where a
   component code matches a parent SKU code, cell by cell, and report the
   difference as "demand from other parents or not disaggregated" — never
   explain it. The connector exposes no bill of materials: an inferred bundle
   ratio is an inference, labelled, and never a headline figure.
7. **A dataset that resolves with no columns was not produced.** If
   `Disaggregated Forecast` comes back `resolved: true` with an empty column list
   or a `schema_error` (observed live: a 404, "blob does not exist"), say this
   experiment has no component-level forecast and offer the series split. Never
   report it as zero demand.
8. **Name what you could not split.** Unmapped locations (blank names,
   `UNKNOWN`, a site with no channel) and labels that differ only in spelling or
   case (`Bangalore` / `bangalore` / `Bengaluru`) are flagged, kept in the total,
   and never merged silently. A merge you choose to show is labelled as yours.
9. **Flag a series whose forecast sits outside its own interval.** The bounds
   belong to `ML Forecast`, so an edited `Forecast` outside them is a planner
   adjustment the model did not expect — measured live: 88,019 against an upper
   bound of 31,714 in one city. Say so, without giving a reason.
10. Never `min`/`max` a number (they compare as text); rank with `sort_by` and
    `limit`. Never page a computed read; partition with filters and check
    `returned < page_size`.
11. End with the provenance footer.

Full detail: `../../references/METRICS.md` §11 and
`../../references/SAFETY-CONTRACT.md`.

## Procedure

**1–3. Identify, pick, discover.**
`tg_whoami` → `tg_list_experiments_for_analysis()` (unfiltered) →
`tg_resolve_datasets(experiment_id="<id>", tables=["Final DA Data"])`, adding
`"Disaggregated Forecast"` for a component split. One experiment per call,
scoped with `tables`. If it overflows, use `tg_dataset_info` for the column list.

**4. Find the grain, the SKU column and the month.**

- **The series grain** is the set of identity columns that make one row: a
  product code plus location / channel / region / city / platform columns.
  Observed live, three workspaces, three grains: `SKU Code` + `Site ID` +
  `channel`; `product_variant_code` + `channel_name` + `Region_name`;
  `GC_PLATFORM` + `PRODUCT_ID` + `GC_CITY`. Read it from the live list.
- **The SKU column** is the product code in that grain. Show a descriptor beside
  it (`product_name`, `TITLE`, `variant_name`) — product codes can be UUIDs.
- **A `ts_id` column** may exist in another dataset (observed in `DOI Details`,
  shaped `SKU_Site_cluster`), but not in `Final DA Data`. If one is available,
  quote it; otherwise label each series by its grain values and say there is no
  stored ts_id.
- **"Next month"** is the next calendar month after today when the forecast
  covers it; otherwise the first forecast month, said so. Forecasts often start
  months before today when the data is stale.

**5. Pick the top SKUs.**

```json
{"group_by": ["<SKU column>"],
 "aggregations": [{"function": "sum", "column": "<M> Forecast", "alias": "fc"},
                  {"function": "count", "alias": "n"}],
 "sort_by": [{"column": "fc", "direction": "desc"}],
 "limit": 10}
```

| User says | Top SKUs |
|---|---|
| "top SKUs", no number | the 10 largest by the month's forecast |
| "top N" | the N largest |
| "top 80%", "the SKUs that make most of the volume" | group all SKUs (no `limit`; check `returned < page_size`), rank, keep SKUs until the cumulative share reaches 80% |
| "A class" / "AB class" | `AB_Class` = A / in (A, B) — see `COLUMN-DISCOVERY.md` |

Also fetch the portfolio total, so you can say what share of the month the top
SKUs carry. `n` is the number of series per SKU — it can run to hundreds.

**6. Series split.**

For each top SKU (or several at once with an `in` filter, if the result stays
under `page_size`):

```json
{"filters": [{"column": "<SKU column>", "operator": "=", "value": "<sku>"}],
 "group_by": ["<every grain column>"],
 "aggregations": [{"function": "sum", "column": "<M> Forecast", "alias": "fc"},
                  {"function": "sum", "column": "<M> ML Forecast", "alias": "ml"},
                  {"function": "sum", "column": "<M> Lower Bound", "alias": "lb"},
                  {"function": "sum", "column": "<M> Upper Bound", "alias": "ub"},
                  {"function": "count", "alias": "n"}],
 "sort_by": [{"column": "fc", "direction": "desc"}],
 "page_size": 1000}
```

- Every `n` must be 1. An `n` above 1 means a grain column is missing: say so and
  find it before calling a group a series.
- **Add-back check, per SKU (rule 5):** `returned` = the SKU's `n` from step 5,
  every series `n` = 1, and `returned < page_size`. Report it as "all N series
  read; they sum to the SKU total". If `returned` is short, the read was
  truncated: partition by another grain column (or filter one SKU at a time) and
  repeat. Several SKUs in one call need `returned` = the sum of their `n`.
- **Share** = series value / SKU total.
- **Many series:** show the 10 largest per SKU and one "other N series" line
  with their total and share. The workbook carries all of them.
- **A second view by one grain column** (e.g. by platform or by channel) is a
  plain `group_by` on that column under the same filter.
- Flag: forecast outside `[Lower Bound, Upper Bound]` (rule 9), unmapped or
  placeholder locations, spelling variants, series at exactly 0.

**7. Component split.**

Only when `Disaggregated Forecast` resolved with columns. Observed live, one
workspace: a component column (`component_sku`), `Warehouse`, `Region_name`,
`channel_name`, product descriptors, and **bare** `YYYY-MM-DD` month columns
with no family suffix. Values are fractional — sum first, round for display.

```
a. Which parent family was disaggregated — check, do not assume.
   For one component whose code equals a parent SKU code, in a channel where
   it is that SKU's only parent, compare the component's value with the
   parent's Forecast and ML Forecast for the same month and channel.
   Say which it matched (measured once: Forecast, within 1 unit).
b. Per component: total, and its split by Warehouse (shares within the
   component). Then by channel / region where the columns exist.
c. Reconcile, cell by cell (component × channel × region):
      parent      = the parent SKU's family total, where codes match
      component   = Σ disaggregated value
      difference  = component − parent
   difference ≈ 0          → that cell adds back up
   difference > 0          → demand from other parents (e.g. bundles) or
                             a mapping the connector cannot see
   parent demand, no row   → "not disaggregated" (observed: a wholesale
                             channel with no component row)
   Report the differences; do not explain them.
d. Descriptor columns on a component row (product or variant name) name ONE
   parent, not every parent that feeds it. Never read a per-parent split
   off them.
```

## Output shape

```
Next month (November 2026), the top 10 SKUs carry 1,847 of 7,958 forecast
units (23%) across 148 series. The largest single series is SKU A at
Site 5 · Amazon: 57 units, 17% of that SKU.

What the data says
  Family:    Forecast (operational), 2026-11-30
  Series:    one row of Final DA Data = SKU × Site × channel
             (no stored ts_id; series labelled by those three values)
  Add-back:  every SKU's series sum to its total ✓

SKU A — 331 units, 15 series
  Site 5 · Amazon     57   17%
  Site 9 · Shopify    51   15%
  ...
  other 8 series     118   36%

What to consider
  11 of 148 series are outside their own interval (bounds are ML Forecast's):
  SKU A at Site 15 is 11 against 3–6. A planner adjustment, reason not recorded.
  Site 15 has no name or channel: 30 units, kept in the totals.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data (units)
  Forecast:    Forecast (operational), 2026-11-30
  Split:       series (SKU × Site × channel); top 10 SKUs by that month
  Caveats:     no stored ts_id; 1 unmapped site
```

For a component split, lead with whether it adds back up, then the warehouse
split per component, then the cells that do not reconcile, with the
bill-of-materials limitation stated once.

## Excel workbook output

Produce a workbook when the user asks for Excel, a spreadsheet, a file or an
export, and offer one (one line at the end) when the split runs past about 20
series. A few SKUs with a handful of series each stay in chat.

1. **Read Me**: the question; Source (experiment, dataset, family, month, the
   grain and whether a ts_id is stored); how top SKUs were chosen; the add-back
   result; for a component split, which family the components matched and the
   bill-of-materials limitation; provenance footer.
2. **Summary**: a block per SKU (series value and share), and a block by one
   grain column (platform, channel, region, warehouse).
3. **Main tab** `Series <month>` or `Components <month>`: one row per series
   (or component × warehouse), every row, not only the top 10.
4. **Exception tabs**: `Outside interval`, `Unmapped or duplicate labels`,
   `Does not add back` (component cells with a difference, and parent demand with
   no component row) — each included even when empty.

Blueprints Q (series) and R (component), column types and the spec format:
`../../workbook/WORKBOOK-SPEC.md` §2D. Build with
`python <this-skill-dir>/../../workbook/build_workbook.py <spec.json> <out.xlsx>`,
recalculate, check that each SKU's total matches your step-5 figure, and in chat
give the headline and the largest caveat.

## Boundaries

- one forecast value for one SKU or period, with its interval →
  **forecast-lookup**
- accuracy of the forecast at any level → **forecast-accuracy**
- two forecast families compared → **forecast-change**
- stock or reorder by warehouse → **supply-inventory**; a warehouse
  here is where forecast demand is assigned, not stock
- a bill of materials, or which bundle a component came from → cannot be
  answered; the connector does not expose it

## References

- `../../references/METRICS.md` — §11 shares and add-back
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/COLUMN-DISCOVERY.md` — grain, placeholders, duplicate labels,
  empty datasets, the AB-class rule
- `../../references/COLUMN-SEMANTICS.md` — which family answers which question,
  whose interval the bounds are
- `../../references/TOOL-GUIDE.md` — partitioning, truncation, reserved aliases,
  text-compared `min`/`max`
- `../../workbook/WORKBOOK-SPEC.md` — §2D blueprints
- `../../workbook/build_workbook.py` — builds the workbook from a JSON spec
