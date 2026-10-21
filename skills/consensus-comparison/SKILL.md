---
name: consensus-comparison
description: Compare the planners' consensus forecast with TrueGradient's own forecast. Answers whether consensus added or removed accuracy against actual sales on past months (forecast value add), and how far apart the two are for the coming months, at any grain. Use this for "did consensus improve on the TG forecast", "consensus vs TG forecast", "forecast value add", "did planner overrides help", "how far is consensus from the model for next quarter". TrueGradient's side is the frozen model forecast for past months and the model output for coming months, both scored with one error method. Says plainly when a workspace records no consensus forecast and never substitutes another family for it; it offers the planner-adjusted operational forecast against the model instead, labelled. When wanted as Excel or an export, it builds a multi-tab workbook (Read Me, Summary, detail and exception tabs) whose tabs are chosen from the question. Do NOT use for overall forecast accuracy — use forecast-accuracy.
---

# Consensus versus TrueGradient Forecast

Answer two questions, and never let one borrow the authority of the other:

| Question | Months | Consensus side | TrueGradient side | Reads as |
|---|---|---|---|---|
| **Value add** — "did consensus improve on TG?" | past, with actual `Sales` | `<M> Consensus Forecast` | the **global lock**, `<M> Locked ML Forecast [Lag_N]`: the model's frozen forecast | a measured result, with caveats |
| **Gap** — "how far apart are they for the coming months?" | future | `<M> Consensus Forecast` | `<M> ML Forecast`: the model's current output | a difference between two plans, not a judgement on either |

For past months the lock is the only stored record of what the model said, so it
is the TrueGradient side. For future months the model's live output is
`ML Forecast`. If the user says "TG forecast" and means the operational
`Forecast`, use it, name it, and say it may already contain planner edits.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Detect `<date> Consensus Forecast` before anything else.** If it is absent,
   the first sentence of the answer says this workspace records no consensus
   forecast. **Never substitute** `Forecast`, `Table Edited Forecast`,
   `Graph Reviewed Forecast` or anything else and call it consensus. Then offer
   the planner-adjusted view (step 8), labelled as what it is.
3. **Score both sides with the same error method, at the same grain, on the same
   months.** Use row-level absolute error on both sides, or netted error at one
   named grain on both sides. Never mix them. Row-level error is always at least
   netted error (`Σ|A−F| ≥ |ΣA−ΣF|`), so pairing the lock's stored row-level
   `Abs Error` with a netted consensus error makes consensus win by
   construction. See `../../references/METRICS.md` §10.
4. **Value add = consensus accuracy − TrueGradient accuracy**, in points, with
   both accuracies and both biases shown. Positive means consensus added value.
   Also give the error units saved, `Σerr_TG − Σerr_consensus`. Rank groups by
   units saved, never by points.
5. **Consensus is not frozen.** It can be edited after the period it covers, and
   possibly after actuals are known, so it can look better than it was. Say so
   with every value-add figure. Name the lock's family and lag (or say the lag
   is unstated).
6. Keep the current month and the month containing the experiment's `createdAt`
   out of value add: their `Sales` are month-to-date.
7. Fewer than 3 eligible months → say the value-add figure is not yet meaningful.
8. **Totals hide offsetting gaps.** Two plans can agree in total and disagree
   wildly per product. Measured live: a portfolio where the two totals were
   within 0.3% for a month, while the largest product's planner forecast was
   2.2x the model's. Always give the gap at a group grain as well as in total,
   with the gross gap `Σ|C − M|` over groups beside the net gap.
9. Placeholder grain values (`UNKNOWN`, blank) stay in totals and are broken out.
10. Never `min`/`max` a number; rank with `sort_by` and `limit`.
11. End with the provenance footer.

Full detail: `../../references/METRICS.md` §10, §1a, and
`../../references/LOCK-FAMILIES.md`.

## Procedure

**1–3. Identify, pick, discover.**
`tg_whoami` → `tg_list_experiments_for_analysis()` (unfiltered) →
`tg_resolve_datasets(experiment_id="<id>", tables=["Final DA Data"])`. One
experiment per call. If it overflows, use `tg_dataset_info`.

**4. Map the months.**

```
Parse every column with  ^(\d{4}-\d{2}-\d{2})\s+(.+)$   → (month, family)

Per month record:
  sales      <M> Sales
  consensus  <M> Consensus Forecast                     (may be absent)
  c_err      <M> Consensus Forecast Abs Error           (rarely present)
  lock       <M> Locked ML Forecast [Lag_N]             global lock, one lag
  lock_err   <M> Locked ML Forecast [Lag_N] Abs Error
  model      <M> ML Forecast
  plan       <M> Forecast, <M> Table Edited Forecast, <M> Graph Reviewed Forecast

Value-add months = sales ∧ consensus ∧ lock, minus the current month and
the createdAt month.
Gap months       = consensus ∧ model, future months.
```

If consensus is absent, go to step 8.

**5. Value add — choose the error method once, for both sides.**

```
Both c_err and lock_err exist        → row-level on both: sum each Abs Error column
Otherwise                            → netted at grain g on both sides:
    group_by g, sum sales, consensus and lock per month,
    err_side = Σ over groups of |Σsales − Σside|
    g = the finest grain the reads allow; the full series grain is
        row-level. Partition with filters to stay under page_size.
    Never use lock_err in this case: it is row-level and consensus is not.
```

Then, over the value-add months:

```
acc_TG   = (1 − Σerr_TG / Σsales) × 100
acc_C    = (1 − Σerr_C  / Σsales) × 100
value add (points) = acc_C − acc_TG
units saved        = Σerr_TG − Σerr_C
bias_side          = (Σside − Σsales) / Σsales × 100      signed, 0 = unbiased
```

By group (category, AB class, channel, region, `trust_zone` if stored): the
same, with the group's own sums. Rank by units saved, show the points beside.
Say where consensus helped and where it hurt, by how many units.

**6. Gap — coming months.**

```
gap      = Σconsensus − Σmodel             per month and per group
gap %    = gap / |Σmodel| × 100            undefined when Σmodel = 0
gross    = Σ over groups of |gap_group|    beside the net total gap
```

Rank groups by `|gap|`. Show where consensus sits against the model's own band:
consensus outside `[Lower Bound, Upper Bound]` for a series or group is a planner
call the model did not expect (the bounds are `ML Forecast`'s). Do not judge
which side is right; that is what value add on past months is for.

**7. Read the evidence of edits, never invent it.**
`Table Edited Forecast` / `Graph Reviewed Forecast` equal to `Forecast` show that
edits flow into the operational plan; `SnOP Comments` may say why. If the comment
column is empty everywhere, say no reason is recorded.

**8. No consensus column.**

Say it first. Then:

- **Value add cannot be measured**, and say exactly why: past months store only
  the frozen model forecast, never a planner version, so there is nothing to
  score the planners' number against actuals with. Say what would be needed: a
  stored consensus (or planner-adjusted) forecast for months that later receive
  actual sales.
- **Offer the planner-adjusted gap**: `Forecast` (operational, planner-adjusted)
  against `ML Forecast` (model) for the coming months, with step 6's method and
  rule 8's group grain. Label it "operational plan versus model, not consensus"
  in the answer and the footer.

## Output shape

```
Over Mar–Jun 2026, consensus was more accurate than TrueGradient's frozen
forecast by 3.1 points: 58.2% against 55.1%, saving 361,000 units of error.
Consensus is not frozen and may have been edited after the fact, so treat
this as an upper bound on its value.

What the data says
  Months:      2026-03 .. 2026-06 (4 months); 2026-07 held out (created that month)
  TG side:     Locked ML Forecast (global lock; lag not stated in the name)
  Error:       netted at SKU × channel on both sides (no consensus Abs Error column)
  Bias:        consensus −4.0%, TG −12.9%

Where consensus helped most (units of error saved)
  Snacks        +210,000   +6.8 pts
  Beverages      +95,000   +2.1 pts
Where it hurt
  Dairy          −40,000   −3.0 pts

Coming months
  Nov–Jan consensus is 2.4% above the model in total, but the gross gap across
  categories is 14%: consensus raises Snacks by 22% and cuts Dairy by 9%.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data (units)
  Consensus:   Consensus Forecast (planner-agreed, not frozen)
  TG:          Locked ML Forecast (past); ML Forecast (coming months)
  Period(s):   value add 2026-03..2026-06; gap 2026-11..2027-01
  Caveats:     consensus not frozen; netted error at SKU × channel
```

## Excel workbook output

Produce a workbook when the user asks for Excel, a spreadsheet, a file or an
export, and offer one (one line at the end) when the answer has more than about
20 groups or covers both value add and the gap.

1. **Read Me**: the question; Source (experiment, dataset, the two families and
   the lock's lag, pull date); the error method and grain, stated once and used
   on both sides; the value-add months and every excluded month; the
   not-frozen caveat; provenance footer. With no consensus column, the first
   caveat says so and every tab is titled "operational plan versus model".
2. **Summary**: value add by group (`ratios` for both accuracies as ratios of the
   block's own sums, never averaged), and the gap by group.
3. **Main tabs**: `Value add` (group × month: sales, consensus, TG, both errors,
   both accuracies, points, units saved) and `Gap <months>` (group × month:
   consensus, model, gap, gap %, bounds).
4. **Exception tabs**: `Outside model band`, `Not measurable` (months or groups
   missing a side), each included even when empty.

Blueprints S (value add) and T (gap), column types and the spec format:
`../../workbook/WORKBOOK-SPEC.md` §2V. Build with
`python <this-skill-dir>/../../workbook/build_workbook.py <spec.json> <out.xlsx>`,
recalculate, check the Summary's points equal your headline, and in chat give the
headline and the largest caveat.

## Boundaries

- the workspace's forecast accuracy in general → **forecast-accuracy**
  (it measures the global lock; this skill is only for consensus against TG)
- any other two families compared, e.g. the lock against the current `Forecast`
  → **forecast-change**
- one forecast value → **forecast-lookup**
- comparing two runs or planning cycles → **snapshot-comparison**
- who changed the forecast → cannot be answered; no authorship is recorded

## References

- `../../references/METRICS.md` — §10 value add and gap, §1a consensus rules,
  §2 accuracy, §3 bias conventions
- `../../references/LOCK-FAMILIES.md` — choosing the global lock and its lag
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/COLUMN-SEMANTICS.md` — what each forecast family means, whose
  interval the bounds are
- `../../references/COLUMN-DISCOVERY.md` — optional columns, placeholders
- `../../references/TOOL-GUIDE.md` — partitioning, reserved aliases, text-compared
  `min`/`max`
- `../../workbook/WORKBOOK-SPEC.md` — §2V blueprints
- `../../workbook/build_workbook.py` — builds the workbook from a JSON spec
