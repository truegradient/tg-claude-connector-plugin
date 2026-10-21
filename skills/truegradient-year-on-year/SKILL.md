---
name: truegradient-year-on-year
description: Compare TrueGradient demand with the same months a year earlier — actual sales against last year's sales, and any forecast family (operational, ML, consensus, the locked plan) against last year's sales — by month, year to date, last twelve months or full-year outlook, in units or value. Use this for "how are we doing versus last year", "YoY growth by category", "year to date versus last year", "what growth does the forecast imply", "is next year's plan realistic against what we sold". Pairs calendar months, holds out incomplete months, and reports growth as a ratio of sums with a like-for-like view. The last-year side is always actual sales, never last year's forecast or stock. When wanted as Excel or an export, it builds a multi-tab workbook (Read Me, Summary, detail and exception tabs) whose tabs are chosen from the question. Do NOT use for accuracy against actuals — use truegradient-forecast-accuracy. Do NOT use to compare two forecast families with each other — use truegradient-forecast-change.
---

# Year-on-Year Comparison

Put this year's demand next to the same months last year, and say exactly which
months, which columns and which items the comparison rests on.

Two different questions hide under "versus last year". Keep them apart:

| Question | This-year side | Reads as |
|---|---|---|
| **Actual growth** — "how are we doing versus last year" | `<date> Sales`, completed months only | a measured fact |
| **Plan versus last year** — "what growth does the forecast imply" | a named forecast family, future months | a statement about the **plan**, not about growth |

An actual-growth figure is evidence. A plan-versus-last-year figure is what the
plan *assumes*. Never let the second borrow the authority of the first.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Pair by calendar month, never by date arithmetic or by position.** Month `M`
   pairs with the column whose `YYYY-MM` is one year earlier. `2026-02-28` pairs
   with `2025-02-28`; `2025-02-28` pairs with `2024-02-29`. Never take "the
   twelfth column back" — families are ragged and a gap shifts every pair.
3. **The last-year side is an actual, from one basis per figure.** Default:
   `<M − 12 months> Sales` from the same dataset. `<M> LY Sales`, where it exists,
   is the alternative. Never mix the two inside one figure, and run the
   cross-check in step 4 before choosing.
4. **Keep incomplete months out of actual growth.** Two tests, both always run:
   the **current calendar month**, and the **month containing the experiment's
   `createdAt`**, because data loaded on the 23rd cannot hold a full month of
   sales even though the column is dated the 31st. Either month's `Sales` is
   month-to-date against a full month last year. Hold it out of the window, show
   it on its own line labelled "partial", and say why. (A forecast for such a
   month covers the whole month and may appear on the plan side, labelled.)
5. **Growth is a ratio of sums**: `(Σ this − Σ last) / |Σ last|`, over the
   same months on both sides. Never average monthly or item percentages, and
   never sum percentages.
5a. **Never use the stored `<M> YoY Perc Change` column for any figure.** It
   looks like the answer and is not. Verified live, row by row, it is
   `(<M> Locked ML Forecast Lag_1 − <M> LY Sales) / <M> LY Sales × 100`: the
   frozen **lock** against last year, not `Forecast`, and not actual sales. It is
   per row (so any `avg` or `sum` of it is meaningless), and it exists only on
   forecast months. If the user asks about it, say what it measures, and compute
   growth from sums with the family named.
6. **Name the forecast family on the plan side every time**, and the lag for a
   lock family. Several families may sit side by side against the same last-year
   base; never blend, average or add them.
7. Units (`Final DA Data`) and money (`Final DA Data Value`) never meet in one
   calculation. Value growth includes price and mix; say so when you give it.
8. **A missing column is not a zero.** A month whose this-year or last-year
   column is absent leaves the window, listed with its reason. `Σ last = 0` makes
   growth undefined — report the absolute change and say why, never a percentage.
9. Placeholder grain values (`UNKNOWN`, `NA`, blank) stay in the total and are
   broken out on their own line as unmapped master data.
10. Report the exact months on **both** sides and every month excluded.
11. End with the provenance footer. In a workbook, it lives on the Read Me tab and
    every tab's Source line.

Full detail: `../../references/METRICS.md` §9 and
`../../references/SAFETY-CONTRACT.md`.

## Procedure

**1–3. Identify, pick, discover.**
`tg_whoami` → `tg_list_experiments_for_analysis()` (unfiltered — forecast data
lives inside `inventory-optimization` experiments in IBP workspaces) →
`tg_resolve_datasets(experiment_id="<id>", tables=["Final DA Data"])`. Add
`"Final DA Data Value"` for money questions. Scope with `tables` and resolve one
experiment per call; an unscoped resolve of one wide experiment measured 72,557
characters and overflowed. If it still overflows, parse the saved file the error
names, or use `tg_dataset_info`.

Read the grain from the live list. Two experiments in one company shared no grain
column at all, so never assume `Category` exists.

**A segment the user names may be an experiment, not a grain value.** Observed
live: a business name the user gave matched an **experiment label**, not any
`Category` value. Match a named segment against experiment names
first, then against the distinct values of the live grain columns, and say which
one you matched. If it matches both, or neither, ask. Compare names trimmed and
case-insensitive: one live label was stored with a leading space.

**4. Build the month map — the step that decides everything.**

```
Parse every column with  ^(\d{4}-\d{2}-\d{2})\s+(.+)$   → (month, family)

Families you need:
  Sales                     the actual, both sides
  LY Sales                  optional alternative last-year basis
  YoY Perc Change           IGNORE for calculation: lock vs LY Sales, per row (rule 5a)
  <forecast family>         plan side only: Forecast (default), ML Forecast,
                            Consensus Forecast, Locked ML Forecast Lag_N, ...
                            classify locks by leading word, anchored on the space

Key every column by YYYY-MM (not by the full date: month-ends differ in leap years).

For each this-year month M:
  last-year column  = Sales at YYYY-MM of (M − 1 year)       → basis "Sales 12 months earlier"
  alternative       = LY Sales at M                          → basis "LY Sales"
```

**The basis cross-check — run it whenever both exist for at least one month.**
For each month where `<M> LY Sales` and `<M − 12> Sales` both exist, sum both in
one batched call and compare:

```
agree     |Σ LY Sales(M) − Σ Sales(M−12)| ≤ 0.5% of Σ Sales(M−12) in every checked month
          → use Sales 12 months earlier; say LY Sales agrees
disagree  → use Sales 12 months earlier (same definition as the this-year actual),
            and say LY Sales differs, by how much, in which months. Do not guess why.
```

Run the cross-check on the window's own months wherever both columns exist there.
Report exactly which months it covered. If none of them fall inside the window,
say "LY Sales was checked against Sales 12 months earlier in <months>, outside
this window; the window itself could not be checked". Never write "LY Sales
agrees" without naming the months.

Use `LY Sales` as the basis **only** when `Sales` 12 months earlier is absent for
the window and `LY Sales` covers all of it — then say the basis is `LY Sales`, a
stored column whose definition the connector cannot verify. Never switch basis
month by month inside one window.

**5. Choose the window.**

| User says | Window (completed months unless stated) |
|---|---|
| a month ("July") | that month vs the same month a year earlier |
| "year to date" | Jan → last completed month, calendar year — unless the user names a fiscal year start; use theirs and say so |
| "last 12 months", "rolling year", MAT | the 12 most recent completed months vs the 12 before |
| "this quarter", "Q2" | the quarter's completed months only; say if the quarter is incomplete |
| "next year", "the forecast period" | plan side: the forecast months asked for, vs the same months a year earlier |
| "full year outlook", "landing", "latest estimate" | completed months on `Sales` + remaining months on a named forecast family, vs the full prior year |

```
Drop a month from the window if:
  - it is the current calendar month                 (actual side; rule 4)
  - it contains the experiment's createdAt           (actual side; rule 4)
    createdAt is epoch milliseconds in the roster; convert it to a date first.
    Created on the 23rd of a month → that month's Sales column is partial
  - its this-year column is absent
  - its last-year column (on the chosen basis) is absent
Then: if the window lost months, say so and give the shortened window.
```

**Check data age.** If the last `Sales` month is earlier than the month before
today, the window ends there — say so, with the experiment's `createdAt`. Observed
live: `Sales` stopped two months before the current month.

**Stale data: anchor backward-looking words on the data, not on today.** When the last
`Sales` month is more than one month before the current month (observed live: an
experiment whose actuals ended 14 months before the question), resolve every
backward-looking word against the **data date**, meaning the last month with `Sales`, and
say so in the first sentence of the answer:

| User says | Resolves to | Say |
|---|---|---|
| "year to date", "this year" | Jan → the data date, in the data date's year | "actuals end Jul 2025, so year to date here is Jan–Jul 2025" |
| a named month ("February") whose this-year column has no `Sales` | the most recent such month with `Sales` on **both** sides, with its year | "the latest February with actuals is Feb 2025" |
| …and a forecast family covers the month asked for | also give plan versus last year for it (step 9), as a separate plan figure | "for Feb 2026 there is only the plan" |
| "last 12 months", "rolling year" | the 12 months ending at the data date | the data date |

That table is for **backward-looking** words only. **Forward-looking** words
("next quarter", "next 12 months", "next year") are about the calendar, so anchor
them on **today** whenever the forecast columns cover that period: on 21 Oct,
"next quarter" is Jan–Mar of the next year, even if actuals end in July. Fall back
to the data date only when the forecast does not reach the period. Then use the
forecast months straight after the last `Sales` month, and say "the plan horizon
ends <month>, so 'next quarter' here is <months>". Never silently move a forward
question onto an earlier period because actuals are stale.

Give the data age in months ("the newest actual is 14 months old"). Never present
an old window as current.

**A full-year outlook is a composition, and must say so**: "8 months of `Sales`
(Jan–Aug) + 4 months of `Forecast` (Sep–Dec)". The per-month source goes in the
answer. Composition of actuals with **one** forecast family is the standard
"latest estimate"; composition with two families is a blend and is not allowed.

**6. Fetch the sums — one batched call per dataset.**

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "group_by": ["<grain column from the live list>"],
  "aggregations": [
    {"function": "sum", "column": "2026-07-31 Sales",  "alias": "t_2026_07"},
    {"function": "sum", "column": "2025-07-31 Sales",  "alias": "l_2026_07"},
    {"function": "sum", "column": "2026-06-30 Sales",  "alias": "t_2026_06"},
    {"function": "sum", "column": "2025-06-30 Sales",  "alias": "l_2026_06"},
    {"function": "count", "alias": "n"}
  ],
  "page_size": 1000
}
```

Omit `group_by` for one total. Aliases are short and never a response field name
(`rows`, `columns`, `page`, `returned`… zero the whole result silently). Never use
`min`/`max` on numbers — they compare as text. If `returned == page_size`, the
result was truncated: say so, or partition with filters.

**7. Compute.**

```
Per group, over the window W (same months both sides):
  this  = Σ_{M∈W} Σ this-year column(M)
  last  = Σ_{M∈W} Σ last-year column(M)
  change    = this − last                          (units, or currency)
  growth %  = change / |last| × 100                if last ≠ 0
              undefined                            if last = 0  → "no sales a year earlier"
Per month: the same, one month at a time — the monthly trend.
Portfolio = the same formula on portfolio sums. Never an average of group growths.
```

Rank groups by **absolute change**, not by growth %: a 3-unit group growing to 9
is +200% and means nothing. Show the % beside it. Say which way you sorted.

**When placeholder rows drive the growth, give the figure without them too.**
Compute the placeholder rows' share of the change (`UNKNOWN`, `NA`, blank: see
`COLUMN-DISCOVERY.md` step 4e), even when the user asked for one total. If they
carry **more than a quarter of the absolute change**, put the growth excluding
them in the headline sentence, beside the total, labelled. Measured live:
`UNKNOWN` rows carried about two-thirds of the change, so total growth near +41%
was about +14% excluding them. The total stays the headline figure, because that volume is real.
The second figure stops a mapping change from being read as demand growth. Say
that rows moving into or out of `UNKNOWN` between years are a master-data effect
the connector cannot trace.

**7b. Single-row outliers — check before you publish a headline.**
One row can swing a whole year. Measured live: a single row held about 300x its
own value in the months either side, in one month. That was 55% of the
portfolio's total for that month, and it turned a +3.5% six-month growth into
−10.6% once the month was included.

```
Trigger: a window month whose portfolio total, on either side, is more than
         1.5x the median monthly total of that side of the window.
Check:   one call for that month:  sort_by [{"column": "<M> Sales",
         "direction": "desc"}], limit 3, select_columns [grain..., "<M> Sales",
         "<M-1> Sales", "<M+1> Sales"]   (sort_by, never max: max compares as text)
Flag:    a row holding at least 25% of that month's total AND at least 10x its
         own value in the neighbouring months.
```

When a row is flagged:
- **The headline keeps it.** The data says what it says.
- Also give a **sensitivity** with that row removed from **both** sides of the
  window, labelled "excluding one row".
- Describe the row by its grain values and its numbers (the month's value against
  its neighbouring months), and
  say it looks inconsistent with its own history and is worth checking at source.
  Never call it an error, and never give a reason for it.
- Seasonal peaks spread across many rows are not outliers. The 25% / 10x test
  is what separates them.

**8. Like-for-like — always offer it, compute it when asked or when it changes the
story.**

A total can grow because items were added, not because demand grew. The
like-for-like view keeps, **per month**, only rows that sold in both that month
and the same month a year earlier:

```json
{"filters": [{"column": "2026-07-31 Sales", "operator": ">", "value": 0},
             {"column": "2025-07-31 Sales", "operator": ">", "value": 0}],
 "group_by": ["<grain>"],
 "aggregations": [{"function": "sum", "column": "2026-07-31 Sales", "alias": "t"},
                  {"function": "sum", "column": "2025-07-31 Sales", "alias": "l"},
                  {"function": "count", "alias": "n"}]}
```

One call per month (the filters differ by month). Then:

```
non-comparable change = total change − like-for-like change
                        (items selling in only one of the two months: new, lost, gaps)
```

Say what the definition is in the answer: "rows with sales in both months". It is
row-level, so a SKU that moved site counts as lost at one and new at the other.

**Last year is only as complete as this experiment's item list.** The prior-year
side sums the rows *this* experiment carries. An item dropped from the item list
before the experiment ran contributes nothing to last year, which overstates
growth. The connector cannot see dropped items — state the limitation once.

**9. Plan versus last year (forecast side).**

```
plan growth % (family F) = (Σ F(M) − Σ Sales(M−12)) / |Σ Sales(M−12)| × 100
```

- Default family: `Forecast` (the operational plan). Other families only when
  named — `ML Forecast`, `Consensus Forecast` (detect first; absent in many
  workspaces; never substitute `Forecast` for it), the global lock.
- Several families: one column each, against the **same** last-year base, so the
  difference between them is visible. Never average them.
- A family's month is used only for months that have no `Sales` yet. For a month
  that already has `Sales`, the plan side for that month is not a forecast any
  more — use actual growth.
- **The interval.** Use `<M> Lower Bound` / `<M> Upper Bound` when they exist.
  Use `<M> P10` / `<M> P90` only when the bounds are absent. Pick one pair, name
  it, and never mix the two. Give the growth range the pair implies and say the
  band belongs to `ML Forecast` (`COLUMN-SEMANTICS.md`), so `Forecast` may sit
  outside it. If the plan total sits outside its own summed band, say so plainly
  (observed live: a plan month above its own summed Upper Bound). Summed
  bounds are a range of the total, wider than a properly combined interval. Say
  that too.
- **The realism check — the reason people ask.** Put the plan's implied growth
  next to the most recent actual growth on a comparable window (e.g. the last 6
  and 12 completed months). A plan implying +18% while actuals ran +3% is the
  finding. This comparison goes under *What to consider*: it is judgement, not a
  measured fact about next year.
  **Compare like with like, and name the basis.** Plan growth is a total over
  every row, so the first comparison is total actual growth on every row. The
  bases can differ a lot. Measured live on one experiment: a plan at about +40%
  sat against actual growth of about +42% total, +16% excluding unmapped master
  data, and +8% like-for-like. Each tells a different story, so:
  - lead with **total versus total**, both labelled "total";
  - when the excluding-placeholder or like-for-like actual growth differs from
    the total by more than 5 points, give it too, labelled with its basis, and
    say which one drives your judgement and why;
  - never set a total plan figure against a like-for-like or excluding-placeholder
    actual without saying the bases differ.

**10. Value questions.** Same procedure on `Final DA Data Value`. When both unit
and value growth were computed on the same window and items, you may give

```
implied average price/mix change = (1 + value growth) / (1 + unit growth) − 1
```

labelled derived, mix included. Never compute it across different windows.

**11. Quality flags.** If `Imputation Flag` exists, measure it with **one grouped
call**: `group_by ["Imputation Flag"]` with `count` and a `sum` of each window
column. This gives the flagged rows and their share of the window's volume on each
side. The flag is a text code (observed `"0"` and `"1"`), so never `sum` or `avg`
the flag column itself. Report the flagged share of **volume**, not only of rows,
when it is material. Break out placeholder grain values.
`AB_Class` and other attributes are **today's** classification applied to both
years — say so when grouping by them. "AB class" means A and B, not A.

## Output shape

```
Year to date, sales are up 7.9% on last year: 23,100 units against 21,400
(Jan–Jul 2026 vs Jan–Jul 2025, Sales on both sides).

What the data says
  This year:   2026-01-31 .. 2026-07-31 (7 months)   23,100 units
  Last year:   2025-01-31 .. 2025-07-31 (7 months)   21,400 units
  Held out:    2026-08 — current month, sales are month-to-date
  Basis:       Sales 12 months earlier; LY Sales agrees within 0.1% in all 7 months

What was calculated
  growth = (23,100 − 21,400) / 21,400 = +7.9%
  Like-for-like (rows with sales in both months): +4.2%
  So about half the growth came from items selling in only one of the two years.

By category (largest absolute change first)
  Food         +1,700   +8.0%
  Cosmetics      −350   −4.3%
  UNKNOWN        +350   — unmapped master data, kept in the total

What to consider
  The Forecast for Aug–Dec implies +14.6% on last year's Aug–Dec, about twice
  the +7.9% actuals have run year to date. Worth a review before it drives
  supply. This is a comparison of the plan with recent trend, not a forecast
  of the outcome.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data (units)
  Actual:      Sales, this year and 12 months earlier
  Forecast:    Forecast (operational), Aug–Dec 2026 — plan side only
  Period(s):   2026-01..2026-07 vs 2025-01..2025-07
  Caveats:     current month held out; last year counts only items in this
               experiment; 46% of rows carry an Imputation Flag
```

## Excel workbook output

Produce a workbook when the user asks for Excel, a spreadsheet, a file or an
export, and offer one (one line at the end) when the answer has more than about
20 groups or covers both actual and plan sides. A single total stays in chat.

Every rule above still applies, cell by cell. Every growth figure is a **live
ratio of sums**, so a filtered totals row is still that filter's true growth:

1. **Read Me**: the question; Source (experiment, dataset, the basis for last
   year and the cross-check result, the forecast family and lag on the plan side,
   pull date); the formula in words; both windows exactly; every excluded month
   with its reason; the like-for-like definition; the item-list limitation; the
   composition, month by month, for an outlook; provenance footer.
2. **Summary**: a `Month` block (the trend) and a `Group` block ranked by absolute
   change, each with `Growth` = `({This year}-{Last year})/{Last year}` as a
   ratio of the block's own sums.
3. **Main tab** `YoY by month`: one row per group × month in the window.
4. **Other tabs**: `Like-for-like`, `Plan vs last year`, `Excluded months`,
   `Unmapped master data` when a placeholder group exists.

| Question | Main tab | Other tabs |
|---|---|---|
| actual growth, any window | `YoY by month` | like-for-like · excluded months |
| plan versus last year | `Plan vs last year` | excluded months |
| full-year outlook | `YoY by month` with a `This-year source` column per row | plan vs last year · excluded months |
| several forecast families | `Plan vs last year`, one column pair per family | excluded months |

Blueprint Y, the column types and the spec format:
`../../workbook/WORKBOOK-SPEC.md` §2Y. Read it before building. Build with
`python <this-skill-dir>/../../workbook/build_workbook.py <spec.json> <out.xlsx>`,
recalculate, check that the Summary total's growth equals your computed headline,
and in chat give the headline with both windows and the largest caveat.

## Boundaries

- accuracy, bias or error against actuals → **truegradient-forecast-accuracy**
- two forecast families compared with each other (not with last year) →
  **truegradient-forecast-change**
- a forecast value for a period, with its interval → **truegradient-forecast-lookup**
- inventory, stock or reorder → **truegradient-supply-inventory**
- **"stock versus last year", "inventory up on last year"** → cannot be answered
  from TrueGradient data. `DOI Details` is today's snapshot and `Supply Plan`
  starts at the current period, so no dataset holds last year's stock position.
  Say so and offer sales versus last year (here) or today's cover (supply).
- **"this year's forecast versus last year's forecast"** → this skill compares
  against last year's **sales**, never against a forecast. Last year's planning
  cycle is a different experiment that is not available to read. Offer plan
  versus last year's sales (step 9). If the user means "how good was the forecast
  for last year's months", that is **truegradient-forecast-accuracy**.
- comparing two experiments or planning cycles → not supported; say prior-cycle
  experiments are not available to read
- pricing, markdown or promotion → out of scope, say so

## References

- `../../references/METRICS.md` — §9 year-on-year formulas, §0 broken functions
- `../../references/SAFETY-CONTRACT.md` — the hard rules
- `../../references/COLUMN-DISCOVERY.md` — discovery, empty columns, placeholder
  grain values, the AB-class rule
- `../../references/COLUMN-SEMANTICS.md` — which forecast family answers which
  question, whose interval the bounds are
- `../../references/LOCK-FAMILIES.md` — if the plan side is a lock family
- `../../references/TOOL-GUIDE.md` — batching, truncation, reserved aliases,
  text-compared `min`/`max`
- `../../references/DATA-CONTRACT.md` — wide shape, units versus value
- `../../workbook/WORKBOOK-SPEC.md` — §2Y workbook blueprints, column types,
  the builder's spec format
- `../../workbook/build_workbook.py` — builds the styled multi-tab workbook from a
  JSON spec
