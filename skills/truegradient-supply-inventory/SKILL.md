---
name: truegradient-supply-inventory
description: Answer supply and inventory questions from TrueGradient inventory-optimization data — stock on hand, total inventory, days of cover, stockout timing, reorder plans, points and quantities, safety stock, in-transit, open POs and inbound supply, excess and dead stock, sales-loss exposure, working capital, and stock transfers. Use for "how does inventory look month on month", "when do we run out of X", "what should I reorder now", "which SKUs are at stockout risk", "where is my excess inventory", "is this SKU covered through the season", "how much working capital is tied up". Routes time-phased and future-period questions to the Supply Plan dataset and current-snapshot questions to DOI Details. Do NOT use for demand-forecast values, forecast accuracy, bias, forecast risk ranking, or comparing forecast versions — use the truegradient-forecast-* skills. Do NOT use for pricing, markdown, elasticity or promotion questions.
---

# Supply & Inventory Analysis

Answer "what is my inventory position, when does it break, and what should I
order" from TrueGradient's `inventory-optimization` data.

## The one decision that matters most

Two datasets answer these questions and they are **not interchangeable**. Route on
whether the question has a **time axis**:

| Question shape | Dataset |
|---|---|
| how inventory **evolves** — month on month, week on week, over the horizon | **`Supply Plan`** |
| **when** — stockout timing, when cover runs out, when supply lands | **`Supply Plan`** |
| any **future** period | **`Supply Plan`** |
| the **current** position — stock on hand, total inventory, reorder now | **`DOI Details`** |
| a **static** ranking — excess, dead stock, at-risk SKUs, loss exposure | **`DOI Details`** |
| **policy** — reorder point, safety stock, ideal inventory, lead time | **`DOI Details`** |

Tiebreaker: if the answer needs a period, it is `Supply Plan`. If it is a single
number as of today, it is `DOI Details`.

Two things that look like exceptions but are not:

- **"What's my reorder plan?"** is ambiguous. `DOI Details` gives the
  reorder-**now** decision; `Supply Plan` gives the **schedule** of future
  reorders. Answer one, name which, offer the other.
- **Never project timing yourself** from `DOI Details` rates. `Supply Plan`
  already simulates lead times and receipts; a hand-rolled projection will
  disagree with what the planner sees in the product.

Full detail: `../../references/SUPPLY-DATA-CONTRACT.md`

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. Use `tg_list_experiments_for_analysis(module="inventory-optimization")`, and
   never a column name that did not come from `tg_resolve_datasets`. If that
   returns `count: 0`, retry **unfiltered** before reporting no data — the module
   label is the experiment's own and does not always match where the data sits.
   Read `diagnostics.distinct_modules_seen` to see what the workspace actually
   has. (`TOOL-GUIDE.md` says not to filter by module for *forecast* questions,
   because forecast data lives in inventory-optimization experiments too. For
   supply questions the filter is the right starting point — it returned both
   experiments in the observed workspace — but it is a starting point, not a
   gate.)
3. **`Supply Plan` is long, not wide.** Every read must filter `Variable`.
   Its month columns are **bare dates** (`2026-09-30`), not `<date> <Family>`.
4. **Never total across `Variable` values.** Of the twelve documented measures,
   eight are units, three are days and `Forecast Per Day` is a rate — but both
   observed workspaces had only **eleven** (`Open Purchase Orders` absent), i.e.
   seven units. Read the live set with the `group_by: ["Variable"]` probe in step 5
   and classify from that, never from a count in this file.
   **Never sum a DAYS measure across entities** — summing `Days On Inventory` over
   2,379 SKUs returned 387,054, arithmetically fine and meaningless. Use `avg`, a
   median, or report per entity.
   **A RATE measure may be summed**, but only for a genuine portfolio-per-day
   figure — "demand is running at 212 units/day" is a legitimate and useful sum.
   Say which you did, and show the per-entity `avg` beside it when the distribution
   is skewed.
5. **Never assert the inventory balance identity as arithmetic**, and never infer
   unmet demand by subtracting forecast from supply. `End Inventory` is floored
   at zero per entity, so shortfalls are discarded. Read loss from
   `Potential_Sales_Loss` (or `Final_Potential_Sales_Loss` where present) /
   OOS fields instead.
6. **Never add `Reorder Plan` and `Reorder Received`** — same order, two moments,
   separated by that entity's lead time. `Total Inbounds` excludes both; it is
   committed supply only.
7. **Prefer the post-transfer variants** (`updated_*`, `Final_*`) for anything
   actionable, and name the column used — **but detect them first.** Measured
   live, neither experiment had a single `updated_*` or `Final_*` column and
   `Stock Transfer` was empty in both; asking for them fails with a binder error.
   When they are absent, use the base columns (`Potential_Sales_Loss`,
   `Excess_Stock`, `TG Reorder now`), name them, and say no post-transfer variant
   exists here. Never call a base figure post-transfer, and never say transfers
   absorbed nothing — an absent column means unmodelled, not zero.
8. **Never derive a risk band.** `Stock_Risk_Level` is stored workspace data —
   quote it with attribution, never compute one, and never assert a generic
   threshold as this workspace's setting.
9. Missing means unknown. **Never report a missing value as zero** — and note
   that in supply data a genuine `0` is meaningful (no stock, no inbound), so
   distinguishing the two matters more here than anywhere else.
   **How to tell them apart, and how this squares with
   `COLUMN-DISCOVERY.md` §4d:** §4d says a column summing to zero should be
   reported as "this workspace records none" rather than published as a zero.
   That rule is about a column that is a *placeholder*. In supply data the test is
   whether the measure was modelled at all:
   - the measure is **absent** from the live `Variable` set or column list
     → unmodelled. Say so; do not print a zero. (`Open Purchase Orders` was
     absent in both observed workspaces.)
   - the measure is **present** and reads 0 → that is a real modelled zero and you
     report it as one, because "no inbound supply this month" is a finding.
     (`In Transit` and `Total Inbounds` were present and 0 across every entity and
     month — genuinely no committed inbound.)
   - present, reads 0, and it is a **derived/aggregate** column you suspect is a
     placeholder → check whether it is 0 for *every* row in *every* period. If it
     is, say the workspace does not populate it, and name the field.
   State which of the three you concluded, and why.
10. The first period column is the **current, partial** period. Say so.
11. If the roster returns `used_archived_fallback: true`, lead with that caveat.
12. Separate what the data says, what you calculated, and what you recommend.
13. End with the provenance footer.

Also binding: `../../references/SAFETY-CONTRACT.md` (§1 workspace, §5 freshness,
§6 quality flags, §7 gaps, §10 causal claims, §11 tiers, §12 footer, §13
permissions).

## Procedure

**1–3. Identify, pick, discover.**
`tg_whoami` → `tg_list_experiments_for_analysis(module="inventory-optimization")`
→ `tg_resolve_datasets(experiment_id="<id>", tables=["DOI Details", "Supply Plan"])`.

**Scope the resolve call with `tables`.** Unscoped, it returns `Final DA Data` and
`Final DA Data Value` in full at 419 columns each — 72,557 characters for a single
experiment, which overflows the response limit and leaves you with no column
vocabulary at all. You do not need the forecast datasets for a supply question.
See `../../references/TOOL-GUIDE.md`.

**4. Route to a dataset** using the table above. If the question needs both, say
so and read both.

**5. If using `Supply Plan`, probe the shape first.** Two cheap facts you need
before any real read:

```json
{ "experiment_id": "<id>", "dataset_name": "Supply Plan",
  "group_by": ["Variable"],
  "aggregations": [{"function": "count", "alias": "n"}],
  "page_size": 100 }
```

This gives the live `Variable` vocabulary and the entity count. Read the period
cadence off the column list — monthly month-end buckets are common, but weekly is
possible. **State the cadence you found**; never assume monthly.

**6. Read.** Always filtered and projected — never a plain read.

Time-phased, one entity:

```json
{ "experiment_id": "<id>", "dataset_name": "Supply Plan",
  "filters": [
    {"column": "SKU Code", "operator": "=", "value": "<sku>"},
    {"column": "Site ID", "operator": "=", "value": "<site>"},
    {"column": "Variable", "operator": "in",
     "values": ["Beginning Inventory", "Forecast", "Total Inbounds",
                "Reorder Received", "End Inventory", "Days On Inventory"]}],
  "select_columns": ["Variable", "2026-09-30", "2026-10-31", "2026-11-30"],
  "page_size": 50 }
```

Time-phased, portfolio or segment — one `Variable` at a time:

```json
{ "experiment_id": "<id>", "dataset_name": "Supply Plan",
  "filters": [{"column": "Variable", "operator": "=", "value": "End Inventory"}],
  "group_by": ["<a grain column from the live list>"],
  "aggregations": [
    {"function": "sum", "column": "2026-09-30", "alias": "m09"},
    {"function": "sum", "column": "2026-10-31", "alias": "m10"}],
  "page_size": 1000 }
```

Current-state triage:

```json
{ "experiment_id": "<id>", "dataset_name": "DOI Details",
  "group_by": ["Stock_Risk_Level"],
  "aggregations": [
    {"function": "count", "alias": "skus"},
    {"function": "sum", "column": "soh_value", "alias": "soh_val"},
    {"function": "sum", "column": "Potential_Sales_Loss", "alias": "loss_units"},
    {"function": "sum", "column": "Potential_Sales_Loss_value", "alias": "loss_val"},
    {"function": "sum", "column": "Excess_Stock", "alias": "excess_units"},
    {"function": "sum", "column": "Excess_Stock_value", "alias": "excess_val"}],
  "page_size": 50 }
```

Swap `Potential_Sales_Loss` → `Final_Potential_Sales_Loss` and `Excess_Stock` →
`updated_Excess_Stock` **only if those columns are in the live list** (rule 7).
The base names above are what both observed workspaces actually had.

**7. Rank by money, not by count.** For triage, sort by
`Potential_Sales_Loss_value` (at-risk) or `Excess_Stock_value` (excess), not by
unit gap or SKU count. Truncate to the top contributors and say what share of the
total they carry.

**8. Sanity-check before answering.** Confirm every column name is verbatim from
the live list; confirm `Variable` is filtered on any Supply Plan read; confirm you
have not mixed units with days or units with value.

## Metrics

Prefer the dataset's own precomputed fields over anything you derive — they
reflect the workspace's configuration. Cite them as stored.

| Concept | Read from | Do not |
|---|---|---|
| days of cover, now | `Days on Inventory` — **the primary coverage signal when both it and `DOI_Current_Stock` exist** | divide SOH by a rate yourself |
| usable stock now | `Stock_On_Hand` | add `In Transit` or `Open PO` into it — those are **pending, not available** |
| demand rate | `Sales Per Day` (realized) vs `Forecast_Per_Day` (expected) | use one where the question means the other |
| days of cover, over time | `Days On Inventory` / `...With Pending` (Supply Plan) | recompute |
| stockout timing | `Current_OOS_Date`, `OOS_Episode_Details`, `Total_Projected_OOS_Days` | project from daily rates |
| what to order now | `TG Reorder now` — or `updated_TG_Reorder_now` **if present** | report a pre-transfer figure as post-transfer |
| loss exposure | `Potential_Sales_Loss`, `Potential_Sales_Loss_value` — or `Final_Potential_Sales_Loss` **if present** | subtract forecast from supply |
| excess | `Excess_Stock`, `Excess_Stock_value` — or `updated_Excess_Stock` **if present** | apply a days-of-supply multiple |
| working capital | `soh_value` | derive it from units × price yourself |
| unit economics | `Selling Price`, `Cost`, `COGS`, `Margin%` | use `selling_price` or `AVG COGS` — **those names do not exist** |
| **risk band** | **`Stock_Risk_Level` — the dataset's own, quoted with attribution** | **derive or infer one** |

The base names above are the ones verified present. The `updated_*` / `Final_*`
variants were **absent from both observed experiments** (rule 7), so they are
conditional, not the default.

Two derived figures are legitimate, if labelled as calculated:

```
excess share of capital = Σ Excess_Stock_value / Σ soh_value
cover gap (days)        = Days on Inventory − TG Safety Stock Days
```

Both are ranking devices, not TrueGradient metrics. Say so.

## Output shape

Lead with the decision, then the numbers, then the footer.

The shape below is illustrative — every figure is invented.

```
Coverage breaks in November. Ten SKUs carry most of the exposure and the
plan wants 4,500 units placed now to recover by February.

What the data says — time-phased (Supply Plan, monthly)
  Period        Beginning   Forecast   Inbounds   Reorder Recd   End
  2026-09-30       30,000      4,000      6,000             0    32,000
  2026-10-31       32,000      5,000      4,000           600    31,600
  2026-11-30       31,600     13,000      7,000             0    25,600

  2026-08-31 is the current, partial month and is shown for context only.

What the data says — current position (DOI Details, as of the run date)
  Stored Stock_Risk_Level          SKUs   Stock value   Loss exposure
  StockOut                           40            $0      $1,200,000
  LowInventory                       25      $300,000        $800,000
  CriticalStock                       6       $ 20,000        $250,000
  ExcessStock                        30      $900,000               —
  Stable                             20      $400,000               —

What was calculated
  Recommended buy = Σ TG Reorder now = 4,500 units (pre-transfer; no
  post-transfer variant exists in this experiment).
  Pre-transfer was 4,700; transfers absorb the 200-unit difference.
  Loss exposure = Σ Potential_Sales_Loss_value.
  Excess share of capital = Σ Excess_Stock_value / Σ soh_value = 35%.
  Risk bands are the dataset's own stored Stock_Risk_Level, not derived here.

What to consider
  The November drop is driven by forecast (13,000) exceeding inbounds
  (7,000), not by a missed order. The 600-unit October receipt is a
  recommended reorder landing, not committed supply. Excess and stockout
  coexist, so a transfer review may release cover without a buy.

Source
  Company:     <company_name>
  Experiment:  <label> (<id>) — Completed, created <createdAt>
  Module:      inventory-optimization
  Dataset(s):  Supply Plan (units, monthly); DOI Details (snapshot)
  Variables:   Beginning Inventory, Forecast, Total Inbounds,
               Reorder Received, End Inventory
  Fields:      TG Reorder now, Potential_Sales_Loss,
               Excess_Stock_value, soh_value, Stock_Risk_Level (stored)
  Period(s):   2026-09-30 .. 2026-11-30 (current partial month excluded)
  Caveats:     balance not reconciled — End Inventory floored at 0 per SKU
```

Note what this does **not** do: no derived risk label, no reconciled balance, no
unmet demand inferred by subtraction, and every pre/post-transfer choice named.

## Answering the hard ones

**"Why doesn't the inventory add up?"** Because `End Inventory` is clamped at zero
per entity and the simulation runs daily inside each bucket. Explain both. Do not
fabricate a reconciliation.

**"When do we run out?"** Quote `Current_OOS_Date` and `OOS_Episode_Details`
verbatim, plus `Total_Projected_OOS_Days`. If the user wants the shape of the
decline, add the `End Inventory` series. Never compute a date yourself.

**"Should I reorder?"** Give `TG Reorder now` (or `updated_TG_Reorder_now` where it
exists), its `TG Reorder Date`, the
entity's `lead_time`, and when `Reorder Received` shows the stock landing. The
gap between order and arrival is the whole decision.

**"Why is inventory falling?"** Permitted: forecast exceeds inbounds by N;
no receipt is scheduled until period P; the reorder was planned in M and lands in
M+lead_time. **Forbidden** (per `SAFETY-CONTRACT.md` §10): asserting a supplier
delay, a demand shift, a capacity constraint, or a planner override — none of
those is a field in this data.

**"Am I over-invested?"** Report `soh_value`, `Excess_Stock_value`,
`Dead_Stock_value` and the stored `ExcessStock` count. Do not label a level
"too high" against a threshold you invented.

## When a dataset resolves but is empty

`tg_resolve_datasets` can return `resolved: true` with an empty `columns` list and
no sample row. That dataset holds no data. Measured live: `Stock Transfer`
resolved this way in **both** experiments, and probing it returned
`502 download_failed — "CSV file contains only whitespace"`.

- Do not probe or read it. Say the dataset exists in this experiment but is empty.
- **Never turn that into a business statement.** "No stock transfers are planned"
  is a claim about the plan; an empty file is a claim about the file. Reporting
  zero transfers, or a zero transfer value, from a dataset that was never
  produced is a fabricated finding of exactly the kind this plugin exists to
  prevent.
- If a transfer question depends on it, say the transfer dataset carries no rows
  in this experiment and that the question cannot be answered from it.
- If an error body reaches you, report the failure in words. Do not repeat the
  storage path, bucket or company id it contains — failures leak all three.

## Working with the other skills

These often compose. Read the supply side here and hand off the rest:

- **"Inventory is wrong because the forecast is wrong."** Get the position and the
  exposure here, then hand the accuracy or bias question to
  **truegradient-forecast-accuracy**. The `Forecast` variable in `Supply Plan` is
  the demand signal *consumed by* the plan — do not measure accuracy from it.
- **"Which SKUs should planners look at?"** Forecast-risk ranking is
  **truegradient-forecast-risk**; stockout and excess triage is here. Both is
  fine — keep the two rankings clearly labelled, they answer different questions.
- **"What's the forecast for November?"** → **truegradient-forecast-lookup**, from
  `Final DA Data`. Do not read a forecast value off `Supply Plan`.
- Note that `Final DA Data*` also appear in this module. Route on the
  **question**, not the module.

Out of scope entirely — say so:

- pricing, markdown, elasticity, promotion ROI (`pricing-promotion-optimization`)
- supplier or PO master data, capacity or production scheduling beyond what the
  live `Variable` measures contain
- writing back a reorder, PO or transfer — every connector tool is read-only

## References

- `../../references/COLUMN-SEMANTICS.md` — column meanings, the `Variable`
  vocabulary and its unit classes, coverage-signal precedence
- `../../references/SUPPLY-DATA-CONTRACT.md` — the two datasets, the long shape,
  the twelve variables, the balance and transfer traps
- `../../references/SAFETY-CONTRACT.md` — workspace, freshness, gaps, causal
  claims, footer
- `../../references/COLUMN-DISCOVERY.md` — runtime discovery; note the bare-date
  column pattern differs from the forecast regex
- `../../references/TOOL-GUIDE.md` — batching, truncation, broken aggregations,
  errors
