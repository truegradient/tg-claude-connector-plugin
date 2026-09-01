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
Row identity:   sku_standard + Channel + Variable
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

Twelve measures were observed. Confirm the live set with a `group_by:
["Variable"]` probe before relying on any of them.

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

**Mixed units.** Nine measures are units, three are days. Never total across
`Variable` values, and never chart them on one axis without saying so.

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

**Identity and attributes**
`sku_standard`, `Channel`, `cluster`, `ts_id`, `Collection`, `Color`, `Type`,
`Status`, `Seasonality`, `Weight_lbs`, `Lifestage`, `ABC_Class_FCS_Vol`,
`ABC_Class_FCS_Val`, `XYZ`, `Fulfillment Node`

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
`selling_price`, `AVG COGS`, `COGS`, `Margin%`, `soh_value`,
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

**Default to the post-transfer variant** for anything actionable — it is the
number after the plan has done what it can for free — and **name the column you
used**. Use the pre-transfer variant only to quantify what transfers are worth,
and label it as such.

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

The join key across `Supply Plan`, `Supply Plan Value`, `DOI Details` and
`Stock Transfer` is:

```
sku_standard + Channel
```

Cautions:

- `DOI Details` also carries `cluster` and `ts_id`
  (`<sku>_<Channel>_<cluster>`); `Supply Plan` does not. Join at
  **sku × channel** and do not introduce `cluster` into a joined view.
- Row counts should match at that grain — both datasets carried the same entity
  count in one observed workspace. If they diverge, say so rather than silently
  inner-joining away entities.
- The connector cannot join server-side. Fetch each dataset with the same
  filters and align them yourself, or ask two focused questions.

## 12. `Stock Transfer`

Narrow dataset: `sku_standard`, `Channel`, `From_Facility`,
`sales_loss_stock_transfer`, `reorder_stock_transfer`, `total_stock_transfer`.

`Channel` here is the **receiving** node and `From_Facility` the sending node.
Use it for redeployment questions and to explain the pre/post-transfer gap in §8.
`total_stock_transfer` = `sales_loss_stock_transfer` + `reorder_stock_transfer`.

---

## 13. Provenance of this document

- The module's six-dataset map, each dataset's routing summary, the live column
  lists, and the `Supply Plan` long shape: read from the TrueGradient connector
  via `tg_resolve_datasets`.
- The twelve `Variable` values, the five `Stock_Risk_Level` values, the zero-floor
  additivity failure, the pre/post-transfer relationship, and the 120-day
  reorder-to-receipt offset: **measured in one workspace's
  `inventory-optimization` experiment.** One workspace, one experiment. Treated
  as an example throughout, never as the contract — rediscover at runtime.
- No customer row values, identifiers, SKU codes or workspace names are reproduced
  here. The few magnitudes quoted (§5, §8) are proportions, not values, included
  only to show that a routing or variant mistake is material rather than cosmetic.
