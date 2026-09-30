# TrueGradient workbook: blueprints and spec format

Read this when any of the five skills answers with an Excel workbook (see
"Excel workbook output" in that skill's `SKILL.md`). It covers:

1. The fixed tab skeleton every workbook has
2. Blueprints: which tabs to build for which question, per skill
   (2S supply and inventory, 2L forecast lookup, 2A accuracy and bias,
   2R forecast risk, 2C forecast change)
3. Column conventions, suggested actions and check/flag rules
4. The JSON spec `build_workbook.py` reads
5. Build, verify, deliver

The reference output this is modelled on is a reorder list with five tabs:
Read Me → Summary → Reorder Sep-Nov → DOI says reorder, PO covers → Top sellers
not in TG. Every workbook follows that shape; the question decides the middle.

**The workbook does not relax any skill rule.** It is the same answer as the
chat shape, laid out as tabs: every non-negotiable rule of the skill that
produced it still applies, cell by cell. Where a blueprint below and a skill
rule seem to disagree, the skill rule wins.

---

## 1. Fixed skeleton

| Position | Tab | Always? | Contents |
|---|---|---|---|
| 1 | **Read Me** | yes | title; What this is (the question, in one sentence, with row and entity counts); Source (experiment label, id, created date, datasets, Variables and fields read, pull date); Scope rule in TG; Tabs; numbered caveats; Also excluded; Colour key; Blank vs 0 legend; provenance footer |
| 2 | **Summary** | when the main tab has ≥ 2 grouping columns or > 15 rows | formula-linked roll-up blocks over the main tab, one block per grouping (channel, action, category, month, zone…), ranked by money or volume |
| 3 | **Main tab** | yes | one row per entity (SKU × site/channel, or group × month for accuracy) answering the question, action and flag columns included |
| 4+ | **Exception tabs** | when the data has them | where TG's two views disagree (two datasets, or a forecast and its own interval); entities excluded by scope; what cannot be measured or classified; entities TG cannot see (only with a cross-check source) |

The Read Me is where the skill's own answer contract lives in the file:
"What this is" is the decision, "Source" and the provenance footer are the
footer, the caveats are the gaps and quality flags, and the colour key explains
every fill. An exception tab with no rows is still worth including when the
check was expected to find something; the builder writes the `empty_note`
("No rows: the two views agree"), which is a finding.

## 2. Blueprints

Pick the row that matches the question. If the question spans two, merge them:
one main tab per question, shared Read Me and Summary.

## 2S. Supply and inventory (`truegradient-supply-inventory`)

### A. Reorder plan for a window ("what should we reorder Sep–Nov", "reorder list")
- **Main tab** `Reorder <window>`: every entity with `Reorder Plan` > 0 in any
  period of the window (Supply Plan). Columns: grain columns; one `Reorder <mon>`
  per period; `Reorder <window>` = SUM formula; unit cost; `Reorder value ($)` =
  formula; `TG Reorder Date`, `TG Reorder now` (DOI Details); stock on hand, in
  transit, open PO (only if present); projected stock-out date; one `TG forecast
  <mon>` per period plus the period after the window; `lead_time`; Suggested
  action; Check / flag.
- **Summary**: by channel/site, by suggested action, by category/collection.
- **Exceptions**: `DOI says reorder, plan doesn't` (`TG Reorder now` > 0, no
  `Reorder Plan` in window, usually open POs netted); `Plan says reorder, DOI
  doesn't` (the reverse); excluded rows (phasing out, unknown lifecycle) with
  their units.
- Say in Read Me that `Reorder Plan` and `Reorder Received` are the same order
  at two moments, and state the lead time and when the window's orders land.

### B. Reorder now ("what should I order today")
- **Main tab** `Reorder now`: `TG Reorder now` > 0 (or `updated_TG_Reorder_now`
  if present), ranked by value. Columns: grain, `TG Reorder now`, unit cost,
  value formula, `TG Reorder Date`, `lead_time`, SOH, in transit, open PO,
  `Current_OOS_Date`, `Days on Inventory`, `TG Safety Stock Days`, cover gap
  formula, stored `Stock_Risk_Level`, first period `Reorder Received` lands
  (Supply Plan), flag.
- **Summary**: by stored `Stock_Risk_Level`, by category, by site.
- **Exceptions**: `Supply Plan schedules later` (Reorder now > 0 but the plan's
  first `Reorder Plan` is in a later period).

### C. Stockout risk ("which SKUs will stock out", "when do we run out")
- **Main tab** `Stockout risk`: `Potential_Sales_Loss` > 0 or a
  `Current_OOS_Date` inside the horizon, ranked by `Potential_Sales_Loss_value`.
  Columns: grain, `Current_OOS_Date`, `OOS_Episode_Details` (verbatim),
  `Total_Projected_OOS_Days`, loss units, loss value, SOH, `Days on Inventory`,
  `TG Safety Stock Days`, `TG Reorder now`, `lead_time`, stored
  `Stock_Risk_Level`, flag.
- **Time-phased tab** `End Inventory by month` for the same entities (one
  Variable only).
- **Summary**: by stored `Stock_Risk_Level`, by category; share of loss value.
- **Exceptions**: `Out before any receipt`: `Current_OOS_Date` falls before the
  first period with `Reorder Received` or `Total Inbounds` > 0 (both stored).
  Never compute an OOS date or an arrival date yourself.

### D. Excess and working capital ("where is my excess", "am I over-invested")
- **Main tab** `Excess stock`: `Excess_Stock_value` > 0 ranked by value.
  Columns: grain, SOH, `soh_value`, `Excess_Stock`, `Excess_Stock_value`, dead
  stock and its value (if present), `Days on Inventory`, `Sales Per Day`,
  stored `Stock_Risk_Level`, flag.
- **Summary**: by category, by site/channel; share of excess value; add a
  "Excess share of capital" row labelled as calculated.
- **Exceptions**: `Excess and stockout, same SKU`: one site/channel in excess
  while another is at risk: a transfer prompt, labelled as calculated, never as
  planned transfers (the `Stock Transfer` dataset is usually empty).

### E. Inventory over time ("month on month", "how does inventory evolve")
- **One tab per Variable**: `End Inventory by month`, `Forecast by month`,
  `Reorder Plan by month`, `Days On Inventory by month`… Rows are entities,
  columns are the bare-date period columns. Never put two Variables in one
  grid, never a Variable column that mixes units and days.
- Units tabs get SUBTOTAL(9) totals; days tabs get SUBTOTAL(1) averages (the
  builder does this from the column type).
- **Summary**: one block per Variable grouped by category, each titled with its
  unit.
- Name the first period as current and partial in its header
  (`2026-09-30 (partial)`) and in Read Me.
- **Exceptions**: `Hits zero` (entities whose `End Inventory` reaches 0 in the
  horizon, with the first such period).

### F. One entity deep dive ("show me SKU X across sites")
- **Main tab** `<SKU> plan`: rows = Variables, columns = periods, units
  Variables first, then a gap row, then days and rate Variables. Build it as two
  tabs (`<SKU> units`, `<SKU> days`) if a single grid would mix units in a
  total. No Summary tab.

### Anything else
Use the same skeleton: the main tab answers the question at entity grain, the
Summary rolls it up by money, exception tabs hold what the two datasets or an
outside source disagree on. If a blueprint needs a field that is absent from the
live column list, drop the column and add a caveat naming the field, never a
column of zeros.

## 2L. Forecast lookup (`truegradient-forecast-lookup`)

A workbook when the lookup covers many entities or many periods ("forecast for
every SKU in Snacks for Q4", "actuals vs forecast by region, last 6 months").
One entity and one period stays in chat.

Units (`Final DA Data`) and money (`Final DA Data Value`) never share a tab. If
both were asked for, build one tab of each, never a sum or ratio across them.

### G. Many entities, one or a few periods
- **Main tab** `Forecast <window>`: one row per entity × period, from filtered,
  projected reads. Columns: grain columns; `Period` (date); the forecast family
  with its name in the header (`Forecast ("2026-09-30 Forecast")` in the Source
  line, `Forecast` as the header); `Lower Bound`, `Upper Bound` (or the `P` quantile
  columns that exist); `ML Forecast` only when bounds exist, because the
  interval belongs to it; the actual for past periods (`Sales`); `Forecast vs
  actual (%)` = `=IF({Sales}=0,"",({Forecast}-{Sales})/{Sales})`, type
  `pct_signed`; `Imputation Flag` if present; Check / flag.
- **`"totals": false` on this tab.** Its rows span several periods, and a
  forecast is never totalled across periods unless the user asked for a total.
- **Summary**: a `Period` block (each period's totals of forecast, bounds,
  actual), plus a block per grouping the user named (category, region, channel).
  A grouping block sums across the periods on the tab, so build it only when
  the tab holds **one** period, or the user asked for a window total, and then
  title it "total over <window>". Put in the Summary subtitle that summed bounds
  are a range of the total, wider than a properly combined interval.
- **Exceptions**: `Outside model interval`: rows where the forecast is below its
  Lower or above its Upper Bound, with `ML Forecast` beside it. That is a
  finding (usually a planner edit pushed the plan off the model's range), so
  include the tab even when empty. Also `No value for period`: entities whose
  forecast is null for a requested period, listed as not in the data, never as
  zero. Add `Imputed rows` when `Imputation Flag` marks rows the answer rests on.
- **Check / flag**: `Forecast above the model's Upper Bound (ML Forecast
  inside)`; `Forecast at the Upper Bound`; `No interval for this period`;
  `Imputed`. Plain `OK:` otherwise.

### H. One family month by month ("forecast by month for these SKUs")
- **One tab per family**, as in blueprint E: `Forecast by month`, `Sales by
  month`, `Lower Bound by month`… Rows are entities, columns are periods. Never
  two families in one grid. Totals per period column are fine (same period,
  many entities). Keep the interval check on a blueprint G tab alongside.

Read Me must name the forecast family (and the lag, for a lock family), say
whose interval the bounds are, carry the archived-fallback caveat first if the
roster used it, and list entities that were not found with the values offered.

## 2A. Accuracy and bias (`truegradient-forecast-accuracy`)

Every figure is on the global lock (`<date> Locked ML Forecast Lag_N`) against
`<date> Sales`, one lag, eligible months only. The workbook is laid out so that
every pooled figure is a **live ratio of sums**: accuracy is recomputed from
the error and actual columns wherever it appears, never averaged.

### I. Accuracy, bias, trend, worst groups
- **Main tab** `Accuracy data`: one row per group × **eligible** month (group
  = the grain asked for; one "All" group for a portfolio figure). Columns:
  - `Group` (and a parent grain if useful), `Month` (date)
  - `Actual` = Σ `<date> Sales` (units)
  - `Baseline` = Σ `<date> Locked ML Forecast Lag_N` (units)
  - `Abs Error column` = Σ `<date> Locked ML Forecast Lag_N Abs Error`, same
    family and lag (units; `null` when that month has no such column)
  - `Error used` = `=IF(N({Abs Error column})>0,{Abs Error column},ABS({Actual}-{Baseline}))`
    (units). This is the skill's numerator rule as a formula: the row-level
    column when it exists and sums above 0, otherwise the netted fallback
  - `Accuracy` = `=IF({Actual}=0,"",1-{Error used}/{Actual})`, type `pct`,
    `"total": "formula"`. The totals row is then pooled accuracy for the whole
    window (`1 − Σerr/Σact`), and it follows any filter, because the totals are
    `SUBTOTAL`s
  - `Bias` = `=IF({Actual}=0,"",({Baseline}-{Actual})/{Actual})`, type
    `pct_signed`, `"total": "formula"`. Signed scale, 0 = unbiased
  - Check / flag: `Netted fallback numerator: reads slightly better than row
    level`; `Unmapped master data (UNKNOWN): kept in the total`; `Sold nothing:
    accuracy undefined`
- **Only eligible months go on this tab.** The current month, and any month
  lacking `Sales` or the lock column, never do, so no total can pool them.
- **Summary** (source `Accuracy data`):
  - a `Month` block, the trend: `values` `Actual`, `Baseline`, `Error used`;
    `ratios` `Accuracy` `=1-{Error used}/{Actual}` (`pct`) and `Bias`
    `=({Baseline}-{Actual})/{Actual}` (`pct_signed`); `order` = months ascending
  - a `Group` block, the same values and ratios, `order` = your computed
    accuracy **ascending** (worst first), with a block `note` saying so. The
    placeholder group stays in as its own line, so the block total is the true
    portfolio, not a portfolio without its mapping gap
- **`Current month (partial)`** tab: the current month on its own, never on
  the main tab. The stored `<date> Accuracy` / `<date> Bias` (types `pct100`,
  `pct100_signed`, header marked `(stored)`), or the month-to-date computation
  with the caveat that actuals are to date against a full-month forecast, or a
  row saying it is not measurable. No totals.
- **`Excluded months`** tab: `Month`, `Reason` (current month / no Sales /
  no <lock family> column). Always present, because the window is part of the
  answer.
- **`Earlier vs later`** tab, for "which groups are worsening": per group,
  `Actual (earlier)`, `Error (earlier)`, `Accuracy (earlier)` (formula),
  `Actual (later)`, `Error (later)`, `Accuracy (later)` (formula),
  `Change (points)` = `=IF(OR({Accuracy (earlier)}="",{Accuracy (later)}=""),"",{Accuracy (later)}-{Accuracy (earlier)})`
  (`pct_signed`). Both windows go in the Source line. Rows ordered by change
  ascending (worsening first).
- **Stored figures** (`overall_accuracy`, `rolling_accuracy`): a Read Me row
  headed `Stored (precomputed)`, quoted as the workspace's own numbers, saying
  their window is not readable and they are not expected to match. Never a
  bare `avg` of them in any cell.
- **Consensus question**: add `Consensus` and `Consensus error used` columns,
  and a `Consensus accuracy` formula beside the lock's. Say in Read Me that
  consensus is not a frozen baseline.

Read Me carries the formula in words (`Accuracy = (1 − WMAPE) × 100, WMAPE =
Σ|actual − forecast| / Σ|actual|`), the family and lag, the exact window, every
excluded month and why, the numerator basis, that accuracy can be negative
(error above actuals), and "not yet meaningful" when fewer than 3 months are
eligible. Asked for MAPE, MAE or RMSE: say they cannot be recovered from sums.

## 2R. Forecast risk (`truegradient-forecast-risk`)

The workspace's stored `trust_zone` is the classification. The workbook
arranges it and never adds one. Zones are quoted in the stored spelling. A
`fill_map` on the zone column only colours the dataset's own label, and the
colour key says so.

### J. Group grain ("which categories need review"), the preferred path
Read with `group_by [<grain>, "trust_zone"]` and `count`,
`sum("% Contribution Last 3 Months")`, `avg("overall_accuracy")` (the avg is
within one grain × zone cell only; see the skill's step 7).
- **Main tab** `Zone cells`: one row per real group × zone. Columns: `Group`,
  `trust_zone (stored)`, `Items` (`int`, `"total": "sum"`), `Volume share`
  (`pct100`, stored Σ contribution, `"total": "sum"`), `Accuracy in cell`
  (`pct100`, stored, no total), `Acc × share` = `={Accuracy in cell}*{Volume share}`
  (`rate`, `"total": "sum"`; a weight, not a percentage, and deliberately not
  divided by 100, so `Σ(Acc × share) / Σ share` lands back on the 0–100 scale),
  `In worst zones` =
  `=IF(OR({trust_zone (stored)}="Critical",{trust_zone (stored)}="Low Trust"),{Volume share},0)`
  (`pct100`, `"total": "sum"`), Check / flag. Rows ordered by group rank, then
  zone in severity order.
- **Summary** (source `Zone cells`):
  - a `Group` block: `values` `Items`, `Volume share`, `Acc × share`,
    `In worst zones`, with `"agg"` `"sum"` for `Volume share` and
    `In worst zones`;
    `ratios` `Weighted accuracy` `={Acc × share}/{Volume share}` (`pct100`),
    labelled volume-weighted approximation in the block note; `order` = groups
    by `In worst zones` descending (the ranking: "share of volume the dataset's
    trust_zone places in Critical or Low Trust")
  - a `trust_zone (stored)` block, `order` = `Critical, Low Trust, Planner
    Review, Review, Trusted, Highly Trusted`; a label outside that list gets its
    own line at the end, with the note that its place in the order is unknown
- **With bias on a matched window**, add `Bias in cell` (`pct100_signed`) and
  `Bias × share` = `={Bias in cell}*{Volume share}` (`rate`, `"total": "sum"`),
  a `Weighted bias` ratio `={Bias × share}/{Volume share}` (`pct100_signed`),
  and an `Error character` ratio
  `=ABS({Bias × share}/{Volume share})/(100-{Acc × share}/{Volume share})`
  (`rate`). Above 1 means the origin is wrong: stop and recheck rather than
  deliver. Windows not matched: no bias ratio and no character, and a caveat.
- **`Unmapped master data`** tab, placed **before** `Zone cells` in the spec:
  the placeholder group's (UNKNOWN, NA, blank…) cells, kept out of the ranked
  tab. Read Me states its volume share and what it does to portfolio accuracy.
- **`Not classified`** tab: items or cells whose `trust_zone` is blank or
  `Not Available`. They are unknown risk, not low risk.

### K. Item grain ("which SKUs are highest risk"), a planner worklist
- **Main tab** `Risk items`: grain columns, `trust_zone (stored)`,
  `Volume share` (`pct100`, `"total": "sum"`), `Accuracy (stored)`
  (`rolling_accuracy`, else `overall_accuracy`; `pct100`, no total),
  `Bias (stored)` (`<date> Bias`; `pct100_signed`, no total), `Acc × share`
  helper as in J, `Error character` =
  `=IF({Accuracy (stored)}>=100,"",ABS({Bias (stored)})/(100-{Accuracy (stored)}))`
  (`rate`, only when the windows match), `Imputation Flag`, Check / flag
  (`Systematic over-forecast: a level correction recovers most of it`;
  `Volatility: a level shift will not help`). Ordered by zone severity, then
  volume share descending.
- The read is a computed read: at most 1,000 rows, no pagination. Partition by
  filters. Read Me states rows covered of rows in the dataset, and a partial
  read is labelled partial on the tab's Source line.
- **Summary**: a `trust_zone (stored)` block in severity order with
  `Volume share` (agg sum), `Acc × share` (agg sum) and a `Weighted accuracy`
  ratio; a block per parent grain if one was read.
- **Exceptions**: `Not classified`; `Insufficient history` (null stored
  accuracy, the stored proxy, said to be a proxy).

### L. No `trust_zone` in the dataset, the fallback
Main tab as K without the zone column, plus `Exposure (derived)` =
`=(100-{Accuracy (stored)})*{Volume share}/100` (`pct100`, `"total": "sum"`),
rows ordered by exposure descending. Read Me says `Exposure` is a ranking
device this skill defines, that it is derived, and that the workspace stores no
risk classification of its own.

Read Me carries: what each column is (stored or derived), that the thresholds
behind the zones are configured in TrueGradient and not readable, the
contribution window (3 months) against the accuracy window, and rows read.

## 2C. Forecast change (`truegradient-forecast-change`)

Two column families, one experiment, the **same target month**. Never two
months, never two experiments, never units against value.

### M. What changed between version A and version B
- **Main tab** `Change <month>` (one tab per target month; several months
  means several tabs, never one grid): one row per entity present in **both**
  versions. Columns: grain columns; `A: <family>` and `B: <family>` (units, the
  family and lag spelled out in the header); `Change` = `={B: …}-{A: …}`
  (`delta`); `Change %` = `=IF({A: …}=0,"",({B: …}-{A: …})/ABS({A: …}))`
  (`pct_signed`, `"total": "formula"`, so the totals row is the change % of the
  totals); `Planner comment (verbatim)` only when `SnOP Comments` actually holds
  text; Check / flag. Rows ordered by `|Change|` descending, not by percentage.
- A row missing from either version never goes on this tab: a blank in a
  subtraction reads as 0 and invents a change.
- **Summary**: a block per grouping (category, brand, channel): `values`
  `A: …`, `B: …`, `Change`; `ratios` `Change %` `={Change}/ABS({A: …})`
  (`pct_signed`). Blank where A sums to 0.
- **Exceptions**: `Only in version B` (new, with its B value, "no A value,
  not zero"), `Only in version A` (dropped), each included even when empty.
- **Check / flag**: `A is 0: change % undefined`; `Model and table-edited
  families differ by N here: a manual adjustment, reason not recorded`; the
  quoted planner comment's presence.

Read Me, first caveat, always: TrueGradient records no forecast version
history, edit authorship or reason codes, so these changes are measured
exactly but not explained, beyond any planner comment quoted. Say whether
`SnOP Comments` exists and whether it holds any text. If the user asked about
a prior cycle, say those experiments are not available to read. A comparison
of two lags of one lock family is titled a horizon comparison, not a change.

## 3. Column conventions

**Order**: grain and descriptors first (channel/site, action, category, SKU,
colour, size), then the answer (quantities per period, total, value), then the
policy and stock context, then forecast context, then external cross-check,
then lead time, then Check / flag last.

**Headers**: plain words, with the TG field in quotes where the name differs
from the field (`TG "reorder now"`), and units in the header (`Reorder value
($)`, `Lead time (days)`). Period headers use the month (`Reorder Sep`) with
the full bare date in the Source line.

**Types** (the builder formats and totals from these):

| type | use for | total |
|---|---|---|
| `units` | quantities: reorder, SOH, forecast, loss units | sum |
| `money` | values: reorder value, `soh_value`, loss value | sum |
| `money2` | per-unit price or cost | none |
| `days` | DOI, safety stock days, OOS days, lead time | average, never sum |
| `rate` | `Sales Per Day`, `Forecast_Per_Day` | none unless `"total": "sum"` (a genuine portfolio-per-day figure) |
| `pct` | shares, margin, computed accuracy (a fraction: 0.342 shows 34.2%) | none, or `"formula"` |
| `pct_signed` | change %, computed signed bias (a fraction, shown `+8.4%`) | none, or `"formula"` |
| `pct100` | a percentage TG **stores** on a 0–100 scale: `overall_accuracy`, `rolling_accuracy`, `<date> Accuracy`, `% Contribution Last 3 Months` | none, `"sum"` for shares of one whole |
| `pct100_signed` | TG's stored signed `<date> Bias` (−48.78 shows `-48.8%`, 0 = unbiased) | none |
| `delta` | a change in units, new − old (shown `+34,200`) | sum |
| `date` | reorder date, OOS date, forecast month (ISO in, real date out) | none |
| `text` | everything else | none |

**Percentages are never averaged, and summed only when they are shares of one
whole.** The builder refuses `"avg"` on any percent type, and refuses a percent
value in a Summary block unless it carries `"agg": "sum"`. A pooled percentage
is a ratio of totals: on a detail tab, give the column its formula and
`"total": "formula"`, and the totals row re-evaluates that formula on the total
cells. In a Summary block, put it in `ratios`. `pct` and `pct100` differ by a
factor of 100. Never mix them in one formula without converting, and never put
a stored `pct100_signed` bias beside a computed `pct_signed` one as though
they were the same scale.

**Forecast tabs** name the family (and lag) of every forecast column, in the
header or the tab's Source line, and mark each figure `(stored)` or
`(derived)` wherever both kinds sit on one tab. A placeholder grain value
(`UNKNOWN`, `NA`, `Unmapped`, blank) is flagged on its row as unmapped master
data, never merged into a real group.

**Formulas**, not pasted results, for every figure you derive: window totals
(`=SUM({Reorder Sep}:{Reorder Nov})`), values (`={Reorder Sep–Nov}*{Unit
COGS ($)}`), cover gap (`={Days on Inventory}-{TG Safety Stock Days}`),
share of total. Quantities read from TG are stored values.

**Unit cost**: use the cost column in the live list (`Cost`, `COGS`, or in one
Bearaby workspace `AVG COGS`), name it in the footnote, and never derive one.

**Suggested action** (optional column): your recommendation, not TG data. Keep
the labels to a short fixed set, give each a fill, and state the rule that
assigns them in a footnote and in Read Me. The reference set:

| Label | Fill | Rule (example) |
|---|---|---|
| Factory reorder | orange | channel that holds the stock and has a `Reorder Plan` |
| Factory reorder (other stock cannot cover) | orange | the source location's projected inventory is below this row's need |
| Transfer possible to <mon>; short in <mon+1> | yellow | source covers the window but its projection goes short after |
| Transfer from <location> stock | green | source location's projected `End Inventory` covers the whole window |

Never reuse `Stock_Risk_Level` values as action labels, and never call an
action column a risk band.

**Check / flag** (last column): semicolon-joined plain-language checks; start
with `OK:` when nothing needs checking (no fill), otherwise the builder fills
the cell yellow. Useful checks, each from stored data:
- open PO or in transit already covers the reorder (`Already has 400 on open
  PO / 0 in transit`);
- peak-driven: window forecast ÷ recent monthly run-rate ≥ 5× (state the
  multiple);
- location holds 0 stock in every period, so the whole forecast becomes a
  reorder;
- lead time lands the order after the peak it appears to serve;
- a cross-check source disagrees with TG's history (only with that source).

**Blank vs 0**: pass `null` for a value that is not in the data and `0` for a
modelled zero; the Read Me legend explains it. A measure absent from the live
`Variable` set or column list gets no column at all, and a caveat.

**Size**: up to about 300 rows per tab is comfortable to pass through a spec.
Above that, keep the top rows by value, and say in Read Me and the tab's
Source line how many rows exist and what share of the total value the kept
rows carry.

**Cross-check sources** (e.g. Shopify sales, a WMS): only when that connector
is available in the conversation. Label every such column with its source
(`Shopify DTC sales last 90d`), describe the match rule (suffix stripping,
excluded variants) in Read Me, and put "TG cannot see these" lists on their
own tab.

## 4. Spec format

```json
{
  "readme": {
    "title": "TrueGradient reorder list, Sep / Oct / Nov 2026",
    "rows": [
      ["What this is", "Every SKU × channel row where the Supply Plan has a Reorder Plan above zero in Sep–Nov 2026: 82 rows across 56 SKUs."],
      ["Source", "TrueGradient experiment <label> (inventory-optimization, id <id>, created <date>). Datasets: Supply Plan (Variable = Reorder Plan, Forecast, End Inventory), DOI Details. Pulled <date>."],
      ["Scope rule in TG", "..."]
    ],
    "caveats": [["lead time", "Every flagged SKU carries a 120-day lead time ..."]],
    "excluded": ["DOI flags reorder now on 74 Phasing Out rows (1,387 units) ..."],
    "colour_key": {"orange": "factory reorder", "yellow": "transfer covers the window but the source runs short after it", "green": "transfer from 3PL stock"}
  },
  "summary": {
    "title": "Reorders flagged by TrueGradient, Sep–Nov 2026: summary",
    "description": "totals by channel, suggested action and collection.",
    "source_tab": "Reorder Sep-Nov",
    "blocks": [
      {"group_by": "Channel", "count_label": "SKU × channel rows",
       "values": ["Reorder Sep", "Reorder Oct", "Reorder Nov", "Reorder Sep–Nov", "Reorder value ($)"],
       "order": ["Shopify", "Amazon", "Retail"], "share_of": "Reorder value ($)"},
      {"group_by": "Suggested action", "values": ["Reorder Sep–Nov", "Reorder value ($)"]},
      {"group_by": "Collection", "values": ["Reorder Sep–Nov", "Reorder value ($)"], "rank_by": "Reorder Sep"}
    ]
  },
  "tabs": [
    {
      "name": "Reorder Sep-Nov",
      "title": "TrueGradient reorder plan, Sep–Nov 2026 (every SKU × channel with a reorder > 0)",
      "source": "Source: TrueGradient experiment <label> (id <id>, created <date>), dataset \"Supply Plan\", Variable = \"Reorder Plan\"; stock position from \"DOI Details\". Pulled <date>.",
      "description": "the full list with stock position, forecast and checks.",
      "freeze_cols": 4,
      "columns": [
        {"header": "Channel"},
        {"header": "Suggested action", "fill_map": {"Factory reorder": "orange", "Transfer from 3PL stock": "green"}},
        {"header": "Collection"},
        {"header": "SKU", "key": "sku"},
        {"header": "Reorder Sep", "key": "rp_2026_09_30", "type": "units"},
        {"header": "Reorder Oct", "key": "rp_2026_10_31", "type": "units"},
        {"header": "Reorder Nov", "key": "rp_2026_11_30", "type": "units"},
        {"header": "Reorder Sep–Nov", "type": "units", "formula": "=SUM({Reorder Sep}:{Reorder Nov})"},
        {"header": "Unit COGS ($)", "key": "cogs", "type": "money2"},
        {"header": "Reorder value ($)", "type": "money", "formula": "={Reorder Sep–Nov}*{Unit COGS ($)}"},
        {"header": "Projected stock-out date", "key": "oos", "type": "date"},
        {"header": "Lead time (days)", "key": "lead_time", "type": "days", "total": false},
        {"header": "Check / flag", "key": "flag", "flag": true}
      ],
      "rows": [
        {"Channel": "Shopify", "Suggested action": "Factory reorder", "Collection": "Lounger", "sku": "HBMG28",
         "rp_2026_09_30": 129, "rp_2026_10_31": 126, "rp_2026_11_30": 120,
         "cogs": 12.98, "oos": "2026-11-30", "lead_time": 120,
         "flag": "Already has 400 on open PO / 0 in transit"}
      ],
      "footnotes": ["Unit COGS = DOI Details \"<cost column>\". Reorder value = Sep–Nov units × unit COGS. Suggested action rule: ..."]
    },
    {
      "name": "DOI says reorder, PO covers",
      "title": "SKUs where DOI Details says reorder now but the Supply Plan has no Sep–Nov reorder",
      "source": "The two TG views disagree: ...",
      "description": "rows where the two TG views disagree.",
      "columns": [{"header": "SKU"}, {"header": "TG \"reorder now\"", "type": "units"}],
      "rows": [],
      "empty_note": "No rows: the two views agree for every active SKU."
    }
  ],
  "provenance": {
    "Company": "<company_name>", "Experiment": "<label> (<id>), Completed, created <createdAt>",
    "Module": "inventory-optimization", "Dataset(s)": "Supply Plan (units, monthly); DOI Details (snapshot)",
    "Period(s)": "2026-09-30 .. 2026-11-30 (2026-09-30 is the current, partial month)"
  }
}
```

Key points:
- `key` defaults to `header`; rows are dicts keyed by `key`. A row key with no
  column is an error, so typos surface.
- Formula placeholders `{Header}` resolve to that column on the same row. The
  referenced columns must be adjacent for a range like `{A}:{B}`.
- `fill_map` values are palette names (`orange`, `yellow`, `green`, `red`,
  `blue`, `grey`) or hex.
- `total`: omit for the type default, `false` to suppress, `"sum"` / `"avg"` to
  override (`"sum"` on a days column is refused, and so is `"avg"` on a percent
  column). `"formula"` re-evaluates the column's own formula on the totals row,
  for a ratio of totals: `{"header": "Accuracy", "type": "pct", "formula":
  "=IF({Actual}=0,\"\",1-{Error used}/{Actual})", "total": "formula"}`. Every
  column it refers to must itself have a summed total.
- Summary `ratios`: pooled figures computed from the block's own cells, on
  every group row and the Total row, blank where the denominator is 0:
  `"ratios": [{"header": "Accuracy", "type": "pct", "formula": "=1-{Error used}/{Actual}"}]`.
  Placeholders name the block's `values`, which must be summed, not averaged.
- `readme.blank_vs_zero` replaces the default Blank vs 0 legend when a skill
  needs different wording.
- Summary blocks: `values` may include formula columns. `order` fixes the row
  order; otherwise rows rank by `rank_by` or the first stored units/money
  value, then by row count. `share_of` adds a share-of-total column. Days
  columns become `AVERAGEIFS` and are labelled `(avg)`; their total is the
  overall mean, not a mean of means.
- Tab names: ≤ 31 characters, none of `[]:*?/\`, unique.
- The Tabs row, the Colour key row (from `colour_key`), the Blank vs 0 legend
  and the Provenance row are added automatically unless you supply your own.

## 5. Build, verify, deliver

The builder lives at the plugin root, `workbook/build_workbook.py`, which is
`<skill-dir>/../../workbook/build_workbook.py` from any skill. It needs
`openpyxl` (`pip install openpyxl` if the import fails).

1. Write the spec to `/home/claude/<name>_spec.json` (create_file), or to a
   scratch directory where that path does not exist.
2. `python <skill-dir>/../../workbook/build_workbook.py spec.json /mnt/user-data/outputs/<Company>_TG_<Topic>_<Window>.xlsx`
   (outside Claude.ai, write to the working directory). A `spec error:` exit
   names the rule a spec broke. Fix the spec, never the rule.
3. Recalculate and check for errors with the xlsx skill's `recalc.py`; do not
   deliver while it reports `errors_found`. Where that skill is not available,
   say in chat that the formulas were not recalculated before delivery.
4. Spot-check two or three totals against the numbers you read from the
   connector (a clean recalc proves formulas evaluate, not that they are right).
5. Present the file, and in chat give the decision in two or three sentences
   plus the headline totals and the biggest caveat. Do not paste the tables.
