# TrueGradient Supply & Inventory Data Contract

What the supply and inventory datasets contain, how they differ **structurally**
from the forecast datasets, and which traps produce silently wrong answers.

> **Read this first:** the forecast datasets are *wide* (time in column names,
> one row per entity). `Supply Plan` is **long** (time in column names, but many
> rows per entity, one per measure). Applying forecast-shaped reasoning to
> `Supply Plan` is the single most likely way to get a confidently wrong number.
> Always discover columns at runtime — see `COLUMN-DISCOVERY.md`.

---

## 1. Module and datasets

Supply and inventory questions live in the **`inventory-optimization`** module.

An `inventory-optimization` experiment exposes six datasets:

| Dataset | Contents | Grain of one row |
|---|---|---|
| `Supply Plan` | **time-phased** supply/inventory evolution, units | entity × measure |
| `Supply Plan Value` | same, monetary value | entity × measure |
| `DOI Details` | **current-state** inventory health + reorder recommendation | entity |
| `Stock Transfer` | recommended inter-location transfers | entity × source node |
| `Final DA Data` | monthly forecast/actuals, units | entity |
| `Final DA Data Value` | monthly forecast/actuals, value | entity |

Note that `Final DA Data*` appear here too. Forecast questions are still the
forecast skills' job even when the experiment sits in this module — route on the
**question**, not on the module.

---

## 2. The routing rule

This is the decision that matters most, and it is decided by **whether the
question has a time axis**, not by its vocabulary.

| The question is about | Dataset | Why |
|---|---|---|
| how inventory **evolves** — month on month, week on week, over the horizon | `Supply Plan` | it is the only dataset with a time axis |
| **when** something happens — stockout timing, when cover runs out, when a receipt lands | `Supply Plan` | timing needs periods |
| a **future** period — "inventory in November", "cover in Q1" | `Supply Plan` | DOI Details has no future |
| the **current** position — stock on hand now, total inventory, reorder now | `DOI Details` | it is the as-of snapshot |
| a **static** ranking — excess stock, dead stock, at-risk SKUs, sales-loss exposure | `DOI Details` | precomputed, one row per entity |
| **policy** parameters — reorder point, safety stock, ideal inventory, lead time | `DOI Details` | policy lives on the snapshot |

**Tiebreakers.**

- A question that names or implies a period, a trend, or a "when" → `Supply Plan`.
- A question answerable by a single number as of today → `DOI Details`.
- "What is my reorder plan?" is ambiguous. `DOI Details` gives the **reorder-now**
  decision; `Supply Plan` gives the **schedule of future reorders**. Say which
  you answered, and offer the other.
- Genuinely two-part questions ("am I covered, and if not when do I run out")
  read both. State both sources.

**Never** answer a timing question from `DOI Details` by reasoning forward from
`Sales Per Day` — the Supply Plan already simulates that with lead times and
receipts, and a hand-rolled projection will disagree with the product.

---

## 3. `Supply Plan` — long format, and the column-name difference

One row is **one entity × one measure**. The measure is named in the `Variable`
column. Every month in the horizon is a **bare-date column**.

```
Row identity:   <entity keys> + Variable      (read the keys from the live list)
Time columns:   2026-08-31, 2026-09-30, ... 2028-01-31
```

Critical difference from `Final DA Data`:

| | Column-name pattern | Regex |
|---|---|---|
| `Final DA Data` | `<date> <Family>` | `^(\d{4}-\d{2}-\d{2})\s+(.+)$` |
| `Supply Plan` | `<date>` — **bare, no family** | `^\d{4}-\d{2}-\d{2}$` |

The forecast discovery regex **will not match** Supply Plan columns. Use the bare
form, and get the measure from the `Variable` column instead of the column name.

Consequences:

- To read one measure you **must** filter `Variable`. Selecting a month column
  without a `Variable` filter mixes units, days and quantities in one column.
- Summing a month column without filtering `Variable` is meaningless — it adds
  inventory units to days-of-cover.
- "Show me next six months" = six columns × a `Variable` filter, in one call.
- The **first** month column is the current, partial month. Treat it as
  in-progress, not as a closed period.
- Period buckets are whatever the experiment was configured for. Monthly
  (month-end) was observed; weekly buckets are possible. **Read the column list
  and say which cadence you found** — never assume monthly.

---

## 4. The `Variable` values

Twelve measures have been observed across workspaces; a second workspace showed
**eleven** — `Open Purchase Orders` was absent there, with `In Transit` and
`Total Inbounds` both reading 0. The table below is the union, not a guarantee.
**Confirm the live set with a `group_by: ["Variable"]` probe before relying on any
of them**, and treat an absent measure as unmodelled rather than zero.

| `Variable` | Meaning | Unit |
|---|---|---|
| `Beginning Inventory` | on-hand at period start | units |
| `End Inventory` | on-hand at period end, **floored at 0** | units |
| `Forecast` | demand consumed in the period | units |
| `Forecast Per Day` | daily demand rate used by the simulation | units/day |
| `In Transit` | stock already shipped, not yet received | units |
| `Open Purchase Orders` | placed POs expected in the period | units |
| `Total Inbounds` | `In Transit` + `Open Purchase Orders` | units |
| `Reorder Plan` | recommended order **placed** in the period | units |
| `Reorder Received` | recommended order **landing** in the period | units |
| `Days On Inventory` | cover from on-hand alone | days |
| `Days On Inventory With Pending` | cover including inbounds/planned receipts | days |
| `Safety Stock Days` | configured safety-stock target | days |

**Three unit classes, not two.** Of the twelve: **eight are units**, **three are
days**, and **one is a rate** — `Forecast Per Day` is units/day and belongs to
neither of the other groups. Never total across `Variable` values, and never chart
them on one axis without saying so.

**Never sum a days or rate measure across entities.** The rule above is about
mixing measures; this one is about summing *within* one. Measured live:
`sum("2026-09-30")` filtered to `Days On Inventory` returned **387,054** across
2,379 entities — the arithmetic succeeds and the number means nothing, because
days of cover do not add up across SKUs. Same for `Forecast Per Day`.

```
units measures (Beginning/End Inventory, Forecast, In Transit,
  Open Purchase Orders, Total Inbounds, Reorder Plan, Reorder Received)
      -> sum across entities is valid

days measures (Days On Inventory, Days On Inventory With Pending,
  Safety Stock Days)
      -> use avg, or a distribution, or report per entity. NEVER sum.

rate measures (Forecast Per Day)
      -> sum only if you genuinely want portfolio demand per day; otherwise avg.
         Say which you did.
```

---

## 5. The balance identity — approximate, and never asserted in aggregate

Per entity-period the plan broadly behaves as:

```
End Inventory ≈ max(0, Beginning Inventory + Total Inbounds
                       + Reorder Received − Forecast)
```

**It does not tie exactly, and it does not tie at all once summed.** Two reasons,
both observed:

1. **The floor at zero destroys additivity.** `End Inventory` is clamped at 0 per
   entity, so unmet demand is silently discarded. Summing clamped values across a
   portfolio loses every negative — in one observed workspace roughly four fifths
   of entities were in stockout, so the aggregate residual was large.
2. **The simulation is finer than the buckets.** Receipts and consumption land on
   days inside the period, so month-start and month-end snapshots do not
   reconcile with monthly totals.

Rules that follow:

- Use the identity to **explain direction** ("inventory falls because forecast
  exceeds inbounds"), never to compute or reconcile a number.
- **Never infer unmet demand by subtraction.** Read it from
  `Potential_Sales_Loss` / `Final_Potential_Sales_Loss` or the OOS-episode fields
  in `DOI Details`. A negative computed balance is not a shortfall figure.
- If a user asks why the columns "don't add up", explain the zero-floor and the
  daily simulation. Do not fabricate a reconciliation.

---

## 6. `Reorder Plan` vs `Reorder Received` — the lead-time offset

These are the same order counted twice, at two different moments. Confusing them
either double-counts supply or misdates it by a whole lead time.

- `Reorder Plan` in period *M* = what the plan says to **place** in *M*.
- `Reorder Received` = when that quantity **arrives**, offset by the lead time.

In one observed entity, `lead_time` was 120 days and quantities placed in Aug and
Sep appeared together as a single Dec receipt; an Oct placement appeared in Jan.
The offset is a consequence of `lead_time` / `lead_time_reorder` in `DOI Details`,
so it varies per entity.

Rules:

- "What should I order?" → `Reorder Plan` (or `DOI Details` for reorder-now).
- "When does stock arrive?" / "when does cover recover?" → `Reorder Received`.
- Never add both into one supply total.
- When explaining a gap between a placement and a recovery, cite the entity's own
  `lead_time` from `DOI Details` rather than assuming a horizon-wide lag.

`Total Inbounds` covers only committed supply (`In Transit` + `Open Purchase
Orders`) and **excludes** `Reorder Received`, which is recommended, not committed.
State that distinction whenever both appear — one is real, one is a proposal.

---

## 7. `DOI Details` — the current-state snapshot

One row per entity, as of the experiment's run date. Column groups observed:

**Identity and attributes** — *names vary per workspace; this list is one
workspace's, not a schema.* Read them from the live column list every time.
`sku_standard`, `Channel`, `cluster`, `ts_id`, `Collection`, `Color`, `Type`,
`Status`, `Seasonality`, `Weight_lbs`, `Lifestage`, `ABC_Class_FCS_Vol`,
`ABC_Class_FCS_Val`, `XYZ`, `Fulfillment Node`

> Two later workspaces shared **none** of the identity names above. Their
> `DOI Details` carried `SKU Code`, `Site ID`, `cluster`, `ts_id`, `Brand name`,
> `Category`, `Sub-category`, `Product Name`, `Site Name`, `channel`, `Lifestage`
> (CPG) and `Store Num`, `Brand`, `Product Type`, `Subtype`, `Style Group Name`
> (Retail). `sku_standard`, `Channel`, `Type`, `Collection`, `Color`, `Status`,
> `Seasonality`, `Weight_lbs`, `ABC_Class_FCS_*` and `XYZ` were absent from both.
> Anything below is a *candidate* to detect, never a name to send blind.

**Demand rates and history**
`Sales Per Day`, `Sales_Per_Day_2_M`, `Forecast_Per_Day`, `sales_last7days`,
`sales_last30days`, `sales_last60days`, `sales_last90days`, `total_demand`,
`current_week_sales_tilldate`, `Current Month Sales till Date`,
`current_year_sales_tilldate`, `current_fiscal_year_sales_tilldate`,
`sales_deviation_by_day`, `Return_Per_Day`, `%Return`, `age_days`, `Age Months`

**Position and supply inputs**
`Stock_On_Hand`, `In Transit`, `Open PO`, `DOI_Current_Stock`,
`Days on Inventory`, `Current_OOS_Date`

**Policy**
`TG Ideal Inventory`, `TG Reorder Point`, `TG Safety Stock`,
`current_safety_stock`, `TG Ideal Inventory Days`, `TG Safety Stock Days`,
`Minimum Order Quantity`, `TG Reorder Interval`, `round_off_reorder`,
`lead_time`, `lead_time_reorder`, `stock_transfer_lead_time`

**Recommendation**
`TG Reorder now`, `updated_TG_Reorder_now`, `TG Reorder Quantity`,
`TG Reorder Date`

**Exposure**
`Stock_Risk_Level`, `Excess_Stock`, `updated_Excess_Stock`, `Dead_Stock`,
`Stock_Type`, `potential_stock_wastage`, `Potential_Sales_Loss`,
`updated_Potential_Sales_Loss`, `Final_Potential_Sales_Loss`, `raw_loss`,
`gap_loss`, `non_gap_loss_before_transfer`, `non_gap_loss_after_transfer`,
`transfer_used_for_loss`, `stock_transfer_po`, `stock_transfer_dict`,
`reorder_transfer_dict`, `OOS_Episode_Count`, `Total_Projected_OOS_Days`,
`OOS_Episode_Details`

**Money**
`Selling Price`, `Cost`, `COGS`, `Margin%`, `soh_value`,
`Reorder_now_value`, `Excess_Stock_value`, `Dead_Stock_value`,
`Potential_Sales_Loss_value`, `potential_stock_wastage_value`

Note `DOI Details` carries **both** units and value inline — unlike Supply Plan,
which splits them into two datasets. Prefer the `*_value` columns for money
questions rather than multiplying units by price yourself.

`OOS_Episode_Details` is a human-readable string of dated stockout windows
(`2026-11-20 to 2026-12-28 (38 days) | ...`). Quote it; do not parse it into
arithmetic. Use `OOS_Episode_Count` and `Total_Projected_OOS_Days` for numbers.

---

## 8. The post-transfer variant rule

Several exposure and recommendation fields exist in **two or three** versions.
They differ because the `Stock Transfer` model can cover part of a shortfall by
moving existing stock instead of buying more.

| Before transfers | After transfers | Report which? |
|---|---|---|
| `Potential_Sales_Loss`, `raw_loss` | `updated_Potential_Sales_Loss`, `Final_Potential_Sales_Loss` | **after** |
| `TG Reorder now` | `updated_TG_Reorder_now` | **after** |
| `Excess_Stock` | `updated_Excess_Stock` | **after** |

**Default to the post-transfer variant WHEN IT EXISTS** — it is the number after
the plan has done what it can for free — and **name the column you used**. Use the
pre-transfer variant only to quantify what transfers are worth, and label it as
such.

**Detect first: in many workspaces these variants are absent.** Measured live
across two experiments, `DOI Details` (69 and 66 columns) carried **no**
`updated_*` or `Final_*` column at all, and `Stock Transfer` was empty in both —
a coherent picture, since with no transfer model run there is nothing to produce a
post-transfer number. Asking for `Final_Potential_Sales_Loss` or
`updated_Excess_Stock` there fails with a DuckDB binder error.

```
if the updated_/Final_ variant is in the live column list  -> use it, name it
else                                                       -> use the base column
                                                              (Potential_Sales_Loss,
                                                               Excess_Stock,
                                                               TG Reorder now),
                                                              name it, and say no
                                                              post-transfer
                                                              variant exists in
                                                              this experiment
```

Do not describe a base-column figure as post-transfer, and do not claim transfers
absorbed nothing — absent columns mean the question was not modelled, which is
different from a modelled zero.

The difference is material, not cosmetic. In one observed workspace, transfers
absorbed about 2% of unit sales loss, cut recommended reorder by about 3%, and cut
excess stock by about 7%. Reporting the pre-transfer variant therefore overstates
a buy or an exposure — by a margin large enough to change a decision, and in a
direction that always looks like "order more".

`transfer_used_for_loss`, `stock_transfer_po`, and the `*_dict` fields record
what the transfer model assumed. The `*_dict` values are JSON-ish strings —
quote them, don't compute on them.

---

## 9. `Stock_Risk_Level` — stored, never derived

`Stock_Risk_Level` is a **stored field** computed by TrueGradient against the
workspace's own configured thresholds. Observed values:

| Value | Meaning |
|---|---|
| `StockOut` | no stock on hand |
| `CriticalStock` | below critical threshold |
| `LowInventory` | below reorder point / safety cover |
| `Stable` | within target band |
| `ExcessStock` | above the excess threshold |

Because it is stored tenant data it **may be quoted with attribution** — "the
dataset's own `Stock_Risk_Level` records this SKU as `LowInventory`". This is the
same exception that `SAFETY-CONTRACT.md` §15 grants to `trust_zone`.

**Never derive a risk band yourself** — not from days of cover, not from a
days-of-supply rule of thumb, not from a default excess multiple. The thresholds
behind these labels are workspace configuration that no connector tool exposes.
Report `Days on Inventory`, `TG Safety Stock Days` and the stored label, and let
the planner judge. Likewise, never assert a generic bar ("under 30 days is
critical") as though it were this workspace's setting.

---

## 10. Units and value

| Question | Dataset |
|---|---|
| units, quantity, cover, stockout timing | `Supply Plan` |
| inventory value, working capital, value at risk over time | `Supply Plan Value` |
| current position or exposure, either units **or** money | `DOI Details` (both inline) |

`Supply Plan` and `Supply Plan Value` share the same `Variable` vocabulary and
shape. Never mix a unit figure and a value figure in one calculation, and never
convert between them with your own price assumption when a `*_value` column
exists.

---

## 11. Joining the datasets

**Derive the join key from the live column lists — do not assume one.** An earlier
version of this document specified `sku_standard + Channel`. That key is
**unfollowable in both observed workspaces**: neither `sku_standard` nor `Channel`
exists, and `Supply Plan` has **no channel column at all**, so a sku × channel join
cannot be performed there.

What was actually measured:

| | `DOI Details` | `Supply Plan` |
|---|---|---|
| CPG experiment | `SKU Code`, `Site ID`, `cluster`, `ts_id`, `channel` | `SKU Code`, `Site ID` — **no channel** |
| Retail experiment | `Store Num`, `Subtype`, `Brand`, … | `Store Num`, `Subtype`, `Brand`, … |

So the usable shared grain in the CPG experiment is **`SKU Code` + `Site ID`**, and
`channel` / `cluster` / `ts_id` exist only on `DOI Details`.

```
1. List the non-date columns of both datasets from the live column list.
2. The join key is their INTERSECTION of entity-identifying columns.
3. Name the key you used in the answer.
4. If the intersection is empty, say the two datasets cannot be joined in this
   experiment and answer from one of them.
```

Cautions:

- Columns present on only one side (in the CPG experiment: `channel`, `cluster`,
  `ts_id` on `DOI Details`) must **not** enter a joined view — joining on a key
  finer than the coarser dataset's grain fans rows out and double-counts.
- Row counts should match at that grain — both datasets carried 2,379 entities in
  the observed CPG workspace, and `Supply Plan`'s Σ `Beginning Inventory` for the
  first period equalled `DOI Details`' Σ `Stock_On_Hand` (22,208) exactly, which is
  a useful cross-dataset check. If they diverge, say so rather than silently
  inner-joining away entities.
- The connector cannot join server-side. Fetch each dataset with the same
  filters and align them yourself, or ask two focused questions.

## 12. `Stock Transfer`

Documented columns (from TrueGradient's own dataset knowledge base):
`Component SKU` (most granular item code), `Warehouse` (this row's warehouse —
receiving or reference node), `From_Facility` (the warehouse stock moves **from**),
`sales_loss_stock_transfer` (transfer quantity that prevents potential sales loss),
`reorder_stock_transfer` (transfer quantity that reduces a reorder),
`total_stock_transfer` (the sum of those two). Older exports may instead carry
`sku_standard` / `Channel` as the identity pair — read the live list.

`Channel` here is the **receiving** node and `From_Facility` the sending node.
Use it for redeployment questions and to explain the pre/post-transfer gap in §8.
`total_stock_transfer` = `sales_loss_stock_transfer` + `reorder_stock_transfer`.

---

## 13. Provenance of this document

- The module's six-dataset map, each dataset's routing summary, the live column
  lists, and the `Supply Plan` long shape: read from the TrueGradient connector
  via `tg_resolve_datasets`.
- The `Variable` vocabulary (twelve in one workspace, eleven in another — see §4),
  the five `Stock_Risk_Level` values, the zero-floor
  additivity failure, the pre/post-transfer relationship, and the 120-day
  reorder-to-receipt offset: **measured in one workspace's
  `inventory-optimization` experiment.** One workspace, one experiment. Treated
  as an example throughout, never as the contract — rediscover at runtime.
- No customer row values, identifiers, SKU codes or workspace names are reproduced
  here. The few magnitudes quoted (§5, §8) are proportions, not values, included
  only to show that a routing or variant mistake is material rather than cosmetic.
