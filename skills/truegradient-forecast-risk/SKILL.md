---
name: truegradient-forecast-risk
description: Rank which products, SKUs, variants, categories, brands, channels or regions carry the most forecast risk in TrueGradient, combining the stored accuracy, bias, volume-contribution and trust_zone columns so that material items rank above trivial ones and systematic error is told apart from volatility. Use this for "which SKUs are highest risk", "where should planners focus", "what's most likely to be wrong next cycle", "top risk items by volume", "which categories need review", "is the forecast trustworthy for these items". Do NOT use to report a single entity's forecast value — use truegradient-forecast-lookup. Do NOT use for an overall accuracy or bias trend — use truegradient-forecast-accuracy.
---

# Forecast Risk Ranking

Tell a planner where to spend attention: items whose forecast has been unreliable
**and** that matter enough to be worth the effort.

## The core idea

**The workspace has already classified its own risk. Use that.**

`Final DA Data` normally carries `trust_zone` — TrueGradient's own risk band for
each item, computed against the thresholds that workspace configured. When that
column is present it **is** the risk classification, and it beats anything this
skill could invent, because it encodes business context the connector cannot read.
The same applies to `Risk_Locked_Lag_N_<date>` where a workspace has it.

Accuracy, bias and volume contribution are also stored (`overall_accuracy`,
`rolling_accuracy`, `<date> Accuracy`, `<date> Bias`,
`% Contribution Last 3 Months`). Read all of them. Recomputing a metric the
workspace already stores produces a second, slightly different number for the
same thing, and the planner then sees a figure that does not match the product.

So the order is:

```
1. trust_zone (or Risk_Locked_Lag_N_<date>)  →  WHICH items are risky
                                                the workspace's own answer,
                                                quoted with attribution

2. % Contribution Last 3 Months              →  WHICH of those matter
                                                orders items inside each zone

3. rolling_accuracy / overall_accuracy       →  HOW wrong they have been

4. <date> Bias                               →  WHETHER it is correctable
                                                systematic vs volatility
```

A ranked list is `trust_zone` grouped worst-first, and inside each zone ordered by
volume contribution, with stored accuracy and bias shown against every row. No
score of ours is needed for that, and none should be introduced.

**Only when no stored risk column exists** does this skill compute a ranking, from
the stored accuracy and contribution — `exposure` in step 9b. That is the fallback,
and it must be labelled as derived.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Accuracy you compute** uses the **global lock**,
   `<date> Locked ML Forecast Lag_N`, vs **`<date> Sales`** — always, not as a
   default. Secondary `Lock ...` and `Multi_Lock ...` families are never a metric
   basis. They share the same ` Lag_N` suffix, so anchor on the leading word plus
   a space (`"Locked "` vs `"Lock "`) — `contains "Lock"` matches both. Keep one
   lag, and name the family and lag. See `../../references/LOCK-FAMILIES.md`.
   **Accuracy you read** from a stored column (`rolling_accuracy`,
   `overall_accuracy`, `<date> Accuracy`) carries no family or lag token, so which
   lock produced it is not recoverable. Cite it as precomputed and do **not**
   attribute it to the global lock at a lag — this rule governs figures you
   compute, not figures the workspace stored.
3. **Never send** `wmape`, `accuracy`, `bias`, `mape`, `mae`, `rmse` or
   `sum_columns` as aggregation functions — broken in this connector. Use `sum`.
4. **Use the stored `trust_zone`; never compute one.** When the column exists,
   read it and quote it **with explicit attribution** — "the dataset's own
   `trust_zone` field records this item as X" — and use it as the primary risk
   classification. That is reporting stored workspace data.
   What stays forbidden is *assigning* a band yourself — inferring "Critical",
   "Low Trust", "Planner Review", "Review", "Trusted" or "Highly Trusted" from an
   accuracy number, or filling in a zone for an item that has none. The thresholds
   behind those labels are configured per workspace and **no tool can read them**,
   so an inferred label would be wrong for any workspace that tuned them.
   No `trust_zone` column → report raw accuracy percentages and volume shares, and
   say the workspace's own classification is not in this dataset.
5. Do not assert a generic trust bar ("below 70% is untrustworthy") as though it
   were this workspace's configured threshold.
5b. **Stored metric columns win.** When `overall_accuracy`, `rolling_accuracy`,
   `<date> Accuracy`, `<date> Bias` or `% Contribution Last 3 Months` exist, use
   them rather than recomputing from sums, and label each number stored or
   derived. Never present a derived figure next to a stored one without saying
   which is which.
5c. **Never average a stored percentage across rows.** `avg(overall_accuracy)`
   gives a 3-unit SKU the same weight as a 30,000-unit one. Roll a stored
   percentage up to a coarser grain by weighting on volume (step 8) — or compute
   from sums and say you did.
6. Exclude the current month; exclude months lacking either required column.
7. Items with fewer than 3 eligible months: list them **separately** as
   "insufficient history", not mixed into the ranking.
8. Never impute an accuracy from a group average and present it as an item's own.
9. End with the provenance footer.

Full detail: `../../references/SAFETY-CONTRACT.md`

## Procedure

**1–3. Identify, pick, discover.**
`tg_whoami` → `tg_list_experiments_for_analysis()` → `tg_resolve_datasets(experiment_ids=["<id>"])`.

**Do not filter the roster by `module="demand-planning"`.** Forecast data does not
only live in demand-planning experiments: in an IBP workspace every experiment is
`inventory-optimization`, and `Final DA Data` — Sales, the lock families, the
stored accuracy and bias columns — sits inside those. Filtering on
demand-planning there returns `count: 0` and the skill would report no data while
the data is present.

Call the roster **unfiltered** and pick by what the experiment actually holds.
If you do pass a module and get `count: 0`, read
`diagnostics.distinct_modules_seen` before concluding anything, and retry
unfiltered.

**4. Decide the ranking grain.**
Match what the user asked: SKU/variant level for planner worklists, category or
brand level for management review. If unstated, default to the coarsest grain the
question implies and offer to drill down. Ranking 50,000 SKUs is rarely useful —
ranking 12 categories usually is.

**Placeholder grain values.** If a grain column carries `UNKNOWN` (or `NA`,
`Unmapped`, `Other`, empty string), that is unmapped master data, not a real
group. Measured live, `Category = UNKNOWN` held 603 of 2,379 rows and **24.9% of
one month's absolute error** against a locked forecast of 56 units on 1,370 units
of actuals. Keep the volume in the total — it is real — but always break the group
out on its own line, named as unmapped master data, and say what it does to the
figure. Portfolio accuracy for that month read 16.0% with it and 19.6% without.
Folding a mapping gap into a model-accuracy number blames the forecast for
something it did not do. See `../../references/COLUMN-DISCOVERY.md` step 4e.

**5. Detect what the workspace already computed — before anything else.**

From the live column list, record which of these are present:

| Column | Gives you | If absent |
|---|---|---|
| `rolling_accuracy` | accuracy over the workspace's recent window | fall through to `overall_accuracy` |
| `overall_accuracy` | accuracy over all eligible months | compute per `METRICS.md` §2 |
| `<date> Accuracy` | accuracy per month — use for trend, not for one headline | derive from monthly sums |
| `<date> Bias` | direction of the error per month | compute per `METRICS.md` §3 |
| `% Contribution Last 3 Months` | volume share, fixed 3-month window | compute per `METRICS.md` §4 |
| `trust_zone` | the workspace's own trust band | **no substitute — never derive one** |
| `Risk_Locked_Lag_N_<date>` | a stored risk label, if this workspace has it | rank on the metrics below |

`overall_accuracy`, `rolling_accuracy`, `<date> Accuracy` and `<date> Bias` carry
**no family or lag token**, so which lock produced them is not recoverable from
the name. Quote them as precomputed and do not claim they are the global lock at a
particular lag — that pairing rule governs figures *you* compute (`LOCK-FAMILIES.md`).

**6. Build the eligible month set — only for what you must compute.**
If accuracy, bias and contribution are all stored, skip this: there is no month
window to build, and the window that applies is the workspace's own. Say that in
the answer instead of inventing one.

Otherwise, exactly as in `truegradient-forecast-accuracy` — parse dates, pair
`Sales` with the global lock at a single lag, drop the current month and any
unpaired month. Report the window, the family and the lag.

**7. Fetch — one batched, grouped call.**

*Stored path* — at the grain the columns live on, read them directly:

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "select_columns": ["Category", "SKU", "overall_accuracy", "rolling_accuracy",
                     "<date> Bias", "% Contribution Last 3 Months", "trust_zone",
                     "Imputation Flag"],
  "page_size": 1000
}
```

*Derived path* — only for the metrics that were not stored:

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "group_by": ["Category"],
  "aggregations": [
    {"function": "sum", "column": "2026-03-31 Sales",                        "alias": "a_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4",           "alias": "f_2026_03"},
    {"function": "sum", "column": "2026-03-31 Locked ML Forecast Lag_4 Abs Error", "alias": "e_2026_03"},
    {"function": "count",                                                    "alias": "n_rows"}
  ],
  "page_size": 1000
}
```

Repeat the a_/f_/e_ triple for every eligible month in the same call. If
`returned == page_size`, the result was truncated — say so.

**The stored path returns rows, so it paginates.** Stored metric columns live at
row grain and cannot be rolled up by the engine — `avg` would misweight them
(rule 5c) — so a group-level answer means reading the rows and weighting them
yourself. Use `has_more` / `next_page` and read to the end. If you stop early,
the ranking is built on part of the portfolio: say exactly how many rows of how
many you read, and do not present a partial read as a ranking. When the row count
makes a full read impractical, narrow with `filters` to the segment the user asked
about rather than truncating silently.

**8. Assemble the four inputs per item or group.**

```
accuracy(i)     = rolling_accuracy   if present          [stored]
                  else overall_accuracy                  [stored]
                  else (1 − Σ err_m / Σ act_m) × 100     [derived, METRICS.md §2]

bias(i)         = the stored <date> Bias over the window [stored]
                  else (Σ baseline / Σ actual) × 100     [derived, METRICS.md §3]

contribution(i) = % Contribution Last 3 Months           [stored, fixed 3-month window]
                  else |Σ act(i)| / Σ all |Σ act| × 100  [derived, METRICS.md §4]

zone(i)         = trust_zone                             [stored, quote only]
```

**Rolling a stored percentage up to a coarser grain.** Stored accuracy and bias
live at row grain. To report them per category, weight on volume — never `avg`:

```
accuracy(group) = Σ( accuracy(i) × contribution(i) ) / Σ contribution(i)
```

Say that you weighted, and on what. If contribution is not available to weight
with, compute the group figure from sums instead and label it derived — do not
fall back to a plain average.

**9. Rank — stored classification first.**

### 9a. When `trust_zone` (or `Risk_Locked_Lag_N_<date>`) exists — the normal case

The risk items are the ones the workspace's own column says they are. Do not score
them; group them.

```
Group by the stored zone, worst first, using the documented severity order:

  Critical  →  Low Trust  →  Planner Review  →  Review  →  Trusted  →  Highly Trusted

Inside each zone, order by contribution descending — the biggest items in the
worst zone are where a planner starts.

Show against every row: stored accuracy, stored bias, contribution.
```

`trust_zone` also carries **`"Not Available"`** in live data — observed on 34 items
holding 0% of volume. Treat it exactly like a blank: it is the workspace saying it
has not classified the item, so it goes in the unclassified list at step 10, never
into a zone and never into the ranking.

The severity **order** of these labels is documented; the **thresholds** behind
them are not readable. Ordering the workspace's own labels is not a threshold
judgement — assigning one to an item would be. If a label appears that is not in
the list above, do not guess where it sits: list it in its own group and say the
ordering is unknown for it.

Attribute the zone every time: "the dataset's own `trust_zone` field records
these as Critical". Never restate a stored zone as your own conclusion, and never
fill one in for an item whose `trust_zone` is null — those go in the unmeasurable
list at step 10.

**When the ranking grain is coarser than the zone — report the distribution.**
`trust_zone` is a per-row value. A category does not have *a* zone; its items have
many. Collapsing them into one label for the category would be assigning a zone,
which rule 4 forbids. Show the spread instead:

```
Per group, from the rows you read:
  count of items in each zone
  Σ contribution of the items in each zone      ← the number that matters

risk_volume(group) = Σ contribution of items in the worst zones
                     (Critical + Low Trust, or whichever the user asked about)

Rank groups by risk_volume descending.
```

That ordering is derived, but every input is stored: it is the workspace's own
classification weighted by the workspace's own volume column, with no threshold of
ours. Say that is what it is — "ranked by the share of volume the dataset's
`trust_zone` places in Critical or Low Trust".

A group with 3 Critical SKUs on 0.1% of volume and a group with 3 Critical SKUs on
22% of volume are not the same finding, and a single collapsed label would hide
exactly that difference.

### 9b. When no stored risk column exists — the fallback

Only here does this skill compute an ordering, from the stored accuracy and
contribution:

```
shortfall(i)  = 100 − accuracy(i)        # error in points; >100 if accuracy < 0
exposure(i)   = shortfall(i) × contribution(i) / 100
                # points of portfolio volume expected to be wrong. Sort desc.
```

Say explicitly that `exposure` is a ranking device defined by this skill, that it
is **derived**, and that this workspace stores no risk classification of its own.
Break ties on `bias_gap` descending.

### 9c. Bias qualifies every row, in both cases

**Both inputs must cover the same window.** `systematic` divides a bias figure by
an accuracy figure, so pairing a single month's `<date> Bias` with a multi-month
`rolling_accuracy` divides one window by another: the ratio then exceeds 1, or
sits below 0.3 for an item that is plainly biased, and means nothing either way.
Pair `rolling_accuracy` with the bias over that same set of months, or
`<date> Accuracy` with `<date> Bias` for the same month. If the windows cannot be
matched, report accuracy and bias as two separate numbers and omit the ratio —
say why rather than printing a figure whose denominator does not belong to its
numerator.

```
bias_gap(i)   = |bias(i) − 100|                 # points away from unbiased
systematic(i) = bias_gap(i) / shortfall(i)      # same window on both sides
                                                # undefined if shortfall = 0

systematic ≥ 0.6  → consistently high or low. A level correction recovers most of
                    the error. Name the direction: bias > 100 over-forecasting,
                    < 100 under-forecasting.
systematic ≤ 0.3  → volatility, not offset. A level correction will not help; this
                    needs a model or demand-driver review.
```

`bias_gap` is never *added* to `exposure`. Since `Σ|A−F| ≥ |ΣA − ΣF|`, bias error
is a subset of absolute error; adding them would count the systematic part twice
and inflate exactly the items that are easiest to fix. It belongs as a second
column, because it changes what the planner should *do* about a row, not where the
row sits.

### 9d. When the stored zone and the volume disagree, show both

A "Trusted" item carrying 30% of volume, and a "Critical" item carrying 0.2%, are
both worth saying out loud. Report the zone as the classification and the
contribution beside it — do not reorder the zones to match volume, and do not
quietly drop a low-volume Critical item.

If the user asks specifically for "least accurate", rank by stored accuracy
ascending instead and say that trivial items may appear high.

**10. Separate the unmeasurable.**
Two lists, both kept out of the ranking:
- items whose `trust_zone` is null, blank, or `"Not Available"` — the workspace has
  not classified them, and neither may you;
- items with no stored accuracy and fewer than 3 eligible months to compute one,
  with their month count.

Neither is low-risk. They are unknown-risk, which is a different thing worth
saying.

## Output shape

```
Nearly a third of portfolio volume sits in the two worst bands the dataset's
own trust_zone records. Snacks is where to start: 24.1% of total volume is in
Critical, more than every other category combined, and its error runs almost
entirely one way, so a level correction would recover most of it.

Where the dataset's own trust_zone puts each category's volume
  Ranked by the share of volume trust_zone places in Critical or Low Trust.
  Zones are the dataset's; the categories are not themselves classified.

  Group        Critical   Low Trust   Review   Trusted   Accuracy   Bias
  Snacks         24.1%        5.9%      1.2%      0.0%     18.4%    168.0
  Beverages       2.0%       18.4%      3.6%      0.0%     29.1%    103.2
  Dairy           0.0%        4.1%     12.9%      1.3%     51.7%     68.0
  Bakery          0.0%        0.0%      2.2%      6.9%     62.9%     97.1
  Frozen          0.0%        0.0%      0.9%      7.5%     71.2%     99.0
  Ambient         0.0%        0.0%      0.0%      6.2%     80.1%    101.5
  Ready Meals     2.4%        0.4%      0.0%      0.0%     22.0%    160.0

  Percentages are each group's share of total portfolio volume, so the table
  sums to 100% across all cells.

  Error character, from |bias-100| / (100-accuracy):
    Snacks       68.0/81.6 = 0.83  systematic, over-forecast
    Ready Meals  60.0/78.0 = 0.77  systematic, over-forecast
    Dairy        32.0/48.3 = 0.66  systematic, under-forecast
    Beverages     3.2/70.9 = 0.05  volatility
    Bakery        2.9/37.1 = 0.08  volatility
    Frozen        1.0/28.8 = 0.03  volatility
    Ambient       1.5/19.9 = 0.08  volatility
  Both figures come from the same stored window; see step 9c.

  Worth flagging both ways: Ready Meals has 2.8% of volume but nearly all of
  it Critical, so it is a real classification on a small base. Bakery's worst
  zone is Review at 62.9% accuracy while Dairy sits mostly in Review at
  51.7% — the workspace's thresholds account for something not visible in
  these columns.

Not classified — unknown risk, not low risk
  Chilled Juice     trust_zone is blank
  Seasonal Bundles  trust_zone is blank, 0 eligible months of history

What this is built from
  trust_zone    STORED — the classification itself, quoted as recorded, at the
                row grain it lives on. Categories are not assigned a zone;
                their volume is distributed across the zones their items carry.
                Zones ordered by documented severity; the thresholds behind
                them are configured in TrueGradient and are not readable here.
  volume share  STORED — % Contribution Last 3 Months (fixed 3-month window)
  accuracy      STORED — rolling_accuracy, volume-weighted to category grain
  bias          STORED — Bias over the same months as rolling_accuracy,
                volume-weighted to category grain (windows matched, step 9c)
  character     DERIVED = |bias − 100| / (100 − accuracy); ≥0.6 systematic,
                ≤0.3 volatility
  ranking      DERIVED ordering only — Σ volume in Critical + Low Trust per
                group, descending. Every input is stored; no threshold and no
                score of ours enters it.
  Rows read     4,812 of 4,812 (full read, not truncated)

What to consider
  Snacks and Beverages hold 50.4% of volume and 50.4 of the 53.2 points that
  sit in Critical or Low Trust, so reviewing those two addresses most of it —
  but they need different fixes. Snacks is 168 bias: consistently
  over-forecast by two thirds, and a level correction addresses it. Beverages is
  near-unbiased at 103 with a similar error scale, so its problem is
  volatility and a level shift will not help. Ready Meals is small but almost
  wholly Critical, which is a different question: whether it should be
  forecast this way at all.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data
  Basis:       trust_zone (stored classification), % Contribution Last 3
               Months, rolling_accuracy, 2026-07-31 Bias — all stored columns
  Grain:       Category (row-grain columns weighted by volume share)
  Caveats:     2 groups unclassified; contribution window is 3 months and may
               not match the stored accuracy window; categories carry no
               trust_zone of their own — the distribution is over their items
```

Note what this output does **not** contain: no zone assigned by us — only the
dataset's own, attributed — no invented risk score, and no claim about what
threshold makes something acceptable.

## Answering "is the forecast trustworthy?"

This is the most common phrasing and it needs care. Answer with:

1. the accuracy — the stored `rolling_accuracy` / `overall_accuracy` where the
   workspace has one, named as stored, otherwise the derived figure and its window,
2. the stored `trust_zone` if the column exists, quoted with attribution — it is
   the closest thing to an answer that exists, and it is the workspace's own,
3. the bias, so "wrong" is qualified as consistently high, consistently low, or
   just noisy,
4. how much volume it covers,
5. how many eligible months back it,
6. any imputation flags on contributing rows,
7. whether an interval exists on the forward forecast,
8. an explicit statement that what counts as acceptable accuracy is a workspace
   decision configured in TrueGradient, not something you can read.

Do not answer yes or no on your own authority.

## Boundaries

- a single forecast value → **truegradient-forecast-lookup**
- overall accuracy or bias trend → **truegradient-forecast-accuracy**
- comparing two forecast families → **truegradient-forecast-change**
- stockout risk, inventory cover, reorder, excess → **truegradient-supply-inventory**;
  that is inventory data, not forecast data

## References

- `../../references/LOCK-FAMILIES.md` — choosing the baseline lock family and lag
- `../../references/METRICS.md` — accuracy §2, bias §3, contribution §4, broken functions §0
- `../../references/SAFETY-CONTRACT.md` — §15 on trust labels
- `../../references/COLUMN-DISCOVERY.md` — detecting the stored metric columns
- `../../references/TOOL-GUIDE.md` — batching, truncation, errors
- `../../references/DATA-CONTRACT.md` — the AB-class rule for segment filters
