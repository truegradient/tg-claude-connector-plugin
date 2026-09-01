# Changelog

## 1.0.0 — 2026-09-01

First release from this repository, and the first with a tagged git history.

The plugin existed before this point as a series of uploaded archives; that
iteration is kept below under **Pre-repository history** for the reasoning it
records, but those numbers were never tagged and no code for them lives here.
Versioning starts fresh at 1.0.0.

This release corrects the accuracy formula, makes the risk skill read the metrics
the workspace already stores rather than recomputing them, drops cross-cycle
comparison — which depended on data the live roster usually does not carry — and
adds first-class handling for `Consensus Forecast`.

### Removed

- **`truegradient-forecast-change` Mode B — same family across two experiments.**
  The roster only exposes the workspace's live Completed experiments, so the
  prior-cycle experiment the mode needed is normally absent; the skill offered a
  comparison it could not actually run. Every comparison is now between two column
  families inside a single experiment. When a user asks to compare cycles, the
  skill says prior-cycle experiments are not available to read and offers the
  nearest family comparison instead — usually the global lock against the current
  `Forecast`, which is what moved since the baseline was taken.
- The multi-id fetch note in `TOOL-GUIDE.md` no longer advertises cross-cycle
  comparison; `tg_resolve_datasets` still accepts several ids, but the skills work
  one experiment at a time.
- `METRICS.md` §5 no longer offers "the same family across two experiments" as a
  way to name the two versions.

### Added

- **`truegradient-forecast-risk` reads the stored metrics instead of rebuilding
  them.** `Final DA Data` already carries `overall_accuracy`, `rolling_accuracy`,
  `<date> Accuracy`, `<date> Bias`, `% Contribution Last 3 Months` and
  `trust_zone`, computed by TrueGradient against the workspace's own
  configuration. The skill treated them as an optional afterthought at step 6 and
  otherwise recomputed accuracy from `Sales` and lock sums — producing a second,
  slightly different number for the same thing that would not match the product.
  Detecting them is now step 5, ahead of everything else, and the eligible-month
  window is built only for metrics the workspace did not store. Every figure is
  labelled STORED or DERIVED in the output.
- **Rolling a stored percentage up to a coarser grain is now specified.** Stored
  accuracy and bias live at row grain; `avg` across rows would weight a 3-unit SKU
  like a 30,000-unit one. The skill weights on volume share
  (`Σ(accuracy × contribution) / Σ contribution`) or computes from sums and says
  so — never a plain average. Stated in `DATA-CONTRACT.md` §5.6 too.
- **All four metrics now combine into the ranking.** `exposure =
  (100 − accuracy) × contribution / 100` remains the sort, in points of portfolio
  volume expected to be wrong, with ties broken on bias. Bias is deliberately
  **not** added to it: since `Σ|A−F| ≥ |ΣA − ΣF|`, bias error is a subset of
  absolute error and adding them double-counts the systematic part, inflating
  exactly the items that are easiest to fix. It earns its place as a second
  dimension instead — `|bias − 100| / (100 − accuracy)` separates systematic error
  (≥0.6; a level correction recovers most of it, and the direction is named) from
  volatility (≤0.3; a level shift will not help). That distinction changes what a
  planner should actually do about an item.
- **`trust_zone` is now the risk classification, not a decoration.** The skill led
  with `risk = low accuracy × volume contribution` and kept the workspace's own
  stored zone as a side note. That is backwards: `trust_zone` is TrueGradient's
  answer to the exact question the skill is asked, computed against thresholds
  this workspace configured, and it encodes business context the connector cannot
  read. A ranked list is now the stored zones grouped worst-first — using the
  documented severity order `Critical → Low Trust → Planner Review → Review →
  Trusted → Highly Trusted` — ordered inside each zone by the stored
  `% Contribution Last 3 Months`, with stored accuracy and bias shown per row. No
  score of ours is involved. `Risk_Locked_Lag_N_<date>` is used the same way where
  a workspace has it.
- **The computed `exposure` ranking is now the fallback only** (step 9b), for
  workspaces with no stored risk column, and is labelled derived when used.
- `SAFETY-CONTRACT.md` §15 is unchanged and still binding: ordering the
  workspace's own labels is not a threshold judgement, but *assigning* a band —
  inferring one from an accuracy number, or filling one in for an item whose
  `trust_zone` is null — remains forbidden. Unclassified items go in an
  explicit "unknown risk, not low risk" list. An unrecognised label is grouped
  on its own with its ordering declared unknown rather than guessed.
- **A coarse-grain risk ranking reports the `trust_zone` distribution, not one
  collapsed label.** `trust_zone` is a per-row value: a category does not have *a*
  zone, its items have many, and picking one for the category would be assigning a
  zone. Groups now show how much of their volume sits in each zone, and are ranked
  by the volume in the worst zones — the workspace's own classification weighted
  by the workspace's own contribution column, no threshold of ours. Three Critical
  SKUs on 0.1% of volume and three on 22% are not the same finding, and a single
  label hid that.
- **The stored path paginates, and says so.** Stored metric columns are row-grain
  and cannot be rolled up by the engine, so a group answer means reading the rows
  and weighting them. The skill now reads to the end via `has_more` / `next_page`,
  reports rows read of rows total, and narrows with `filters` rather than
  truncating — a partial read is never presented as a ranking.
- `<date> Accuracy` and `<date> Bias` are now listed in `DATA-CONTRACT.md` §5.6
  and `COLUMN-DISCOVERY.md`'s detection table, with the note that none of the
  stored metric columns carries a family or lag token.
- **`METRICS.md` §1a — consensus forecast questions.** Eligible-month discovery
  now records `<date> Consensus Forecast` alongside the actual, the lock baseline
  and the abs-error column. It is recorded, not promoted: the global lock remains
  the basis for every accuracy and bias figure, and consensus becomes the forecast
  side only when the user explicitly asks about consensus.
- When a consensus question is asked, the same formulas and the same
  month-eligibility rules apply with the consensus column in the lock column's
  place. Four disclosures are mandatory: consensus is not frozen so the figure is
  not a baseline measurement; the family is named in the answer and the footer;
  the global-lock figure is shown alongside when a `Locked ...` family exists; and
  the figure is never presented as the workspace's forecast accuracy. There is no
  consensus `Abs Error` column, so the netted numerator is always used and always
  disclosed.
- `truegradient-forecast-lookup` now names `<date> Consensus Forecast` as the
  family for a consensus value question, and says the workspace records none when
  the column is absent rather than answering with `Forecast`.
- `COLUMN-DISCOVERY.md`'s optional-column table now carries a `Consensus Forecast`
  row.

### Fixed after live testing against a real workspace

All five skills were run end to end against a live connector (company `demo`,
2,379-row `Final DA Data`, 419 columns). Six defects surfaced that no amount of
reading the docs would have caught.

- **The roster filter returned nothing.** All four forecast skills called
  `tg_list_experiments_for_analysis(module="demand-planning")`. In an IBP
  workspace every experiment is labelled `inventory-optimization` and
  `Final DA Data` lives inside those, so the filter returned `count: 0` with
  `distinct_modules_seen: {"inventory-optimization": 18}` — the skills would have
  reported no data while 419 columns of it sat there. The roster is now called
  unfiltered and routing is by the datasets an experiment resolves.
- **`min` and `max` are lexicographic on the stored metric columns.** They come
  back as strings. Observed on `overall_accuracy` within the Critical zone: `min`
  gave `"-1.59"` and `max` gave `"9.3"` while `avg` gave `-13.21`, which is
  numerically impossible — `"-1.59" < "-133.33"` as text. `TOOL-GUIDE.md` now
  warns that `min`/`max` cannot be used to find a best or worst stored figure.
- **A forecast can sit outside its own interval.** Observed a SKU with
  `2026-09-30 Forecast` of 101 against Lower/Upper Bound of 38–70, because the
  bounds are the model's while `Forecast` was identical to
  `Table Edited Forecast` for every row. The lookup skill now checks containment
  and, when the point falls outside, prints both and says the interval is the
  model's and does not cover the operational plan — never widening or clipping it.
- **`trust_zone` carries `"Not Available"`**, a value not in the documented
  severity list, on 34 items. Treated as unclassified, like a blank.
- **The current month may have no dated `Sales` column at all.** `Sales` ran to
  2026-07-31 with nothing for the current month or the one before; month-to-date
  lived in the non-dated `current_month_sales_tilldate`. The accuracy skill now
  looks there, and reports the actual without an accuracy figure when no forecast
  column exists for that month — plus flags data age when actuals stop months back.
- **`DATA-CONTRACT.md` §5.7 was inverted.** It listed `Risk_*`, `SKU Code` and
  `Site ID` as "documented but often absent"; all three are present live. What is
  actually absent there is `Consensus Forecast`, every secondary `Lock ...` and
  `Multi_Lock ...` family, and `Forecast Abs Error`. The section now records both
  lists, that the lag was `Lag_1` and not the `Lag_4` of the examples, and that
  the lock extended 12 months past the last actual — so the measurable window is
  the intersection, 10 months of 24.

### Fixed on a fourth pass — pagination, and a defect this plugin introduced

- **`page` is ignored in computed mode, and `has_more` lies there.** Any of
  `filters`, `group_by`, `aggregations`, `sort_by`, `select_columns`, `limit` or
  `distinct` puts the call in `"mode": "analytics"`, where `page` has no effect.
  Measured on the same 2,379-row dataset: `select_columns:["SKU Code"]` with
  `page_size:3` returned the **identical three rows** at `page: 1` and at
  `page: 500`, both reporting `has_more: true` with an incrementing `next_page`;
  and `page_size:1000, page:3` returned 1,000 rows rather than the 379 that page 3
  of 2,379 holds. `total_rows` is `null` there, so nothing bounds a loop.

  This matters because **the previous commit told the risk skill to "use
  `has_more` / `next_page` and read to the end" on the stored path — which uses
  `select_columns`.** Following that would re-read the first page forever and, if
  the pages were accumulated, count the same rows two or three times into a
  volume-weighted figure. Plausible, wrong, no error. That guidance was introduced
  here and is now removed.

  A **plain read** (no computed arguments, `"mode": "rows"`) does paginate
  correctly — page 1 returned Item23/Item60 and page 900 returned Item105/Item158
  — but returns every column, which is the wide read the skills forbid.

  `TOOL-GUIDE.md` gains rule 3b with the measured table. The risk skill now
  prefers `group_by [<grain>, "trust_zone"]` with `count` / `sum(contribution)` /
  `avg(accuracy)` — one row per group, no pagination, nothing to double count —
  and falls back to partitioning with `filters` so each slice lands under
  `page_size`, verifying `returned < page_size` per slice. Confirmed working: that
  grouped call returned 12 rows with `has_more: false`, and surfaced that
  `UNKNOWN` × `Critical` alone is 568 items and 19.95% of portfolio volume.

  The skill also now states the tension it cannot escape: `avg` on a stored
  percentage misweights (rule 5c) and a full row read is unavailable, so a
  group-level stored accuracy is either volume-weighted from per-group `avg` and
  `sum(contribution)` — an approximation, labelled as one — or computed from `sum`
  aggregations and labelled derived. The three routes gave 1.47%, 13.87% and
  26.38% on the same data, so naming which was used is not optional.

### Added

- `.claude-plugin/marketplace.json`, so the repo is installable with
  `/plugin marketplace add truegradient/tg-claude-connector-plugin` followed by
  `/plugin install truegradient-forecast-plugin@truegradient`. `plugin.json` alone
  is not enough for a git-installable repo. Independently validated here:
  `claude plugin validate .` passes, and the marketplace entry's plugin name
  matches `plugin.json`. Two consequences worth knowing: the repo is **private**,
  so every installer needs access to the `truegradient` org, and `plugin.json`'s
  `version` is what drives update detection — it must be bumped on every release
  or existing installs are never offered the new build.

### Fixed on a third pass — the last untested surfaces

Testing `Final DA Data Value`, the full `Variable` vocabulary, `SnOP Comments` and
the `UNKNOWN` grain value found five more, plus two slips of my own caught in a
self-audit.

- **A placeholder grain value carried a quarter of the error.** `Category` =
  `UNKNOWN` on **603 of 2,379 rows** — the largest single group, 25% of the
  portfolio, with `Product Name` and `Brand name` also `UNKNOWN`. Unmapped master
  data, and it has real sales: on 2026-07-31 it held 1,370 of 6,364 units of
  actuals and **1,332 of 5,346 units of absolute error** against a locked forecast
  of 56 units. Portfolio accuracy that month reads 16.0% with it and 19.6%
  without. The plugin had no rule for this. It now keeps the volume in the total —
  it is real — but always breaks the group out on its own line as unmapped master
  data and states its effect, because folding a mapping gap into a model-accuracy
  figure blames the forecast for something it did not do. `COLUMN-DISCOVERY.md`
  step 4e, with pointers from the accuracy and risk skills.
- **`Forecast Per Day` is a rate, and days measures must never be summed across
  entities.** The contract said "nine measures are units, three are days", which
  did not match its own table and left the rate unclassified. It is eight units,
  three days, one rate. And the existing rule only forbade totalling *across*
  `Variable` values — summing *within* a days measure was untouched, so
  `sum("2026-09-30")` filtered to `Days On Inventory` returned **387,054** across
  2,379 entities. Arithmetically fine, meaningless. Confirmed the fix: `avg`
  returns 124–202 days of cover per category.
- **The `Variable` vocabulary is eleven here, not twelve.** `Open Purchase Orders`
  was absent, with `In Transit` and `Total Inbounds` both 0. All twelve stay
  documented as the union across workspaces, with an absent measure to be read as
  unmodelled rather than zero.
- **`SnOP Comments` is present and null on every row.** `is_not_null` returned 0
  rows across all 2,379. The change skill's only evidence path for "why" has no
  data here, so it now says no planner comment is recorded rather than implying
  the evidence was weighed. Generalised in `COLUMN-DISCOVERY.md` step 4d together
  with `current_month_sales_tilldate` and the empty `Stock Transfer`: presence and
  population are two separate checks, and an empty filtered read comes back as
  `returned: 0` with `columns: []`.
- **`Final DA Data Value` uses the identical column vocabulary** — same
  `<date> Sales`, same lock family, same `Abs Error`. Only the dataset name
  separates units from money, so the query succeeds and the number is plausible
  either way. New `DATA-CONTRACT.md` §5.8 requires naming the dataset in the
  footer, and records that accuracy differs by basis: on 2026-07-31 Cosmetics had
  value abs error (8,073) exceeding value actuals (7,959) — negative accuracy in
  money for a group whose unit accuracy was positive.
- Two of my own: `DATA-CONTRACT.md` §5.8 was written as an `h2` among `h3`
  siblings, and the supply skill still referred to "the twelve `Variable`
  measures" after the count was corrected. Both fixed.

Confirmed on both experiments: the `trust_zone` distribution pattern holds in
Retail too (`Not Available` present again, 6 items at 0% volume), and
`% Contribution Last 3 Months` summed to 100.00% there as well.

### Fixed on a second live pass — the untested surfaces

The first pass only exercised one experiment. Testing the second one, plus the
datasets skipped earlier, found seven more defects.

- **The lag token is not always present, and demanding it silently disables the
  plugin.** One experiment carried `Locked ML Forecast Lag_1`; the other, in the
  same company, carried a bare `Locked ML Forecast` with `Locked ML Forecast Abs
  Error` and no lag token in any column. `LOCK-FAMILIES.md` §8 already allowed
  the bare form, but three skills asserted that *all* lock families share the
  ` Lag_N` suffix and the accuracy skill made naming the lag a non-negotiable —
  so a skill would have reported "no lock family exists, no accuracy can be
  measured" against a perfectly good frozen baseline. Accuracy computes correctly
  on the bare form; verified. The absolute claims are now conditional, and a
  missing lag token is reported as "lag not recorded in the column name" rather
  than blocking the answer.
- **The grain vocabulary is per-experiment, and the two shared none.** CPG had
  `SKU Code`, `Site ID`, `Site Name`, `Category`, `Sub-category`, `Brand name`,
  `channel`. Retail had `Store Num`, `Product Type`, `Subtype`, `Brand`,
  `Style Group Name`. `Lifestage` was the only descriptive column in common.
  Every example in this plugin writes `group_by: ["Category"]`, which fails with a
  binder error in Retail. `COLUMN-DISCOVERY.md` gains step 4b with the measured
  comparison and the rule to read grain per experiment.
- **Month windows are per-experiment too — these were a full year apart.** CPG
  `Sales` ran 2024-08-31 → 2026-07-31 with `Forecast` from 2026-08-31; Retail ran
  2023-08-31 → 2025-07-31 with `Forecast` from 2025-08-31. A date that resolves in
  one is `COLUMN_NOT_FOUND` in the other. New step 4c. The binder error's
  `Candidate bindings` list is named as the thing to read instead of guessing again.
- **`Stock Transfer` resolves successfully and is empty.** `resolved: true`, 0
  columns, null sample row in both experiments; `tg_dataset_info` on it returns
  `502 download_failed — "CSV file contains only whitespace"`. Zero columns now
  means unavailable: do not probe, do not read. Critically, the supply skill is
  now told never to convert that into "no stock transfers are planned" — an empty
  file is a fact about the file, not about the plan, and reporting a zero transfer
  value from an unproduced dataset is a fabricated finding.
- **Error bodies leak the storage path.** That 502 came back carrying
  `accounts/demo_<company-id>/data_bucket/inventory-optimization/.../stock_transfer_df.csv`.
  The tool contract promises paths are never exposed; failures breach it. Skills
  must report the failure in words and drop the path, bucket and company id.
- **The supply skill's own example used columns that do not exist.** Rule 7 said
  to prefer the post-transfer variants and the `DOI Details` example requested
  `Final_Potential_Sales_Loss` and `updated_Excess_Stock`. Neither experiment had
  a single `updated_*` or `Final_*` column — coherent, since `Stock Transfer` was
  empty in both, so nothing produced a post-transfer number. The example now uses
  the base columns, verified working (Retail: StockOut 105 SKUs, $312.5K sales
  loss), with the swap documented as conditional on the live column list.
  `SUPPLY-DATA-CONTRACT.md` §8 now says to detect before defaulting, and not to
  read an absent column as a modelled zero.
- The supply skill's `module="inventory-optimization"` filter now falls back to an
  unfiltered roster on `count: 0`, the mirror of the demand-planning fix.

Every fix in this section was re-run against live data before commit. `Supply
Plan`'s long shape, its `Variable` filter and its bare-date month columns all
behaved exactly as `SUPPLY-DATA-CONTRACT.md` describes.

### Corrected on retest

The fixes above were re-run against the live workspace. Two of them were wrong.

- **`current_month_sales_tilldate` is a placeholder here, and the first fix would
  have published a zero as fact.** The column is present and non-null on all 2,379
  rows and sums to **exactly 0**. The guidance said to use it as the month-to-date
  actual; it now requires summing the column first and, when the total is 0,
  saying the current month is not measurable rather than reporting the zero. The
  same caution is noted for `Current Month Sales till Date` in `DOI Details`.
- **The `min`/`max` warning was scoped far too narrowly.** It was written as a
  quirk of the stored metric columns. It affects **every numeric column, `Sales`
  included**: `max("2026-07-31 Sales")` returned `"9.0"` on a column that sums to
  6,364 and whose individual rows reach 41, and `min(overall_accuracy)` returned
  `"-1.59"` when `sort_by` proves the true minimum is **−750.0**. Both answers
  look plausible and neither errors. `TOOL-GUIDE.md` now carries the measured
  comparison table and names the verified alternatives — `sort_by` plus `limit`
  for extremes, `sum`/`avg` for aggregates, both confirmed numeric on the same
  data.

One fix was confirmed and strengthened: every `ML Forecast` on 12 sampled rows sat
inside its Lower/Upper Bound, while `Forecast` sat exactly **at** the Upper Bound
on 5 of them and above it on 2 — an edited plan pinned to or past the model's
ceiling, which the lookup skill now says out loud.

### Confirmed correct by the same testing

- **Negative accuracy is real, not hypothetical.** The workspace's own stored
  `overall_accuracy` averages **−13.21** across the Critical zone — 1,622 of 2,379
  items, 47.2% of volume — and `rolling_accuracy` averages **−37.85**. Under the
  old `min(100, …)` floor those would all have read 0 or been dropped. This is the
  clearest vindication of the formula correction above.
- **The row-level `Abs Error` numerator matters enormously.** Over the 10 eligible
  months: WMAPE 47,693 / 64,781 = 73.62%, accuracy **26.38%**. The netted fallback
  `|Σactual − Σforecast|` gives 14,149 and would have reported **78.16%** — a
  51.78-point overstatement. The preference for the stored abs-error column, and
  the requirement to disclose the fallback, are both load-bearing.
- **The no-plain-average rule is worth 12 points.** Simple `avg()` of the stored
  accuracy gives 1.47%; volume-weighted gives 13.87%.
- **`% Contribution Last 3 Months` summed to exactly 100.00%**, so it can be used
  directly as volume share.
- Supply routing worked: `Stock_Risk_Level` split into ExcessStock (1,510 SKUs,
  $152.2K excess), Stable (382), LowInventory (314, $7.7K sales loss), StockOut
  (126, $16.9K), CriticalStock (47, $12.8K) — matching `SUPPLY-DATA-CONTRACT.md`.

### Repo

- `scripts/verify-plugin.sh` — pre-push checks that fail on the things that break
  silently: version drift between `plugin.json`, `README.md` and the newest
  CHANGELOG heading; a skill description over the 1,024-character limit that stops
  the plugin loading; a `name:` that no longer matches its directory; a dangling
  `../../references/*.md` link; and regressions of the rules above — a returned
  `min(100, …)` cap, an accuracy described as floored at 0, an example sending a
  broken aggregation function, or a reinstated Mode B.
- `.gitignore` excludes `.claude/settings.local.json`. That file disables the
  `truegradient` MCP server; committed, it would silently break the connector for
  everyone who cloned the repo. Also excludes `*.zip`, since the packaged plugin
  is a release asset rather than a tracked file.
- `LICENSE` added, matching the `UNLICENSED` field in the manifest.
- `README.md` gains a **Releasing** section: the three places a version must
  agree, what patch / minor / major mean for a plugin made of prompts, and the
  tag-and-verify sequence.
- Removed a stray empty `plan` file from the repo root.
- `TEST-CHECKLIST.md` extended from 49 to 55 tests for the behaviour above: T12a
  partial current month, T12b negative accuracy not clamped, T12c no month skipped,
  T12d consensus answered on consensus and never as a fallback, T17 zone-first
  ranking with a no-stored-column variant, T17a stored metrics read not rebuilt,
  T23a cross-cycle comparison declined. T12's stale "use of the current month" fail
  condition and T18's treatment of `trust_zone` as merely tolerable were corrected.

### Fixed

- **Accuracy is `(1 − WMAPE) × 100` and can be negative.** The formula was written
  as `min(100, ...)` and described as "capped at 100 and floored at 0", which is
  wrong in both directions. `1 − WMAPE` cannot exceed 1, so the cap never bound
  anything and only hid bad inputs; the floor erased the real case where total
  absolute error exceeds total actuals. A group with WMAPE of 1.384 now reports
  `−38.40`, with the reading spelled out in words, instead of being clamped to 0
  and read as merely poor. A figure above 100 is now treated as an input error to
  report, not a number to cap. Corrected in `METRICS.md` §2 and §7, both skills
  that compute it, `TOOL-GUIDE.md` and the README.
- **No month is skipped in the accuracy sums any more.** Eligibility dropped any
  month where `Σbaseline <= 0` or `Σactual <= 0`. Both drops deleted the largest
  errors and inflated every figure: a month forecast at zero that sold 5,000
  units is a 100% miss, and a month forecast at 5,000 that sold nothing puts
  5,000 into the numerator against no offsetting volume — the exact case that
  should produce a negative accuracy. Pooled WMAPE sums numerator and denominator
  across the whole window, so dropping a month drops its error with it. The only
  undefined case left is `Σact == 0` across the entire window, meaning nothing
  sold at all, and that reports as not computable rather than as 0.
- **`METRICS.md` §7 now states the textbook definitions** of WMAPE, MAPE, MAE and
  RMSE and says plainly that WMAPE and MAPE do not convert into each other — MAPE
  weights rows equally, WMAPE weights units. MAPE, MAE and RMSE are row-level
  averages that the batched `sum` aggregations have already collapsed, so they
  cannot be computed from them; the skills now say so instead of relabelling a
  WMAPE figure. The old claim that the engine's `wmape` and `mape` are
  "higher-is-better in this system" is removed — those functions are unusable
  (§0) and their semantics were never verifiable, so the rule is now to draw no
  conclusions from them at all.

### Changed

- `SAFETY-CONTRACT.md` and `LOCK-FAMILIES.md` state the consensus carve-out
  explicitly, so "never measure against `Consensus Forecast`" is not read as
  forbidding the consensus question itself. The prohibition that matters is
  unchanged and now stated as such: consensus is **never** a fallback for a
  missing lock. If no `Locked ...` family exists, the answer is still that no
  accuracy can be measured.

## Pre-repository history

These entries predate this repository. They are kept for the reasoning they
record — why calculations run on the global lock, why the engine's accuracy
aggregations are unusable, why a skill description over 1,024 characters stops
the plugin loading. The version numbers below were never tagged, and the 1.0.0
above is not a re-release of the 1.0.0 named here.

### 1.2.2 — 2026-08-31  *(pre-repository)*

Packaging fix. No behavioural change.

### Fixed

- `truegradient-supply-inventory`'s `description` was 1,029 characters, over the
  1,024 limit, so the plugin failed to load. Condensed to 928.

Every routing condition is preserved verbatim: the Supply Plan / DOI Details
split, the forecast-skill handoff, and the pricing exclusion. What was cut was
redundancy only — three example phrasings ("how much stock do I have", "what's my
days of supply", "how much inbound supply is coming") that each restated a
capability term already listed earlier in the description, plus tightened
enumeration of the reorder and inbound terms.

All five skill descriptions now measure 641–928 characters.

### 1.2.1 — 2026-08-31  *(pre-repository)*

Corrects two things 1.2.0 got wrong by hedging.

### Changed

- **All calculations run on the global lock.** 1.2.0 treated
  `Locked ML Forecast Lag_N` as a *default* that a user could override by naming a
  secondary lock. It is not a default — it is the only metric basis. Accuracy,
  bias, error, deviation, risk ranking and contribution are computed on the global
  lock, full stop. A `Lock ...` or `Multi_Lock ...` family may be **read and shown**
  when the user names one, labelled as not the calculation basis, but no metric is
  ever computed on it. Naming a secondary lock no longer moves the calculation.
- **The lag suffix is uniform, not variable.** 1.2.0 hedged that separators
  differed between families (` Lag_4` vs `_Lag_2`) and matched lags tolerantly.
  Every lock family uses the same form: a single space, then `Lag_`, then the
  number. The tolerant matching and the "separators vary" warnings are removed.
- **The leading word is therefore the only discriminator**, which makes the
  `Lock` / `Locked` collision the whole risk surface rather than one of several.
  Classification now anchors on the trailing space — `"Locked "` cannot be matched
  by `"Lock "`, because the next character is `e` — instead of relying on
  longest-token-first ordering. `contains "Lock"` still catches both and is still
  the mistake to avoid.

### Files touched

`LOCK-FAMILIES.md` (rewritten: §1–§2 restate the global-only rule, §3 uses the
space-anchored test, §4 states the uniform suffix), `SAFETY-CONTRACT.md` §3,
`DATA-CONTRACT.md` §5.2, `COLUMN-DISCOVERY.md`, `TOOL-GUIDE.md`, `METRICS.md` §1,
all four `truegradient-forecast-*` skills, README, and tests T43–T46 and T49.

T45 is inverted: asking for accuracy against a secondary lock should now produce
the global-lock figure plus an explanation, and computing on the secondary lock is
a critical failure. T49 likewise.

### Unchanged

The dangerous parts of 1.2.0 stand: one lag per figure, a lag difference is a
horizon effect and never a forecast change, derived error columns must match family
**and** lag or they fail silently, and `Bias` / `Accuracy` / `overall_accuracy` /
`rolling_accuracy` carry no family or lag token so their basis is not recoverable
from the column name.

### Still unverified

Only the global lock at one lag exists in the observed workspace. The secondary
`Lock ...` and `Multi_Lock ...` families remain documented from specification.
`Multi_Lock`'s suffix convention is not confirmed to follow the ` Lag_N` form —
it is classified by its leading word, and its lag is read from the live list rather
than assumed.

### 1.2.0 — 2026-08-31  *(pre-repository)*

Schema change: the frozen baseline is no longer a single `Locked ML Forecast`
column. It is now a **family × lag** choice across three lock families, two of
which differ by one letter. Every skill that measures against a baseline is
affected.

### Added

- **`references/LOCK-FAMILIES.md`** — the lock taxonomy, the selection rule, the
  lag semantics, the `Lock`/`Locked` prefix trap, derived-column pairing,
  `Multi_Lock` horizon behaviour, the discovery procedure, and a migration note
  for workspaces still carrying the bare unsuffixed column.
- Seven acceptance tests (T43–T49) covering default global-lock selection,
  `Lock` vs `Locked` separation, honouring a named secondary lock, lag blending,
  error-column pairing, lag-difference misattribution, and `Multi_Lock`
  disclosure. All are marked critical: they return plausible numbers and raise no
  error.
- A reader-facing "Which baseline accuracy is measured against" section in the
  README, so a planner can interpret the family and lag in the footer.

### The taxonomy

| Family | Meaning | Precedence |
|---|---|---|
| `Locked ML Forecast Lag_N` | **global / primary lock** | **default** |
| `Lock ML Forecast_Lag_N` | secondary, per-lag lock | only when named |
| `Multi_Lock ...` | rest-of-year lock from a single experiment | only when asked |

**`Locked` is the global and primary lock. `Lock` is a different family, not a
spelling variant.** Per instruction, the global lock is preferred unless the user
says otherwise.

### Changed

- `SAFETY-CONTRACT.md` §3 — the forecast-family table now lists all three lock
  families, and the accuracy rule requires naming the family and the lag,
  forbids blending lags, and forbids cross-lag error pairing.
- `DATA-CONTRACT.md` §5.2 / §5.4 — lock families and their derived error,
  deviation and risk columns carry the family and lag tokens.
- `COLUMN-DISCOVERY.md` — classification is longest-token-first
  (`Locked` → `Multi_Lock` → `Lock`); three new failure modes added.
- `METRICS.md` §1 — eligible-month discovery now selects a lock family and a
  single lag before pairing, and drops months at other lags.
- `TOOL-GUIDE.md` — the verbatim-copy rule calls out lock columns specifically,
  since their lag separators vary.
- `truegradient-forecast-accuracy`, `-risk`, `-change`, `-lookup` — baseline
  selection, worked examples and provenance footers updated. The change skill
  gains lock-vs-lock and lag-vs-lag pairings, and a rule that a lag difference is
  a horizon effect, never a forecast change.

### Guardrails specific to this release

- **`Lock` is a prefix of `Locked`**, so `contains "Lock"` and
  `starts_with "Lock"` both capture the global lock. Classification tests
  `Locked` first. Getting this backwards misclassifies every global-lock column.
- **Lag N means frozen N periods ahead**, so a lower lag flatters the number.
  One lag per figure, always named. A lag change is never reported as a forecast
  change.
- **Derived columns inherit family and lag.** A Lag_4 abs error paired with a
  Lag_2 forecast is arithmetically valid and meaningless, and nothing errors.
  Verify family and lag on every column before computing.
- **Separators are not fixed** — `... Forecast Lag_4` and `... Forecast_Lag_2`
  both occur. Column names are copied verbatim, never normalised or reassembled.
- **No silent substitution.** If the requested lock or lag is absent, the skills
  say so and list what does exist. They never fall back to `Forecast`,
  `ML Forecast` or `Consensus Forecast`, none of which is frozen.

### Known limitations in this release

- **Only the global lock at one lag has been observed live.** The secondary
  `Lock ...` and `Multi_Lock ...` families are documented from TrueGradient's
  specification, not from a workspace export. Their exact separator and lag
  tokens are therefore treated as unknown and matched tolerantly.
- **`Bias`, `Accuracy`, `overall_accuracy` and `rolling_accuracy` carry no family
  or lag token.** Which lock they were computed against is not recoverable from
  the column name. The skills quote them as precomputed and decline to attribute
  them to the global lock.
- **`Multi_Lock` horizon guidance is reasoning, not measurement.** §5 of
  `LOCK-FAMILIES.md` derives it from the definition and labels it as such.
- **Multiple global lags are handled by disclosure, not by rule.** If several
  exist, the skills report them, use the widest paired coverage, say so, and offer
  the alternatives — there is no basis in the data for preferring one lag.

### 1.1.0 — 2026-08-31  *(pre-repository)*

Adds supply and inventory coverage. The `inventory-optimization` module was
explicitly out of scope in 1.0.0; it is now served by a fifth skill.

### Added

- **`truegradient-supply-inventory`** — stock position, coverage, stockout
  timing, reorder plans and quantities, safety stock, inbound supply, excess and
  dead stock, sales-loss exposure, working capital, stock transfers.
  Its central job is routing: **time-phased and future-period questions go to
  `Supply Plan`; current-snapshot and policy questions go to `DOI Details`.**
- **`references/SUPPLY-DATA-CONTRACT.md`** — the six `inventory-optimization`
  datasets, the routing rule, `Supply Plan`'s long shape and bare-date columns,
  the twelve `Variable` measures, the balance-identity and lead-time traps, the
  pre/post-transfer variant rule, `Stock_Risk_Level`, and the join key.
- Nine acceptance tests (T34–T42) plus T33, covering long-format integrity, the
  balance trap, reorder-vs-receipt, the transfer variants, derived risk bands,
  stockout timing and causal invention.

### Changed

- `DATA-CONTRACT.md` §1 — the module table now names the skill that covers each
  module instead of marking inventory out of scope. Adds a note that
  `Final DA Data*` are exposed by `inventory-optimization` too, so routing follows
  the **question**, not the module.
- `truegradient-forecast-lookup`, `-accuracy`, `-risk` — inventory questions now
  hand off to `truegradient-supply-inventory` rather than being refused.
- T32 inverted: a days-of-inventory question should now be answered, not refused.
  Pricing remains out of scope (new T33).

### Guardrails specific to this release

- `Supply Plan` is **long**: one row per entity × measure, with **bare-date**
  month columns. The forecast column regex does not match it, every read must
  filter `Variable`, and totalling across `Variable` mixes units with days.
- The inventory balance is **never asserted as arithmetic**. `End Inventory` is
  floored at zero per entity, so shortfalls are discarded and aggregate sums do
  not reconcile. Unmet demand is read from `Final_Potential_Sales_Loss` and the
  OOS fields, never inferred by subtraction.
- `Reorder Plan` and `Reorder Received` are the same order at two moments,
  separated by that entity's lead time, and are never added. `Total Inbounds` is
  committed supply only and excludes both.
- Actionable figures default to the **post-transfer** variants (`updated_*`,
  `Final_*`), with the column named. The difference is material, not cosmetic.
- `Stock_Risk_Level` is stored workspace data: quotable with attribution, never
  derived. Same exception as `trust_zone` in `SAFETY-CONTRACT.md` §15.

### Known limitations in this release

- **Period cadence is not guaranteed.** Monthly month-end buckets were observed;
  weekly is possible. The skill probes the column list and states the cadence it
  found rather than assuming.
- **No server-side joins.** `Supply Plan` and `DOI Details` must be aligned
  client-side on `sku_standard` + `Channel`. `DOI Details` additionally carries
  `cluster` / `ts_id`, which do not exist in `Supply Plan`.
- **Read-only.** No reorder, PO or transfer can be written back.
- **`Supply Plan Value`** is documented and routable but has no dedicated
  worked example; it shares `Supply Plan`'s shape and `Variable` vocabulary.
- The observed workspace's baseline forecast family is
  `Locked ML Forecast Lag_4`, not the bare `Locked ML Forecast` named throughout
  `DATA-CONTRACT.md` §5.2. Discovery already handles this — the live column list
  is authoritative — but the forecast skills' documentation still shows the
  unsuffixed form. Worth aligning in a future release.

### 1.0.0 — 2026-08-03  *(pre-repository)*

First release.

### Skills

- `truegradient-forecast-lookup` — final forecast, actuals and uncertainty
  intervals for a specific entity or period
- `truegradient-forecast-accuracy` — accuracy, bias and error trend over eligible
  months
- `truegradient-forecast-risk` — forecast risk ranking, volume-weighted
- `truegradient-forecast-change` — comparison of two forecast versions

### References

- `SAFETY-CONTRACT.md` — 15 mandatory rules covering workspace identification,
  final-data definition, forecast-family disclosure, freshness, quality flags,
  missing-value handling, mandatory uncertainty intervals, sparse history, causal
  claims, fact/calculation/recommendation separation, the provenance footer,
  permissions, secrets, and the prohibition on derived trust-zone labels
- `DATA-CONTRACT.md` — modules, datasets, wide month-per-column shape, grain
  variability, all column families, the AB-class rule, ragged coverage
- `COLUMN-DISCOVERY.md` — the runtime discovery procedure and common failure modes
- `METRICS.md` — accuracy, bias, contribution, change and deviation formulas,
  matched to the TrueGradient application's implementation
- `TOOL-GUIDE.md` — the five connector tools, operational rules, error reference,
  worked example

### Connector

- Declares `https://mcp-server.truegradient.ai/mcp` in `.mcp.json` as a
  best-effort convenience. Admins should also add the connector at the
  organization level, which is the reliable path.
- Skills degrade safely when connector tools are absent: they state that no data
  access is available and produce no numbers.

### Known limitations in this release

- **No approval flag exists in TrueGradient.** "Final" is enforced as a convention
  (Completed experiment × `Final DA Data*` dataset × named forecast family) made
  auditable by a mandatory provenance footer, not as a tested field. Two Completed
  experiments holding a draft and an approved forecast are indistinguishable in
  the data.
- **Trust-zone thresholds cannot be read.** `trust_zone_thresholds` and
  `past_accuracy_horizon` are per-experiment configuration that no connector tool
  exposes. Skills therefore report raw accuracy and never derive zone labels. A
  stored `trust_zone` column, when present, may be quoted with attribution.
- **The connector's accuracy aggregations are unusable.** `wmape`, `accuracy`,
  `bias`, `mape`, `mae`, `rmse` and `sum_columns` pass validation but lose the
  `actual_column` / `columns[]` argument they require. All skills compute metrics
  from `sum` aggregations instead. To be revisited once the connector is fixed.
- **No forecast version history exists.** The change skill can quantify a change
  exactly but cannot explain it beyond any `SnOP Comments` recorded in the data.
  This is stated in its answers.
- **Forecast module only.** `inventory-optimization` and
  `pricing-promotion-optimization` datasets are out of scope; skills decline those
  questions.
- **`.mcp.json` auto-provisioning is unverified** for plugins uploaded through
  organization settings. The org connector path is documented as primary.
