---
name: snapshot-comparison
description: Compare two runs (snapshots) of the same TrueGradient planning pipeline and report what moved between them — the forecast for the same target months, the largest movers, items new or dropped, and actuals that were restated — by month, product, category, channel or region. Use this for "compare the last two runs of this pipeline", "what changed since last cycle's forecast", "how did the forecast move between snapshots", "what's new or dropped since the previous run". Works only when two Completed runs that share a pipeline tag are visible to the connector; when only one is, it says so and offers the within-run comparison instead. Pairs the same target months and the same items, and separates forecast movement from restated history and from the shorter horizon of the newer run. When wanted as Excel or an export, it builds a multi-tab workbook (Read Me, Summary, detail and exception tabs) whose tabs are chosen from the question. Do NOT use for two forecast families inside one run — use forecast-change.
---

# Snapshot Comparison

Put two runs of the same planning pipeline side by side, on the same target
months and the same items, and say exactly what moved, what is new and what was
restated.

**A pipeline** is a set of experiments sharing one `tag` (TrueGradient's Impact
Pipeline). Each Completed run is a **snapshot**: the forecast as that run made
it. The connector's roster shows only Completed, unarchived experiments, newest
first, so an earlier run is often not visible. Observed live in three
workspaces: every pipeline had exactly one visible run. This skill therefore
starts by proving a second run exists.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Two runs of one pipeline, or nothing.** Both runs must share the same `tag`
   and module. If the tag has one visible run, say so in the first sentence:
   "only one run of this pipeline is visible; earlier runs are archived, removed
   or were never kept". Then offer the within-run comparison
   (**forecast-change**: the frozen lock against the current `Forecast` is what
   moved since the baseline). Never compare against a different pipeline to fill
   the gap.
3. **Two experiments with different tags are not snapshots.** Compare them only
   if the user names both explicitly, and title it "two different pipelines":
   differences include setup, item list and grain, not only forecast movement.
4. **Same target months, same items, same family.** Compare a target month only
   when both runs carry it in the chosen family (`Forecast` by default; `ML
   Forecast` to isolate the model's own movement). Match items on the grain the
   two runs share. Never compare different months, and never compare one family
   in one run with another family in the other.
5. **Keep three movements apart.** For each target month, report separately:
   - **forecast movement**: both runs forecast the month;
   - **restated history**: both runs carry `Sales` for the month and the values
     differ, meaning a data correction or a reload, not a forecast change;
   - **forecast → actual**: the older run forecast the month, and the newer run
     has its `Sales`. That is the older run's error, not a change of plan.
     Label it, and point to **forecast-accuracy** for a full measurement.
6. **The newer run is closer to every month.** A target month is fewer months
   ahead in the newer run, so some movement is the normal convergence of a
   shorter horizon. Say so whenever you compare future months.
7. **Change is a ratio of sums** (`METRICS.md` §12): `(ΣB − ΣA) / |ΣA|`, with
   undefined when `ΣA = 0`. Rank items and groups by **absolute** change.
8. **New and dropped items are listed, never netted into "change".** An item only
   in the newer run is new (its value is not a change from 0); an item only in
   the older run is dropped.
9. **No authorship, no reasons.** TrueGradient keeps no version history,
   authorship or reason codes. Report what moved, never why, beyond
   `SnOP Comments` quoted verbatim.
10. Resolve and read each run separately, one experiment per call, scoped with
    `tables`. Never `min`/`max` a number. Never page a computed read; partition
    with filters and check `returned < page_size`.
11. End with the provenance footer, naming **both** runs.

Full detail: `../../references/METRICS.md` §12 and
`../../references/SAFETY-CONTRACT.md`.

## Procedure

**1–2. Identify, list.**
`tg_whoami` → `tg_list_experiments_for_analysis()` (unfiltered). Group the roster
by `tag`.

```
The user named a pipeline (a tag, or a run's label)  → that tag
The user said "the last two runs"                    → the tag of the newest run
Runs in the tag, newest first by createdAt:
   2 or more   → B = newest (or the one named), A = the run before it
   1           → rule 2: say so, offer forecast-change, stop
Same module for A and B?   no → not snapshots of one pipeline; rule 3
```

Note that the roster lists at most the newest experiments, so a long-running
workspace may show fewer runs than exist.

**3. Discover each run separately.**

```
tg_resolve_datasets(experiment_id=A, tables=["Final DA Data"])
tg_resolve_datasets(experiment_id=B, tables=["Final DA Data"])
```

Compare the two column lists:
- **grain**: the identity columns of each. Use the columns both share. If B
  added a column (a run's description may say so, e.g. "Added Channel"), the
  shared grain is coarser than B's; say so. No shared identity column → stop:
  the runs cannot be matched item by item. Offer totals by month only.
- **target months**: the months each run carries per family. Note which months
  are forecast in A and actual in B (rule 5).

**4. Read the same sums from each run.** One batched call per run, the same
aggregations, grouped by the shared grain (or by a coarser group for the
summary):

```json
{"group_by": ["<shared grain or group column>"],
 "aggregations": [{"function": "sum", "column": "2026-11-30 Forecast", "alias": "f_2611"},
                  {"function": "sum", "column": "2026-12-31 Forecast", "alias": "f_2612"},
                  {"function": "sum", "column": "2026-07-31 Sales",    "alias": "s_2607"},
                  {"function": "count", "alias": "n"}],
 "page_size": 1000}
```

If a run has more groups than `page_size`, partition with filters, identically in
both runs. Then join the two results yourself on the shared grain.

**5. Compute.**

```
Per target month M and per item or group g:
  A_g, B_g            the family's sum in each run
  change              = B_g − A_g                       both present
  change %            = change / |A_g|                  undefined when A_g = 0
  new                 = present in B only               listed, not a change
  dropped             = present in A only               listed, not a change
Totals: the same on portfolio sums, over items present in both, with new and
dropped shown on their own lines so the reader can rebuild the run totals.
Restated history: months with Sales in both runs, |ΣSales_B − ΣSales_A| > 0
Forecast → actual: A's forecast vs B's Sales for months actual in B only
```

Rank movers by `|change|`. Give the top 10 up and the top 10 down.

**6. Quality flags.** Placeholder grain values (`UNKNOWN`) broken out. Labels that
differ only in spelling between the runs (`COLUMN-DISCOVERY.md` step 4f) would show
as one dropped and one new item; check for this before calling them so. Items whose
code changed between runs cannot be matched; say the connector cannot see renames.

## Output shape

```
Between the June run and the July run of the "Monthly Demand" pipeline, the
forecast for Aug–Dec 2026 rose 4.2%: 512,300 units against 491,600, on the
2,310 items both runs carry. The July run also adds 64 new items (8,900 units)
and drops 21 (1,700 units).

What the data says
  Runs:        A = Monthly_June (created 2026-06-09), B = Monthly_July (2026-07-09)
  Pipeline:    tag "Monthly Demand"; both demand-planning
  Matched on:  SKU × channel (B added City; A has none, so City is not used)
  Family:      Forecast (operational), both runs
  Months:      2026-08 .. 2026-12, forecast in both

What moved
  Largest increases     SKU 101 · Online  +6,200 (+31%) ...
  Largest decreases     SKU 230 · Retail  −2,900 (−18%) ...

Restated history
  May 2026 Sales differ between the runs: 301,200 in A, 303,050 in B (+0.6%).
  A data correction or reload, not a forecast change.

Forecast → actual
  June 2026 was forecast at 288,400 in A; B records 301,900 sold.
  That is A's error (+4.7% under), not a change of plan.

What to consider
  B is one month closer to every target month, so part of the movement is the
  shorter horizon. No reason is recorded for any change.

Source
  Company:     Acme Foods
  Runs:        A Monthly_June (exp_811), B Monthly_July (exp_912), both Completed
  Dataset:     Final DA Data (units)
  Family:      Forecast (operational) in both
  Period(s):   2026-08 .. 2026-12
  Caveats:     matched at the shared grain; no version history or authorship
```

## Excel workbook output

Produce a workbook when the user asks for Excel, a spreadsheet, a file or an
export, and offer one (one line at the end) when more than about 20 items moved.

1. **Read Me**: the question; both runs (label, id, created date, tag, module);
   the shared grain and anything not matched; the family; the months; the
   horizon caveat; the no-history caveat; provenance footer.
2. **Summary**: a `Month` block and a group block (category, channel), each with
   `Run A`, `Run B`, `Change`, and `Change %` as a ratio of the block's sums.
3. **Main tab** `Moved <months>`: one row per matched item × month.
4. **Exception tabs**: `New in B`, `Dropped from B`, `Restated history`,
   `Forecast to actual` — each included even when empty.

Blueprint U, column types and the spec format:
`../../workbook/WORKBOOK-SPEC.md` §2X. Build with
`python <this-skill-dir>/../../workbook/build_workbook.py <spec.json> <out.xlsx>`,
recalculate, check that the Summary totals equal your computed totals, and in
chat give the headline and the largest caveat.

## Boundaries

- two forecast families inside one run → **forecast-change**
- how accurate a run's forecast was → **forecast-accuracy**
- this year's actuals or plan against last year's sales → **year-on-year**
- who changed a forecast, or why → cannot be answered; no authorship or version
  history is recorded

## References

- `../../references/METRICS.md` — §12 snapshot formulas, §5 change arithmetic
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/COLUMN-DISCOVERY.md` — grain, placeholders, duplicate labels
- `../../references/TOOL-GUIDE.md` — the roster, one experiment per call,
  partitioning, reserved aliases
- `../../references/LOCK-FAMILIES.md` — if the compared family is a lock
- `../../workbook/WORKBOOK-SPEC.md` — §2X blueprint
- `../../workbook/build_workbook.py` — builds the workbook from a JSON spec
