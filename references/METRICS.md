# Forecast Metric Definitions

These formulas match the TrueGradient application's own implementation exactly.
Use them and nothing else, so a number Claude reports equals the number the
planner sees in the product.

---

## 0. Critical: do not use the engine's accuracy aggregations

`tg_fetch_dataset` accepts these aggregation functions:

```
wmape   accuracy   bias   mape   mae   rmse   sum_columns
```

**All seven are unusable.** They pass argument validation, but the connector
drops the `actual_column` field that every one of them requires before the
request reaches the query engine. `sum_columns` likewise loses its `columns[]`
list. A call using them either errors or returns a number computed against a
missing actual — silently wrong.

**Never send them.** Compute every metric from `sum` aggregations as specified
below. If a response ever does come back from one of them, distrust the value.

Working aggregation functions: `count`, `sum`, `avg`, `min`, `max`,
`count_distinct`, `median`, `percentile`, `stddev`, `variance`, `string_agg`.

---

## 1. Eligible-month discovery

Accuracy may only be measured on months where a frozen baseline and a matching
actual both exist. Determining that set is step one of every accuracy question.

```
1. Take the live column list from tg_resolve_datasets.

2. For each column matching  ^(\d{4}-\d{2}-\d{2})\s+(.+)$
   group by the date and record, per date:
     actual    = "<date> Sales"
     baseline  = "<date> <chosen lock family>"
     absError  = "<date> <chosen lock family> Abs Error"   (optional)
     consensus = "<date> Consensus Forecast"               (optional; see §1a)

   The baseline is ALWAYS the global lock ("Locked ..."), per LOCK-FAMILIES.md.
   Record consensus when the column exists, but it is NOT the baseline: it is
   used as the forecast side only for an explicit consensus question (§1a).
   Secondary "Lock ..." and "Multi_Lock ..." families are never a metric basis.
   Keep one lag only, and use the same family+lag for the baseline and its
   abs error. All lock families share the " Lag_N" suffix, so the leading word
   is the only discriminator - anchor on the trailing space.

3. DROP a month if:
     - it falls inside the current calendar month
         (incomplete — never enters a pooled figure; hold it aside and report it
          as a PARTIAL point, preferring a stored "<date> Accuracy" column.
          See the accuracy skill, step 4a.)
     - "<date> Sales" is absent
     - the chosen lock family's column is absent for that month
     - the month's lock column belongs to a different lag than the one chosen

4. Sort the surviving months ascending. This is the ELIGIBLE SET.
```

If the eligible set is empty, no accuracy figure can be produced. Say so, and say
why — usually because the workspace has no global-lock (`Locked ...`) columns at
all. A secondary `Lock ...` family is not a substitute. Never substitute `Forecast`,
`ML Forecast` or `Consensus Forecast` to produce a number: they are not frozen
baselines. (Measuring against consensus *because the user asked for consensus* is
a different thing and is covered in §1a — it is never a fallback for a missing
lock.)

**Always report the eligible window and every month you dropped, with its
reason.**

---

## 1a. Consensus forecast questions

`<date> Consensus Forecast` is the planner-agreed number. It is **absent in many
workspaces** — detect it in the live column list before relying on it, and say so
plainly when it is not there rather than answering with a different family.

**It changes nothing by default.** Every accuracy and bias figure is still
computed on the global lock. Consensus becomes the forecast side only when the
user explicitly asks about consensus — "how accurate is the consensus forecast",
"is consensus over-forecasting", "consensus versus actuals". A general accuracy
question is never answered on consensus.

When the question *is* a consensus question:

```
1. Run the same eligible-month discovery as §1, with one substitution:
     baseline = "<date> Consensus Forecast"
   Drop a month when Sales or the consensus column is missing for it, and treat
   the current calendar month exactly as before — out of the pooled figure,
   still shown as partial.

2. Use the same formulas — §2 accuracy, §3 bias, §6 directional error.

3. Look for a "<date> Consensus Forecast Abs Error" column first. It IS part of
   TrueGradient's documented schema, though it was absent from both observed
   workspaces. When present it is the preferred numerator, exactly as the lock's
   own abs-error column is. Only when it is absent is the numerator the netted
   fallback  |Σactual − Σconsensus|  — and then say so, and say that netting lets
   one item's over-forecast cancel another's under-forecast.
```

**Four things must be said in any consensus figure:**

- Consensus is **not frozen**. It can be edited after the period it covers, so a
  consensus accuracy figure measures a number that may have moved since it was
  made. It is not a baseline measurement, and it is not comparable to a lock
  figure as though both were frozen.
- Name the family explicitly: "against `Consensus Forecast` (planner-agreed, not
  a frozen baseline)" — in the answer and in the provenance footer.
- Report the global-lock figure alongside it whenever a `Locked ...` family
  exists, so the reader can see the frozen measurement too — **computed with the
  same error method as the consensus figure** (§10b). A row-level lock error beside
  a netted consensus error is not a comparison. Comparing the two is
  `consensus-comparison`'s job.
- Never present a consensus figure as *the* forecast accuracy of the workspace.

**Never substitute consensus for a missing lock.** If no `Locked ...` family
exists, the answer is still "no accuracy can be measured" — computing against
consensus instead and calling it accuracy is exactly the substitution §1 and
`LOCK-FAMILIES.md` forbid. Offering a consensus figure the user did not ask for,
clearly labelled, is fine only after saying the lock-based figure is unavailable.

Consensus is also a legitimate side of a **change** comparison (`Forecast` vs
`Consensus Forecast`) — that is arithmetic, not accuracy. See §5.

---

## 2. Accuracy

Accuracy here is the **WMAPE complement**:

```
WMAPE    = Σ|actual − forecast| / Σ|actual|        (textbook WMAPE / WAPE)
accuracy = (1 − WMAPE) × 100
```

Higher is better and 100 is perfect. It is **not bounded below**: when total
absolute error exceeds total actuals, WMAPE > 1 and accuracy is **negative**.
A negative accuracy is a real, reportable result — never clamp it to 0, and never
describe it as "0% accurate".

### Step 1 — get the sums

One `tg_fetch_dataset` call, batching every eligible month:

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "group_by": ["<dimension>"],
  "aggregations": [
    {"function": "sum", "column": "2026-03-31 Sales",                        "alias": "a_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4",           "alias": "f_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4 Abs Error", "alias": "e_2026_03"},
    {"function": "sum", "column": "2026-04-30 Sales",                        "alias": "a_2026_04"},
    {"function": "sum", "column": "2026-04-30 Locked ML Forecast Lag_4",           "alias": "f_2026_04"},
    {"function": "sum", "column": "2026-04-30 Locked ML Forecast Lag_4 Abs Error", "alias": "e_2026_04"}
  ],
  "page_size": 1000
}
```

Omit `group_by` for a single overall figure. Omit the `e_*` entry for any month
whose abs-error column does not exist.

### Step 2 — per month, decide usability and error

```
For each eligible month m, within each group:

  # NO month is skipped here. Textbook pooled WMAPE sums the numerator and the
  # denominator across the whole window; dropping a month drops its error too.
  #   - a zero or negative BASELINE is not a skip. Forecast 0, sold 5,000 is a
  #     100% miss and belongs in the figure.
  #   - a zero ACTUAL is not a skip either. Forecast 5,000, sold 0 contributes
  #     5,000 to Σerr and 0 to Σact, which is what drives accuracy negative.
  # Skipping either one deletes the largest errors and inflates the result.

  act_m = |sum(actual_m)|

  if absError column exists AND sum(absError_m) > 0:
      err_m = |sum(absError_m)|            # PREFERRED
  else:
      err_m = |sum(actual_m) - sum(baseline_m)|    # FALLBACK
```

### Step 3 — combine

```
if Σ act_m == 0:                 # no actuals ANYWHERE in the window
    accuracy = UNDEFINED         # report as not computable — never as 0
else:
    WMAPE    = Σ err_m / Σ act_m
    accuracy = (1 - WMAPE) * 100
```

Round to 2 decimals for display.

`Σ act_m == 0` is the **only** undefined case, and it means the whole window sold
nothing. A single zero-actual month inside a window that has actuals elsewhere is
fine — it contributes error with no offsetting volume, which is precisely the
signal a pure over-forecast should produce.

No cap and no floor. `1 − WMAPE` cannot exceed 1, so accuracy cannot exceed 100
on its own; if a figure ever comes out above 100, the inputs are wrong — say so
rather than clamping. Below zero it is genuine: `accuracy = −38.40` means total
absolute error ran 1.384× total actuals. Report it with that reading in words,
because a negative accuracy is easy to misread as a formatting error.

### Why the numerator choice matters — state which you used

`sum(absError)` is the sum of **row-level** absolute errors.
`|sum(actual) − sum(baseline)|` is the absolute error **of the totals**.

The first is always greater than or equal to the second, because the second lets
one item's over-forecast cancel another's under-forecast. The application prefers
the first.

**So the fallback overstates accuracy.** When you use it, say so: "computed from
netted totals because no absolute-error column exists for these months, which may
read slightly better than a row-level calculation would."

### Two windows

- **Overall accuracy** — over the entire eligible set.
- **Rolling accuracy** — over the last **N** eligible months, where N is the
  workspace's configured `past_accuracy_horizon`.

**No connector tool can read that configuration.** Default to the full eligible
set and state the window explicitly: "over the 5 eligible months
2026-03-31 to 2026-07-31". Never imply a configured horizon you cannot see.

---

## 3. Bias — two conventions, and they differ by exactly 100

**There are two bias scales in this system. Confusing them is a ~100-point error.**

### 3a. The STORED `<date> Bias` column — unbiased at 0

Verified live to 14 decimal places. For one SKU with `Sales` 41,
`Locked ML Forecast Lag_1` 21 and `Abs Error` 20, the stored `2026-07-31 Bias`
read `-48.78048780487805`:

```
stored bias = (forecast − actual) / actual × 100        signed percentage error

     0   unbiased
   > 0   over-forecasting   (forecast above actual)
   < 0   under-forecasting  (forecast below actual)
```

`(21 − 41) / 41 × 100 = −48.7805…` — an exact match. This is the textbook
signed-percentage-error convention.

**The trap:** the ratio convention below would have given `21/41 × 100 = 51.22`
for that same row — which happens to be the value of the stored **`Accuracy`**
column, not `Bias`. Reading the stored `Bias` on the ratio scale reports a 48.8%
under-forecast as a 48.8-point *over*-forecast, or feeds `|bias − 100| = 148.78`
into a downstream formula.

### 3b. A bias YOU compute — either scale, but name it

```
signed % error  = (Σ forecast − Σ actual) / Σ actual × 100     0   = unbiased
ratio × 100     =  Σ forecast / Σ actual × 100                 100 = unbiased

They are the same number offset by 100:   signed = ratio − 100
```

Measured over the 10 eligible months: Σ forecast 50,632, Σ actual 64,781 →
ratio **78.16**, signed **−21.84**. Both say the same thing: the frozen baseline
ran about 22% below actuals.

**Prefer the signed form**, because it matches the stored `<date> Bias` column and
so the two are directly comparable. If you report the ratio, say "unbiased at
100" in the same breath.

### 3c. Rules

- **Never mix the scales in one table or one sentence.** A column of stored
  `<date> Bias` values and a computed ratio in the next row are 100 apart.
- **Always state the convention** with the number: "bias −21.84 (signed, 0 =
  unbiased)" or "bias 78.16 (ratio, 100 = unbiased)".
- Any formula taking a "distance from unbiased" must use the right origin:
  `|bias − 0|` for a stored `<date> Bias` or a signed figure, `|bias − 100|` for a
  ratio. See the risk skill's `bias_gap`.
- Undefined when `Σ actual = 0` — report as not computable, not as zero.

---

## 4. Volume contribution

How much of the business a group represents — used to weight risk so that a
wildly inaccurate but trivial item does not outrank a slightly inaccurate but
huge one.

```
contribution_pct(group) = |Σ act(group)| / Σ over all groups |Σ act| * 100
```

If a `% Contribution Last 3 Months` column exists, you may use it instead — say
that you did, since its window is fixed at 3 months and may differ from your
accuracy window.

---

## 5. Change between two forecast versions

Purely arithmetic. No accuracy involved.

```
delta         = new_value - old_value
delta_pct     = (delta / |old_value|) * 100        if old_value != 0
                undefined                          if old_value == 0
```

When `old_value = 0`, report the absolute change and say the percentage is
undefined rather than printing infinity or a huge number.

Always name both versions precisely. Within one experiment they are two column
families; across two runs of one pipeline they are the same family in each run
(§12, `snapshot-comparison`). A common pairing is `Forecast` vs
`Consensus Forecast`: operational plan against the planner-agreed number.

---

## 6. Directional error for a single entity

Absolute-error columns carry no direction. To answer "did we forecast too high or
too low", compute it:

```
deviation = forecast - actual
  positive -> over-forecast
  negative -> under-forecast
```

This sign convention matches TrueGradient's documented default — but **compute it,
never read it from a `Deviation` column.** Those are magnitude-only in live data
despite being documented as signed (`DATA-CONTRACT.md` §5.4). Using one for
direction inverts the answer.

---

## 7. Naming traps — always show your formula

These names collide with each other and with textbook usage. Print the formula
next to the number, every time.

**The textbook definitions, used here exactly as written** (`A` = actual,
`F` = forecast, `n` = number of rows):

```
WMAPE (= WAPE) = Σ|A − F| / Σ|A|              lower is better; 0 is perfect
MAPE           = (1/n) · Σ ( |A − F| / |A| )  lower is better; undefined on A = 0
MAE            = (1/n) · Σ |A − F|            in units, not a percentage
RMSE           = √( (1/n) · Σ (A − F)² )      in units; penalises large misses
```

- This plugin's **accuracy** is `(1 − WMAPE) × 100` — higher is better, 100 is
  perfect, **negative when absolute error exceeds actuals**, and neither capped
  nor floored (§2). Say which direction you mean whenever you report it: "34.2%
  accuracy, i.e. WMAPE of 65.8%".
- **WMAPE and MAPE are different metrics and do not convert into each other.**
  WMAPE weights every unit equally, so high-volume rows dominate. MAPE weights
  every *row* equally, so a 3-unit SKU moves it as much as a 30,000-unit one, and
  it blows up on rows with near-zero actuals. Quoting one when asked for the other
  is a real error, not a rounding difference.
- **`bias` comes in two scales and they differ by exactly 100** (§3). The stored
  `<date> Bias` column is a signed percentage error, **unbiased at 0**. A bias you
  compute as `ΣF/ΣA × 100` is a ratio, **unbiased at 100**. `signed = ratio − 100`.
  Prefer the signed form so it is comparable with the stored column, and **always
  state which scale** with the number. Never put one of each in the same table.
- If asked for **WAPE or WMAPE**: give `Σ err / Σ act` directly, or give accuracy
  and note that `WMAPE = 100 − accuracy` in percentage points.
- If asked for **MAPE, MAE or RMSE**: these are row-level averages and cannot be
  recovered from the batched `sum` aggregations — the sums have already collapsed
  the rows. Either read the rows and compute honestly, or give WMAPE, name it as
  WMAPE, and say why MAPE was not computed. Never relabel a WMAPE figure as MAPE.
- **Never reason about the engine's own `wmape` / `mape` / `accuracy` / `bias`
  functions.** They are unusable (§0) and their direction and scale are not
  documented. Do not describe, convert, or compare against their output.

---

## 8. Rounding and presentation

- Accuracy, bias, contribution: 2 decimal places.
- Unit quantities: whole numbers unless the data is clearly fractional.
- Never present more precision than the inputs justify.
- Always pair a metric with its grain and its period. A bare "accuracy is 34%" is
  not an answer — "34.2% for Category X across the 5 eligible months
  2026-03-31 to 2026-07-31" is.

---

## 9. Year on year

Used by `year-on-year`. Pure arithmetic on sums; no accuracy
involved.

### 9a. Pairing

```
Key every dated column by its YYYY-MM.
this-year month M  ↔  last-year month = YYYY-MM of (M − 1 year)
  2026-02-28 ↔ 2025-02-28      2025-02-28 ↔ 2024-02-29
Never pair by position ("twelve columns back"): ragged coverage shifts every pair.
```

Last-year basis, one per figure:

| Basis | When | Say |
|---|---|---|
| `<M − 12> Sales` | default; same definition as the this-year actual | "Sales 12 months earlier" |
| `<M> LY Sales` | only when `Sales` 12 months earlier is absent for the whole window and `LY Sales` covers it | "LY Sales, a stored column whose definition the connector cannot verify" |

Where both exist, compare `Σ LY Sales(M)` with `Σ Sales(M − 12)` month by month
and report whether they agree (within 0.5%). A disagreement is reported, not
explained.

### 9b. Formulas

```
this      = Σ over the window's months of Σ this-year column
last      = Σ over the SAME months, shifted one year, of Σ last-year column
change    = this − last
growth %  = change / |last| × 100            undefined when last = 0
```

- **Ratio of sums.** Portfolio growth is the formula on portfolio sums, never an
  average of group or monthly growth rates. Two groups at +50% (on 10 units) and
  +1% (on 10,000 units) pool to +1.05%, not +25.5%.
- **Same months both sides.** A month missing on either side leaves the window on
  both sides.
- **Incomplete months out** of actual growth: the current month, and the month
  containing the experiment's `createdAt`. Both are month-to-date against a full month.
- **Never use the stored `<M> YoY Perc Change`.** Verified live, it is
  `(Locked ML Forecast Lag_1 − LY Sales) / LY Sales × 100` per row, on forecast
  months only. That is the lock, not `Forecast` or actuals, and a per-row
  percentage cannot be averaged into a group figure.
- **Rank by absolute change**, show % beside it.

### 9c. Like-for-like

Per month, rows with `Sales > 0` in both that month and the same month a year
earlier. `non-comparable change = total change − like-for-like change`. State the
definition with the figure; it is row-level, so an item that moved location
counts as lost at one and new at the other.

### 9d. Plan versus last year

```
plan growth % (family F) = (Σ F(M) − Σ Sales(M − 12)) / |Σ Sales(M − 12)| × 100
```

A statement about what the plan assumes, never a measured growth. One figure per
named family, all against the same base; never blended. Only for months with no
`Sales` yet.

A **full-year outlook** composes completed months of `Sales` with remaining months
of **one** named forecast family, against the full prior year. Name the split
("8 months Sales + 4 months Forecast").

### 9d-bis. Sensitivities that sit beside the headline

Neither replaces the total; both are labelled.

- **Excluding placeholder rows** (`UNKNOWN` …): required when they carry more than
  a quarter of the absolute change.
- **Excluding one row**: required when a single row holds at least 25% of a
  window month's total and at least 10x its own neighbouring months. Remove it from
  both sides of the window.

A plan-versus-actual realism check compares **total with total** first. Other
bases are given only labelled, and only when they differ by more than 5 points.

### 9e. Price and mix

With unit growth `g_u` and value growth `g_v` on the same window and items:
`implied price/mix change = (1 + g_v) / (1 + g_u) − 1`. Derived, mix included.

### 9f. Presentation

Growth to 1 decimal place with its sign (`+7.9%`, `−4.3%`), units whole. Always
give both windows: "Jan–Jul 2026 vs Jan–Jul 2025".

---

## 10. Consensus versus TrueGradient: value add and gap

Used by `consensus-comparison`. §1a still governs consensus inside the
accuracy skill; this section governs comparing the two.

### 10a. The two sides

| Months | Consensus | TrueGradient |
|---|---|---|
| past (value add) | `<M> Consensus Forecast` | the global lock `<M> Locked ML Forecast [Lag_N]`, one lag (`LOCK-FAMILIES.md`) |
| future (gap) | `<M> Consensus Forecast` | `<M> ML Forecast` |

Value-add months need `Sales`, consensus and the lock. Drop the current month and
the month containing `createdAt`.

### 10b. One error method for both sides

```
Row-level   both <M> Consensus Forecast Abs Error and <M> <lock> Abs Error exist
            err_side = Σ that side's Abs Error column
Netted      otherwise, at ONE grain g for both sides:
            err_side = Σ_groups |Σ Sales − Σ side|
```

`Σ|A−F| ≥ |ΣA−ΣF|` at every grain, so mixing methods is never neutral: the
lock's stored row-level error against a netted consensus error makes consensus
look better by construction. With the netted method, the finer `g` is, the closer
both sides come to row-level, and the full series grain *is* row-level. Name `g`.

### 10c. Formulas

```
acc_side    = (1 − Σerr_side / ΣSales) × 100          1 − WMAPE, may be negative
value add   = acc_C − acc_TG                          points; > 0 consensus helped
units saved = Σerr_TG − Σerr_C                        rank groups by this
bias_side   = (Σside − ΣSales) / ΣSales × 100         signed, 0 = unbiased
gap         = ΣC − ΣModel        gap % = gap / |ΣModel| × 100
gross gap   = Σ_groups |gap_group|                     beside the net gap
```

Group figures come from the group's own sums, never an average of item
percentages. Fewer than 3 value-add months: not yet meaningful.

### 10d. Mandatory disclosures

Consensus is not frozen; the TrueGradient side's family and lag; the error method
and grain; the months used and excluded. With no consensus column, value add
cannot be measured, and a `Forecast` versus `ML Forecast` gap is labelled
"operational plan versus model", never consensus.

---

## 11. Disaggregation: shares and add-back

Used by `forecast-disaggregation`.

### 11a. Series split

```
series value = Σ <M> <family> over the rows of one series (exactly one row)
SKU total    = Σ over the SKU's series
share        = series value / SKU total
add-back     = proved by counts: returned series = the SKU's row count n,
               every series n = 1, returned < page_size. Then Σ series = SKU
               total by construction; otherwise the read was truncated
top-SKU share of month = Σ top SKUs / portfolio total
```

### 11b. Component split

```
component total   = Σ disaggregated value over its rows        (fractional; round last)
warehouse share   = Σ value at warehouse / component total
cell difference   = component value − parent value             per component × channel × region
                    where the parent SKU code equals the component code
```

Component units are not parent units: a bundle expands into several components,
so portfolio totals do not reconcile. Report cell differences; never explain them
or fill them with an inferred bill of materials.

---

## 12. Snapshot comparison: two runs of one pipeline

Used by `snapshot-comparison`. A = the older run, B = the newer, same `tag` and
module, same family, same target month, matched on the grain both share.

```
change      = ΣB − ΣA                 items present in both
change %    = change / |ΣA| × 100     undefined when ΣA = 0
new         = in B only               listed, never a change from 0
dropped     = in A only               listed, never a change to 0
restated    = ΣSales_B(M) − ΣSales_A(M)            months with Sales in both runs
A's error   = ΣForecast_A(M) vs ΣSales_B(M)        months forecast in A, actual in B
```

- Rank by absolute change. Totals are over matched items, with new and dropped on
  their own lines so each run's total can be rebuilt.
- Forecast movement, restated history and A's error are reported separately.
- B is closer to every target month, so part of any movement is horizon
  convergence. Say so.
