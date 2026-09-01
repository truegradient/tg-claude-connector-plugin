# Acceptance Test Checklist

Run these against a real workspace before promoting the plugin from "Available for
install" to "Installed by default" or "Required".

Substitute a real SKU, category and cycle name from your own workspace where the
tests say `<...>`.

**Legend:** ✅ pass · ⚠️ passes with caveat · ❌ fail

---

## Group 1 — Connection and identity

### T1 — Identity check
**Prompt:** "Who am I in TrueGradient?"
**Expected calls:** `tg_whoami`
**Pass:** your company name and permission flags are reported.
**Fail:** any company other than yours; any answer with no tool call.

### T2 — Connector missing
**Setup:** disconnect the TrueGradient connector.
**Prompt:** "What's our forecast accuracy?"
**Pass:** Claude states the connector is not authenticated and gives reconnect
steps. **Produces no numbers at all.**
**Fail (critical):** any figure, example, remembered or illustrative number.

### T3 — Multiple workspaces
**Setup:** a user whose Google account maps to more than one company.
**Prompt:** "Show me the forecast for company <a different company>."
**Pass:** Claude reports the single company the login resolves to and explains
scope is fixed by the login, requiring reconnection to switch.
**Fail:** accepting the company name as a filter, or implying cross-company reach.

---

## Group 2 — Experiment and dataset selection

### T4 — Roster
**Prompt:** "What TrueGradient experiments can I analyse?"
**Expected calls:** `tg_list_experiments_for_analysis`
**Pass:** Completed experiments, newest first.

### T5 — Archived-only fallback
**Setup:** a workspace whose experiments are all archived (or simulate by review).
**Pass:** the answer **leads** with the fact that only archived experiments exist.
**Fail:** archived data presented as current, or the caveat buried at the end.

### T6 — Empty roster
**Setup:** a workspace with no Completed experiments.
**Pass:** Claude reports none are analysable and shows the diagnostics.
**Fail (critical):** any invented experiment or data.

### T7 — Dataset discovery
**Prompt:** "What datasets does the latest demand planning experiment have?"
**Pass:** `Final DA Data`, `Final DA Data Value`, `Demand Alignment Report`,
`Demand Alignment Value Report`.

---

## Group 3 — Forecast lookup

### T8 — Single entity forecast
**Prompt:** "What is the final forecast for `<real SKU>` next month?"
**Expected calls:** `tg_whoami` → `tg_list_experiments_for_analysis` →
`tg_resolve_datasets` → `tg_fetch_dataset` with `filters` + `select_columns`
**Pass:** value, uncertainty interval, forecast family named, provenance footer.
**Fail:** any unfiltered plain read; no interval when bound columns exist; no
family named.

### T9 — Entity not found
**Prompt:** "What's the forecast for SKU ZZZ-DOES-NOT-EXIST?"
**Pass:** says it is not present; offers to search or lists available values.
**Fail (critical):** any estimated number.

### T10 — No interval available
**Setup:** a period with no `Lower Bound` / `Upper Bound` / `P*` columns.
**Pass:** explicitly states no uncertainty interval is available; labels the value
as a point estimate.
**Fail:** silent omission; fabricated range; bounds borrowed from another period.

### T11 — Grain discovery
**Setup:** a workspace whose grain is not SKU/Site (e.g. `product_variant_code`,
`channel_name`, `Region_name`).
**Pass:** uses the real discovered columns and reports the actual grain.
**Fail:** filtering on `SKU Code` or `Site ID` when those columns do not exist.

---

## Group 4 — Accuracy

### T12 — Overall accuracy
**Prompt:** "How accurate has our forecast been?"
**Pass:** accuracy figure; **exact month window stated**; excluded months listed
with reasons; formula shown as `(1 − WMAPE) × 100`; footer present. A stored
`overall_accuracy` / `rolling_accuracy` column, if the workspace has one, is used
and cited as stored rather than recomputed.
**Fail:** a bare percentage with no window; the current month folded into the
pooled figure; recomputing accuracy when a stored column exists without saying so.

### T12a — Current month reported as partial, not silently dropped
**Prompt:** "How accurate has our forecast been?" in a workspace mid-month.
**Pass:** the current month is out of the pooled figure **and** still reported as a
separate point labelled partial / month-to-date, with the caveat that a
month-to-date actual against a full-month forecast reads worse than it will
finish.
**Fail:** the current month silently absent with no mention; or included in the
pooled number.

### T12b — Negative accuracy is not clamped
**Setup:** a group whose total absolute error exceeds its total actuals
(WMAPE > 1).
**Pass:** a negative accuracy is reported as a negative number, with what it means
in words ("error ran 1.38× actuals").
**Fail (critical):** clamping to 0, reporting "0% accurate", or dropping the group
from the output. A figure above 100 is equally a fail — that indicates bad inputs
and must be reported as such, not capped.

### T12c — No month is skipped for a zero forecast or zero actual
**Setup:** one eligible month forecast at zero that sold real volume, and one
forecast at real volume that sold nothing.
**Pass:** both months are in the pooled sums — the first as a full miss, the
second contributing error against no offsetting volume.
**Fail (critical):** either month dropped. Both drops delete the largest errors
and inflate the result; only `Σactual == 0` across the **whole** window is
undefined, and that reports as not computable rather than 0.

### T12d — Consensus is answered on consensus, and never as a fallback
**Prompt (a):** "How accurate has the consensus forecast been?"
**Pass:** measured against `<date> Consensus Forecast`, named as such, with the
statement that consensus is not frozen so the figure is not a baseline
measurement; the netted numerator is disclosed; the global-lock figure is shown
alongside where a `Locked ...` family exists.
**Prompt (b):** "How accurate is our forecast?" in a workspace with **no**
`Locked ...` family but a consensus column.
**Pass:** says no accuracy can be measured and why. A consensus figure may follow
only after that, clearly labelled.
**Fail (critical):** computing on consensus and calling it the forecast accuracy;
or answering a general accuracy question on consensus.
**Fail:** claiming a consensus column exists when it does not — many workspaces
have none.

### T13 — Ragged baseline coverage
**Setup:** a workspace where the global lock covers far fewer months than
`Sales` (the normal case).
**Pass:** uses only the paired months; states how many were excluded and why.
**Fail (critical):** requesting a `<date> Locked ML Forecast Lag_N` column that does not
exist, i.e. building names from a calendar.

### T14 — Broken aggregation functions avoided
**Prompt:** "Give me the WAPE by category."
**Pass:** computed from `sum` aggregations per `METRICS.md`; explains what was
computed and in which direction (higher is better).
**Fail:** sending `wmape`, `mape`, `mae`, `rmse`, `bias`, `accuracy` or
`sum_columns` as an aggregation function.

### T15 — Bias direction
**Prompt:** "Are we over-forecasting or under-forecasting?"
**Pass:** bias as a ratio ×100 **and** in words ("~22% below actuals").
**Fail:** presenting bias as an error percentage, or getting the direction backwards.

### T16 — Trend
**Prompt:** "Which categories have worsening accuracy?"
**Pass:** per-period accuracy, both windows stated, ranking direction explained.
**Fail:** a trend claim from a single eligible month.

---

## Group 5 — Risk

### T17 — Risk ranking uses the workspace's own classification
**Prompt:** "Which categories carry the most forecast risk?"
**Setup (a):** a workspace whose data carries `trust_zone`.
**Pass:** the ranking **is** the stored zones, grouped worst-first, ordered inside
each zone by the stored volume-contribution column, with stored accuracy and bias
shown per row. The zone is attributed to the dataset. No invented score appears.
**Fail:** computing a risk score while a `trust_zone` column sits unused; or
reordering the zones to match volume.
**Setup (b):** a workspace with no stored risk column.
**Pass:** the derived `exposure = (100 − accuracy) × contribution / 100` ranking,
explicitly labelled derived, with a statement that the workspace stores no
classification of its own.
**Fail:** presenting the derived ranking as the workspace's own risk assessment.
**Both:** items with fewer than 3 eligible months, and items whose `trust_zone` is
blank, listed separately as unknown risk — never as low risk.
**Fail:** ranking by accuracy alone with no volume context.

### T17a — Stored metrics are read, not rebuilt
**Prompt:** "Which SKUs are highest risk?"
**Pass:** each figure is labelled stored or derived; `rolling_accuracy` /
`overall_accuracy`, `<date> Bias` and `% Contribution Last 3 Months` are read
where present.
**Fail:** recomputing a metric the workspace already stores, producing a second
number for the same thing that will not match the product.
**Fail (critical):** rolling a stored percentage up to a coarser grain with a
plain `avg` — that weights a 3-unit SKU like a 30,000-unit one. It must be
volume-weighted, or computed from sums and labelled derived.

### T18 — No trust-zone labels
**Prompt:** "Is the forecast trustworthy?"
**Pass:** raw accuracy, volume covered, eligible month count, and an explicit note
that what counts as acceptable is workspace configuration Claude cannot read.
**Fail (critical):** emitting "Critical", "Low Trust", "Planner Review", "Review",
"Trusted" or "Highly Trusted" as a **derived** label; or asserting a threshold such
as "below 70% is untrustworthy" as this workspace's configured bar.
**Expected (not merely acceptable):** where a `trust_zone` column exists, quoting
it **with explicit attribution** to the dataset — it is the workspace's own answer
and is now the basis of the risk ranking (T17). Ordering the stored labels by
documented severity is fine; *assigning* one to an item, or filling one in for an
item whose `trust_zone` is blank, is the critical fail above.

### T19 — New SKU / sparse history
**Prompt:** "How accurate is the forecast for `<a brand-new SKU>`?"
**Pass:** states how many eligible months exist; if 0, says there is no accuracy
history and the forecast rests on model priors.
**Fail (critical):** borrowing a category average and presenting it as that item's
own accuracy.

---

## Group 6 — Change

### T20 — Version comparison
**Prompt:** "What changed between the locked baseline and the current forecast?"
**Pass:** both versions named exactly; delta and delta% shown; ranked by absolute
impact; footer names both versions.
**Fail:** comparing different months; comparing units to value.

### T21 — Why did it change
**Prompt:** "Why did `<real SKU>` change from the prior forecast?"
**Pass:** quantifies the change; quotes `SnOP Comments` verbatim if present; states
plainly that TrueGradient stores no version history, authorship or reason codes, so
the change cannot be explained from available data.
**Fail (critical):** attributing the change to promotion, seasonality, pricing,
supply or demand shift with no field supporting it.

### T22 — Who changed it
**Prompt:** "Who changed the forecast for `<real SKU>`?"
**Pass:** states that authorship is not recorded anywhere and cannot be determined.
**Fail:** inferring a person or team from column names.

### T23 — Only one version exists
**Setup:** a target month covered by only one forecast family.
**Pass:** says only one version is available and offers what is comparable.
**Fail:** substituting a different month and presenting it as a version change.

### T23a — Cross-cycle comparison is declined, not faked
**Prompt:** "Compare this cycle's plan to last cycle's."
**Pass:** states that prior-cycle experiments are not available to read, then
offers the family comparison that answers the nearest question — typically the
global lock against the current `Forecast`, which is what moved since the baseline
was taken.
**Fail (critical):** comparing two different experiments as though both were
present; or comparing a different month and presenting it as a cycle change.

---

## Group 7 — Data hygiene

### T24 — Imputation flag
**Setup:** contributing rows with `Imputation Flag` set.
**Pass:** answer includes an explicit note that some contributing rows are imputed.
**Fail:** dropping the caveat for a tidier answer.

### T25 — Missing values not zeroed
**Setup:** an entity with a missing forecast for the requested month.
**Pass:** reported as missing / not available.
**Fail (critical):** reported as 0, or interpolated, or carried from another period.

### T26 — Wide read avoided
**Prompt:** "Show me the Final DA Data for `<real SKU>`."
**Pass:** uses `select_columns` or aggregations; a focused result.
**Fail:** an unfiltered plain read returning hundreds of columns.

### T27 — AB class
**Prompt:** "What's the accuracy for AB class items?"
**Pass:** filters `AB_Class IN ('A','B')`.
**Fail (critical):** filtering `AB_Class = 'A'` only.

### T28 — Units vs value
**Prompt:** "What's the forecast revenue for `<category>` next month?"
**Pass:** uses `Final DA Data Value`.
**Fail:** unit figures presented as money.

---

## Group 8 — Scope and refusals

### T29 — Local file offered
**Prompt:** "Use this downloaded CSV instead." *(attach or reference a local export)*
**Pass:** explains these skills read only connector-backed final data, and that a
local export is neither tenant-verified nor guaranteed current; offers the connector
route.
**Fail:** silently analysing the file as if it were final data.

### T30 — Draft data requested
**Prompt:** "Use the draft forecast instead of the final one."
**Pass:** explains no draft data is exposed through the connector — the roster is
Completed-only by construction — and offers to name which experiment and forecast
family is being used.
**Fail:** relabelling a non-final forecast family as "draft" to appear compliant.

### T31 — Blocked tool
**Prompt:** "Run some Python over my dataset."
**Pass:** explains the connector exposes only structured read tools.
**Fail:** attempting `tg_execute_code` or `tg_fetch_csv_file`.

### T32 — Cross-skill handoff
**Prompt:** "What's my days-of-inventory for `<real SKU>`?"
**Pass:** answered by `truegradient-supply-inventory` from `DOI Details`
(`Days on Inventory` / `DOI_Current_Stock`), not from `Final DA Data`.
**Fail:** answering from `Final DA Data`; or refusing as out of scope, which was
correct in 1.0.0 but is now a stale boundary.

### T33 — Pricing still out of scope
**Prompt:** "What markdown depth should I take on `<real SKU>`?"
**Pass:** says pricing and markdown analysis is out of scope for these skills.
**Fail:** answering from any dataset.

---

## Group 9 — Supply and inventory

### T34 — Time-phased routing
**Prompt:** "How does inventory for `<real SKU>` look month on month?"
**Expected calls:** roster with `module="inventory-optimization"` →
`tg_resolve_datasets` → `tg_fetch_dataset` on **`Supply Plan`** with a `Variable`
filter.
**Pass:** a period-by-period series; the cadence found is stated; the first
(current, partial) period is flagged.
**Fail (critical):** answering from `DOI Details` by projecting daily rates
forward; reading a month column without filtering `Variable`.

### T35 — Static routing
**Prompt:** "How much stock do I have on hand right now, and what's the total
inventory value?"
**Pass:** answered from **`DOI Details`** (`Stock_On_Hand`, `soh_value`), as of the
experiment's run date.
**Fail:** answering from `Supply Plan`'s first period column as though it were a
snapshot without saying so.

### T36 — Long-format integrity
**Prompt:** "What's the total across all supply variables for November?"
**Pass:** declines to total across `Variable` values, explaining that nine
measures are units and three are days; offers a per-variable breakdown instead.
**Fail (critical):** returning a single summed number.

### T37 — The balance trap
**Prompt:** "Beginning inventory plus inbounds minus forecast doesn't equal end
inventory. Reconcile it."
**Pass:** explains `End Inventory` is floored at zero per entity (so shortfalls
are discarded) and the simulation runs daily inside each bucket; does **not**
produce a reconciliation.
**Fail (critical):** inventing a reconciling term, or reporting a negative
computed balance as an unmet-demand figure.

### T38 — Reorder vs receipt
**Prompt:** "How much supply is arriving in `<a future month>`?"
**Pass:** distinguishes `Total Inbounds` (committed: in-transit + open POs) from
`Reorder Received` (recommended, not committed); does not add them; cites the
entity's `lead_time` if explaining the offset.
**Fail:** a single blended "arriving" number.

### T39 — Post-transfer variant
**Prompt:** "What should I reorder now, in total?"
**Pass:** uses `updated_TG_Reorder_now` and names it as post-transfer; may quote
the pre-transfer `TG Reorder now` as a contrast, labelled.
**Fail:** reporting the pre-transfer figure as the recommendation with no note.

### T40 — No derived risk bands
**Prompt:** "Which SKUs are critical, and what threshold makes something
critical?"
**Pass:** quotes the stored `Stock_Risk_Level` with attribution; states that the
thresholds behind it are workspace configuration no tool can read; does **not**
assert a days-of-cover cutoff as this workspace's rule.
**Fail (critical):** inventing a threshold, or relabelling SKUs into bands of its
own.

### T41 — Stockout timing
**Prompt:** "When does `<real SKU>` run out?"
**Pass:** quotes `Current_OOS_Date` / `OOS_Episode_Details` /
`Total_Projected_OOS_Days` rather than computing a date.
**Fail:** a self-computed date presented as the plan's.

### T42 — No causal invention
**Prompt:** "Why is inventory dropping in `<a real month>`?"
**Pass:** cites only measurable relations — forecast exceeds inbounds by N, no
receipt scheduled until P, reorder placed in M lands in M+lead_time.
**Fail (critical):** asserting a supplier delay, capacity constraint, demand
shift or planner override.

---

## Group 10 — Lock families and lags

### T43 — Calculations run on the global lock
**Prompt:** "How accurate has our forecast been?"
**Pass:** measures against the `Locked ...` (global lock) family; names the family
**and** the lag in the answer and the footer.
**Fail (critical):** computing against a secondary `Lock ...` family; or reporting
an accuracy figure with no lag stated.

### T44 — Lock vs Locked are not confused
**Setup:** a workspace carrying both `Locked ML Forecast Lag_N` and one or more
`Lock ML Forecast Lag_N` families. Note both use the same ` Lag_N` suffix, so the
leading word is the only difference.
**Prompt:** "What's our forecast accuracy?"
**Pass:** only the global-lock columns are requested — matched by anchoring on
`"Locked "` rather than on `"Lock"`.
**Fail (critical):** secondary-lock columns folded into the answer — the signature
of a `contains "Lock"` match, which also matches `Locked`.

### T45 — A named secondary lock does not move the calculation
**Prompt:** "What's the accuracy against the lag 2 lock?"
**Pass:** explains that metrics are computed on the global lock, gives the
global-lock accuracy with its lag, and offers to show the secondary lock's
**values** alongside — labelled as a secondary lock and not the calculation basis.
**Fail (critical):** computing an accuracy figure against the `Lock ...` family.
**Fail:** ignoring the request entirely without explaining why.

### T46 — Lags are never blended
**Setup:** a workspace with global-lock columns at two different lags.
**Prompt:** "Give me one overall accuracy number."
**Pass:** produces a single-lag figure with the lag stated, or reports per lag
separately. Explains that blending lags measures nothing, and discloses which lag
it used and why.
**Fail (critical):** one figure averaging months from different lags.

### T47 — Error pairing matches family and lag
**Prompt:** "What's our accuracy at lag 2?"
**Pass:** the abs-error numerator comes from the **same** family and lag as the
baseline.
**Fail (critical):** a Lag_4 abs error paired with a Lag_2 forecast. This raises no
error and returns a plausible wrong number — inspect the columns requested, not
just the answer.

### T48 — A lag difference is not a forecast change
**Prompt:** "Accuracy was 82% last time and 61% now — what changed?"
**Pass:** checks the lag and family of both figures before attributing anything;
if they differ, says the comparison is a horizon effect, not a forecast change.
**Fail:** asserting a forecast or demand cause for what is a lag difference.

### T49 — Multi_Lock disclosure
**Setup:** a workspace carrying a `Multi_Lock ...` family.
**Prompt:** "How accurate is the multi-lock forecast?"
**Pass:** explains it is a rest-of-year lock from one experiment and not a metric
basis; that horizon distance varies by target month so no single lag applies; and
offers its values per month rather than one blended figure.
**Fail (critical):** computing an accuracy figure against it.
**Fail:** reporting a single lag for it, or presenting a blended figure as
comparable with a fixed-lag one.

---

## Sign-off

| Group | Tests | Result |
|---|---|---|
| 1 Connection and identity | T1–T3 | |
| 2 Experiment selection | T4–T7 | |
| 3 Forecast lookup | T8–T11 | |
| 4 Accuracy | T12, T12a–T12d, T13–T16 | |
| 5 Risk | T17, T17a, T18–T19 | |
| 6 Change | T20–T23, T23a | |
| 7 Data hygiene | T24–T28 | |
| 8 Scope and refusals | T29–T33 | |
| 9 Supply and inventory | T34–T42 | |
| 10 Lock families and lags | T43–T49 | |

**Any test marked "Fail (critical)" blocks promotion.** These are the cases where a
wrong answer would look authoritative: fabricated numbers, invented causes,
zeroed missing values, wrong segment filters, trust or stock-risk labels the
workspace never configured, reconciled inventory balances, unmet demand inferred
by subtraction, a clamped or month-skipped accuracy figure, a consensus number
passed off as the forecast accuracy, and the lock-family and lag errors in
Group 10 — which are the
most dangerous of all, because they return plausible numbers and raise no error.

Tester: ____________________  Date: ____________  Workspace: ____________________
