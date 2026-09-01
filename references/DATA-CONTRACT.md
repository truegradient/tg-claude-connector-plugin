# TrueGradient Forecast Data Contract

What the forecast datasets contain, what is guaranteed, and what varies per
workspace.

> **Read this first:** almost nothing here is guaranteed to exist in a given
> workspace. Column sets are configured per experiment. The lists below describe
> what a workspace *may* have. Always discover the real columns at runtime —
> see `COLUMN-DISCOVERY.md`.

---

## 1. Modules

Every experiment belongs to one module. Only these three exist:

| Module | Covered by which skill? |
|---|---|
| `demand-planning` | the four `truegradient-forecast-*` skills — this document |
| `inventory-optimization` | `truegradient-supply-inventory` — see `SUPPLY-DATA-CONTRACT.md` |
| `pricing-promotion-optimization` | not covered — out of scope |

This document describes the **forecast** datasets only. If a user asks a supply or
inventory question (stock on hand, days of inventory, reorder points, stockout
timing, excess, stock transfers), hand off to `truegradient-supply-inventory`.
Do not answer it from `Final DA Data`.

If a user asks a pricing question (price elasticity, markdown, promotion ROI), say
it is outside these skills' scope.

> **Note:** `Final DA Data` and `Final DA Data Value` are exposed by the
> `inventory-optimization` module as well as `demand-planning`. Route on the
> **question**, not the module — a forecast question is a forecast question
> whichever module the experiment sits in.

---

## 2. Datasets

For `demand-planning`, an experiment exposes four datasets:

| Dataset name | Contents | Final forecast source? |
|---|---|---|
| `Final DA Data` | monthly forecasts, actuals, intervals, errors — **in units** | **Yes** |
| `Final DA Data Value` | the same structure — **in monetary value** | **Yes** |
| `Demand Alignment Report` | alignment reporting view | No |
| `Demand Alignment Value Report` | alignment reporting view, value | No |

"DA" means Demand Alignment.

Choose `Final DA Data` for quantity questions ("how many units") and
`Final DA Data Value` for money questions ("what revenue", "what value").
Never mix unit and value figures in one calculation.

---

## 3. Shape: wide, month-per-column

The datasets are **wide**, not long. One row is one entity. Time lives in the
*column names*.

```
Column name pattern:   YYYY-MM-DD <Family>
Example:               2026-07-31 Sales
                       2026-07-31 Locked ML Forecast Lag_4
                       2026-08-31 Upper Bound
```

Dates are **month-end**. Parse with:

```
^(\d{4}-\d{2}-\d{2})\s+(.+)$
   ^ month             ^ family
```

Consequences that matter:

- Asking "the last 6 months" means selecting 6 *columns*, not filtering rows.
- Different families cover **different month ranges**. This is normal, not an
  error. See §6.
- A dataset can be very wide. One observed workspace export had **632 columns**.
  Never do an unfiltered plain read — see `TOOL-GUIDE.md` §3.

---

## 4. Grain and hierarchy — always discovered, never assumed

The grain is configured per experiment. There is **no universal grain**.

| Observed in one workspace export (2026-08-03) | Documented elsewhere in TrueGradient |
|---|---|
| `product_variant_code` | `SKU Code` |
| `channel_name` | `Site ID` |
| `Region_name` | `Store Name` |

Neither list is authoritative. Read the non-date columns from
`tg_resolve_datasets` and use what is actually there.

Attribute and hierarchy columns that may appear:

`variant_name`, `product_name`, `brand_name`, `Category`, `Sub-category`,
`Product Name`, `Store Name`, `cluster`, `Lifestage`, `AB_Class`,
`sales_pattern_category`, `forecast_pattern_category`, `template_type`,
`template_name`, `template_description`

### The AB_Class trap

`AB_Class` holds a single ABC importance letter: `A`, `B`, or `C`.

- "**A class**" → `AB_Class = 'A'`
- "**B class**" → `AB_Class = 'B'`
- "**AB class**" → `AB_Class IN ('A','B')` — **A and B together, excluding C**

"AB class" is a business term meaning the important two-thirds. It does **not**
mean `= 'A'`. Getting this wrong silently drops or adds a large share of the
business.

The column may also appear as `AB Class` or with a `*_ABC_Class` suffix. Use the
exact name from the live column list.

---

## 5. Column families

### 5.1 Actuals

| Family | Meaning |
|---|---|
| `<date> Sales` | business-facing actual demand — **the default actual** |
| `<date> Raw Actual` | source/raw actual demand |
| `<date> LY Sales` | last year's sales — not a current actual |

### 5.2 Forecasts

| Family | Meaning |
|---|---|
| `<date> Locked ML Forecast Lag_N` | **global / primary lock** — frozen baseline; the default forecast side for accuracy |
| `<date> Lock ML Forecast Lag_N` | **secondary per-lag lock** — a separate family; readable on request, never a metric basis |
| `<date> Multi_Lock ...` | **multi-period lock** — frozen for the rest of the year from one experiment |
| `<date> Forecast` | operational forecast — the default for "what is the forecast" |
| `<date> ML Forecast` | raw model output |
| `<date> Consensus Forecast` | planner-agreed (absent in many workspaces) |
| `<date> Graph Reviewed Forecast` | planner edit made through a chart |
| `<date> Table Edited Forecast` | planner edit made through a table |
| `<date> Offset Forecast` | adjusted forecast |
| `<date> RL Forecast` | reinforcement-learning variant |
| `<date> RL Time Forecast` | RL time-based variant |
| `<date> RL Unconstrained Forecast` | RL variant without constraints |

### 5.3 Uncertainty

| Family | Meaning |
|---|---|
| `<date> Lower Bound` | lower prediction bound |
| `<date> Upper Bound` | upper prediction bound |
| `<date> P10` … `<date> P99` | forecast quantiles (commonly P10,P20,…,P90,P99) |

Quantiles are probabilistic forecast points, **not** alternate actuals.

A symmetric-looking pair is not a guarantee of a particular confidence level. Do
not label an interval "95% confidence" unless a field says so — describe it as
"the dataset's Lower/Upper Bound" or "the P10–P90 range".

### 5.4 Error

| Family | Meaning |
|---|---|
| `<date> Forecast Abs Error` | absolute error of the operational forecast |
| `<date> Locked ML Forecast Lag_N Abs Error` | absolute error of the global lock at lag N |
| `<date> Deviation Locked Lag_N` | signed deviation of the global lock at lag N |
| `Risk_Locked_Lag_N_<date>` | stored risk label for the global lock at lag N |

Absolute-error columns are **magnitude only** — they carry no direction. To know
whether the forecast was high or low, compare forecast to actual directly.

### 5.5 Quality and context

| Column | Meaning | How to use |
|---|---|---|
| `Imputation Flag` | the row's inputs were imputed | must be surfaced when contributing rows are flagged |
| `SnOP Comments` | free-text planner comment | the **only** legitimate source of human "why"; quote verbatim |

### 5.6 Optional precomputed analytics

These may or may not be present. **Detect before relying on them.**

| Column | Meaning |
|---|---|
| `overall_accuracy` | accuracy across all eligible months |
| `rolling_accuracy` | accuracy across the last N eligible months |
| `<date> Accuracy` | accuracy for that month |
| `<date> Bias` | bias for that month |
| `trust_zone` | stored trust band reflecting this workspace's configured thresholds |
| `% Contribution Last 3 Months` | volume share over the trailing 3 months |

When present, prefer them and cite them as stored/precomputed — they already
reflect the workspace's own configuration. When absent, compute per `METRICS.md`
and say the figure was derived. Recomputing a metric the workspace already stores
produces a second number for the same thing that will not match the product.

None of these carries a family or lag token, so which lock produced them is not
recoverable from the column name (`LOCK-FAMILIES.md`).

**Never `avg` one of these percentages across rows** to reach a coarser grain — a
3-unit SKU would count as much as a 30,000-unit one. Weight on volume share, or
compute from sums and say the figure was derived.

`trust_zone` may be **quoted with attribution** but never derived. See
`SAFETY-CONTRACT.md` §15.

### 5.7 Families that vary by workspace — always detect

**Present in one live workspace, absent in another. Detect, never assume.**

Observed present in a live IBP workspace (`Final DA Data`, 419 columns):
`SKU Code`, `Site ID`, `Risk_Locked_Lag_1_<date>` (10 of them),
`<date> Deviation Locked Lag_N`, `overall_accuracy`, `rolling_accuracy`,
`trust_zone`, `% Contribution Last 3 Months`, `<date> Accuracy`, `<date> Bias`,
`AB_Class`, `cluster`, `Lifestage`, `SnOP Comments`, `Imputation Flag`.

Observed **absent** in that same workspace, so never assume them either:
`<date> Consensus Forecast`, any secondary `Lock ...` family, any
`Multi_Lock ...` family, and `<date> Forecast Abs Error` — the only abs-error
family present was the lock's own.

Two shapes worth knowing:

- **The lag is not fixed.** That workspace's only lock family was
  `Locked ML Forecast Lag_1`. Examples in this plugin write `Lag_4`; read the lag
  from the live column list and name whichever one you used.
- **The lock can extend past the actuals.** `Locked ML Forecast Lag_1` covered
  2025-10-31 to 2027-07-31 (22 months) while `Sales` covered 2024-08-31 to
  2026-07-31 (24 months). The measurable window is the **intersection** — 10
  months — and the lock's future months are forecast, not measurement.

---

### 5.8 `Final DA Data Value` uses the *same* column names

Verified live: `Final DA Data Value` carries the identical column vocabulary to
`Final DA Data` — same `<date> Sales`, same `<date> Locked ML Forecast Lag_1`, same
`Abs Error`, same lock family name. **Only the dataset name distinguishes units
from money.**

That makes the mix-up easy and invisible: the query succeeds either way and the
number is plausible either way. July 2026 read 6,364 in `Final DA Data` and
77,650 for Food alone in `Final DA Data Value`. Nothing in a column name will warn
you.

- Decide the dataset from the question — units/quantity/volume → `Final DA Data`;
  revenue/value/money/working capital → `Final DA Data Value` — and **name the
  dataset in the provenance footer every time.**
- Never combine a figure from one with a figure from the other, and never carry a
  ratio computed in one over to the other.
- Accuracy differs between them, because the value dataset weights by price:
  measured on 2026-07-31, Cosmetics had value abs error (8,073) **exceeding** value
  actuals (7,959) — a negative accuracy in money terms for a group whose unit
  accuracy was positive. Say which basis a metric was computed on.

---

## 6. Ragged coverage is normal

Different families cover different months. In one observed export:

| Family | Months present |
|---|---|
| `Sales` | 24 |
| `Forecast` | 24 |
| `ML Forecast` | 24 |
| `Lower Bound` / `Upper Bound` / `P10`–`P99` | 24 each |
| `Forecast Abs Error` | 24 |
| **`Locked ML Forecast Lag_4`** | **5** |
| **`Locked ML Forecast Lag_4 Abs Error`** | **5** |

The baseline family covering far fewer months than the actuals is the **common
case**. It bounds how much accuracy history can be measured.

**Never construct a column name from a calendar.** If `2024-10-31 Sales` exists,
that does not imply `2024-10-31 Locked ML Forecast Lag_4` exists. Building names
by pattern is a documented, observed cause of `COLUMN_NOT_FOUND` failures — and
the lock families make this far easier to get wrong: they all share the same
` Lag_N` suffix, so only the leading word tells them apart. See
`LOCK-FAMILIES.md` §3.

---

## 7. Provenance of this document

- Module and dataset maps, and the server-side experiment gate: verified in the
  TrueGradient MCP server source.
- Column semantics, the `Sales` default, the AB-class rule, and the imputation
  guidance: TrueGradient's internal dataset knowledge documentation.
- The lock-family taxonomy and the preference for the global lock: specified by
  TrueGradient. See `LOCK-FAMILIES.md`.
- The 632-column shape, the specific family list, ragged global-lock
  coverage, and the `product_variant_code` / `channel_name` / `Region_name` grain:
  **observed in one workspace export dated 2026-08-03.** One workspace, one
  experiment. Treated as an example throughout, never as the contract.
- No customer data, row values or identifiers from that export are included in
  this plugin.
