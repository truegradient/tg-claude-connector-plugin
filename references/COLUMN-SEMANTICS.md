# Column Semantics — what each column *means*, and which one to pick

Source: TrueGradient's own analyst knowledge base
(`tg-vibe-gradient/src/knowledge/dataset/*.md`), reconciled against two live IBP
experiments. This is the **meaning** layer. `DATA-CONTRACT.md` says which columns
exist; `COLUMN-DISCOVERY.md` says how to find them; this file says which one
answers the question in front of you.

**Precedence when sources disagree:** the live column list from
`tg_resolve_datasets` always wins on *names*. This file wins on *meaning*. Where a
name here is absent live, the concept may still exist under a different name — go
find it rather than declaring the question unanswerable.

---

## 1. Picking the dataset

| The question is about | Dataset |
|---|---|
| historical actuals, forecast variants, accuracy, deviation, quantiles, forecast risk — **in units** | `Final DA Data` |
| the same, but financial / value-first | `Final DA Data Value` |
| current inventory state, reorder-now, stock risk, excess/dead stock, projected OOS timing | `DOI Details` |
| how inventory **evolves** over the horizon, stockout timing, replenishment cadence — units | `Supply Plan` |
| the same, in money | `Supply Plan Value` |
| recommended transfers between locations | `Stock Transfer` |
| markdown, price elasticity, promotion | `Price Optimization` — **out of scope for this plugin** |

Two rules that decide most ambiguous cases:

- **Needs a period → `Supply Plan`. A single number as of today → `DOI Details`.**
- **Never blend a unit metric and a value metric in one KPI** unless the user asks
  for a combined view. The two datasets share identical column names, so nothing
  warns you (`DATA-CONTRACT.md` §5.8).

---

## 2. `Final DA Data` / `Final DA Data Value` — which column to read

### Actuals

| Column | Meaning | Use it? |
|---|---|---|
| `<date> Sales` | business-facing actual demand | **the default actual** |
| `<date> Raw Actual` | source/raw actual demand | only when the user says "raw" or "source" |
| `<date> LY Sales` | last year's sales | comparison only — **never** as a current actual |

### Forecast variants — each answers a different question

| Column | Meaning | The question it answers |
|---|---|---|
| `<date> Forecast` | operational forecast | "what are we planning" — **the default for a forecast value** |
| `<date> ML Forecast` | pure model output, no human edit | "what does the model say" · the family the uncertainty band belongs to |
| `<date> Locked ML Forecast [Lag_N]` | frozen baseline | "how good has the forecast been" — **the only accuracy basis** |
| `<date> Consensus Forecast` | planner-reviewed / planner-agreed | "what did the planners agree" |
| `<date> Offset Forecast` | adjusted forecast | only when named |
| `<date> Graph Reviewed` / `Table Edited Forecast` | planner edits via chart / table | evidence a human moved the number |
| `<date> RL *` | reinforcement-learning variants | only when named |

Selection rules, verbatim from the source knowledge base:

- **committed-baseline or accuracy review → `Locked ML Forecast`**
- **planner-agreed view → `Consensus Forecast`**
- **operational view → `Forecast`**

### Uncertainty

`<date> Lower Bound` / `Upper Bound` and `<date> P10`–`P99` are **probabilistic
forecast points, not alternate actuals**. They belong to the **model**, so an edited
`Forecast` can sit outside them — verified live, point 101 against a 42–78 band, and
every sampled `ML Forecast` inside its band. See the lookup skill, step 5b.

### Accuracy, deviation, risk

| Column | Meaning | Direction |
|---|---|---|
| `<date> <family> Abs Error` | absolute error of that family | **magnitude only, no direction** |
| `<date> Deviation *` / `Deviation_*` | signed deviation | `Deviation = Forecast − Sales`; **positive = over-forecast**, negative = under |
| `<date> Accuracy` | stored per-month accuracy | higher is better; see `METRICS.md` §2 |
| `<date> Bias` | stored per-month bias | **signed % error, 0 = unbiased** — not the ratio scale (`METRICS.md` §3a) |
| `Risk_*` / `Risk_Locked_Lag_N_<date>` | stored risk label | quote it; never derive one |
| `trust_zone` | stored trust band | the risk classification itself (risk skill §9a) |

`Consensus Forecast Abs Error` **is** part of the documented schema even though it
was absent from both observed workspaces. Detect it: when present, it is the
preferred numerator for a consensus accuracy question, and the netted fallback is
no longer needed.

### Quality

`Imputation Flag` — surface it whenever a conclusion rests on flagged rows.
Measured live at 1,101 of 2,379 rows (46%) in one experiment, so this is not a
rare footnote.

### Segment filters

`AB_Class` / `AB Class` / `*_ABC_Class` — see the AB_Class rule in
`COLUMN-DISCOVERY.md`. **"AB class" means A ∪ B, excluding C** — not `= 'A'`.

---

## 3. `DOI Details` — current state and what to order

| Concept | Column | Note |
|---|---|---|
| usable stock now | `Stock_On_Hand` | |
| pending, **not** available | `In Transit`, `Open PO` | never add these into on-hand |
| coverage | `Days on Inventory`, `DOI_Current_Stock` | **`Days on Inventory` is the primary coverage signal when both exist** |
| realized demand rate | `Sales Per Day` | |
| expected demand rate | `Forecast_Per_Day` | **do not confuse with `Sales Per Day`** |
| when it runs out | `Current_OOS_Date`, `OOS_Episode_Count`, `Total_Projected_OOS_Days`, `OOS_Episode_Details` | |
| policy | `TG Reorder Point`, `TG Ideal Inventory`, `TG Safety Stock`, `current_safety_stock`, `TG Reorder Interval`, `lead_time`, `Minimum Order Quantity`, `round_off_reorder` | |
| the action | `TG Reorder now`, `TG Reorder Quantity`, `TG Reorder Date` | |
| risk / exposure | `Stock_Risk_Level`, `Excess_Stock`, `Dead_Stock`, `Potential_Sales_Loss`, `potential_stock_wastage` | `Stock_Risk_Level` is stored — quote, never derive |
| money | `soh_value`, `Excess_Stock_value`, `Dead_Stock_value`, `Potential_Sales_Loss_value`, `Selling Price`, `Cost`, `COGS`, `Margin%` | |

**Urgency rises** with low `Days on Inventory`, a near `Current_OOS_Date`, a
positive `Forecast_Per_Day`, and a non-zero `TG Reorder Quantity`.
**Overstock severity rises** with `Excess_Stock`, `Dead_Stock` and wastage.

Respect MOQ, rounding and lead time when explaining a reorder — the recommendation
already accounts for them, so a hand-rolled quantity will disagree with the product.

---

## 4. `Supply Plan` / `Supply Plan Value` — read through `Variable`

Every date column is meaningless until you filter `Variable`. The union of
documented and observed values:

| `Variable` | Meaning | Class |
|---|---|---|
| `Beginning Inventory` | on-hand at period start | units |
| `End Inventory` | on-hand at period end, **floored at 0** | units |
| `Forecast` | demand consumed in the period | units |
| `In Transit` | shipped, not yet received | units |
| `Open Purchase Orders` | placed POs expected in the period | units |
| `Total Inbounds` | committed supply — `In Transit` + `Open Purchase Orders` | units |
| `Reorder Plan` | recommended order **placed** in the period | units |
| `Reorder Received` | recommended order **landing** in the period | units |
| `Production Plan` | planned production in the period | units |
| `Total Stock Transfer` | transfer volume in the period | units |
| `Days On Inventory` | base coverage from on-hand | **days** |
| `Days On Inventory With Pending` | coverage including pending inflows | **days** |
| `Safety Stock Days` | configured safety-stock target | **days** |
| `Forecast Per Day` | daily demand rate the simulation uses | **rate** |

Neither list is complete on its own — the observed workspaces had eleven values and
no `Production Plan` or `Total Stock Transfer`, while the knowledge base documents
those two and omits `Open Purchase Orders`, `Total Inbounds` and `Reorder Plan`.
**Always run the `group_by: ["Variable"]` probe and classify from what comes back.**

Aggregation by class: **units → `sum` is valid. days and rate → never `sum` across
entities; use `avg` or report a distribution** (`SUPPLY-DATA-CONTRACT.md` §4).

`Reorder Plan` and `Reorder Received` are the same order at two moments separated by
lead time — never add them. `Total Inbounds` excludes both.

---

## 5. `Stock Transfer` — recommended movements between locations

Transfers exist to prevent sales loss and to cut the reorder a site would otherwise
need. Documented columns:

| Column | Meaning |
|---|---|
| `Component SKU` | most granular item code |
| `Warehouse` | the row's warehouse — receiving or reference node |
| `From_Facility` | warehouse the stock moves **from** |
| `sales_loss_stock_transfer` | transfer quantity that prevents potential sales loss |
| `reorder_stock_transfer` | transfer quantity that reduces a reorder |
| `total_stock_transfer` | sum of the two above |

This dataset was **empty in both observed experiments** (`resolved: true`, 0
columns, and a 502 on read). Empty means the transfer model was not run — it does
**not** mean zero transfers are planned. See the supply skill.

---

## 6. Cross-cutting selection rules

1. **Pair every metric with its grain and its period.** A number without "which
   entity, which month" is ambiguous and not an answer.
2. **Use stored fields over anything you derive**, and say which you did — but a
   stored figure whose window you cannot name does not replace a computed one whose
   window you can (accuracy skill, step 5).
3. **For "latest", take the most recent month present in that column family** — not
   the most recent month in the dataset. Families have ragged coverage.
4. **Drop rows where every relevant forecast column is null** before presenting a
   forecast family, rather than showing empty rows.
5. **Aggregate before presenting.** Never return raw row-level dumps.
6. **Never infer a column name.** Every name must come from the live list.
