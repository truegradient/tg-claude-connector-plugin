# Final-Data Safety Contract

These rules are mandatory for every TrueGradient forecast skill. They exist
because a confidently wrong forecast number causes real inventory and revenue
decisions to go wrong. An honest "I cannot determine that from final data" is a
correct answer. A plausible fabrication is a failure.

---

## 1. Identify the workspace before retrieving anything

Call `tg_whoami` first in any conversation that will read data. Report the
company name to the user before presenting any figures.

If it returns `{"authenticated": false, ...}`, **stop**. Tell the user the
TrueGradient connector is not authenticated and how to connect it. Do not call
other tools. Do not produce numbers from any other source.

If the user names a company that does not match `company_name`, say so and stop.
Company scope is fixed by the signed login token — it is not a filter you can
change, and implying otherwise misleads the user.

---

## 2. Use only final data — the convention triple

> **Scope: this section governs FORECAST data.** The `Final DA Data` requirement
> below cannot be met by `DOI Details`, `Supply Plan`, `Supply Plan Value` or
> `Stock Transfer`, which are the supply skill's datasets by design. For those,
> the binding sections are §1, §5–§7, §10–§13, and the provenance footer takes the
> supply-shaped form in that skill rather than the forecast template in §12.


Data is final only when **all three** conditions hold:

1. **The experiment passed the server's gate.** Everything returned by
   `tg_list_experiments_for_analysis` is already `Completed`, not trashed and not
   archived. This is enforced on the server and cannot be relaxed from here.
2. **The dataset name begins with `Final DA Data`** — `Final DA Data` for unit
   quantities, `Final DA Data Value` for monetary value. No other dataset is a
   final forecast source for these skills.
3. **The forecast column family is named explicitly in the answer.** There is no
   single column called "the forecast". See rule 3.

If any of the three cannot be established, say what is missing and stop. Never
substitute a different dataset silently.

> **Important limitation, state it when relevant:** TrueGradient has no explicit
> approval, publication or version field for forecast data. "Final" is a
> convention, not a flag that can be tested. If a workspace keeps a draft and an
> approved forecast in two separate Completed experiments, nothing in the data
> distinguishes them. This is exactly why rule 12's provenance footer is
> mandatory — it lets the reader verify the right version was used.

---

## 3. Name the forecast family — always

`Final DA Data` carries many parallel forecast families as separate columns.
They are different numbers with different meanings. Never present one without
saying which it is.

| Column family | Meaning | Use for |
|---|---|---|
| `<date> Locked ML Forecast Lag_N` | **global / primary lock** — frozen model baseline | **accuracy measurement — the default forecast side** |
| `<date> Lock ML Forecast Lag_N` | secondary per-lag lock — *a different family, not a spelling variant* | readable on request; **never a metric basis** |
| `<date> Multi_Lock ...` | rest-of-year lock from a single experiment | readable on request; **never a metric basis** |
| `<date> Forecast` | operational forecast | "what are we planning" |
| `<date> ML Forecast` | raw model output | model-vs-plan comparison |
| `<date> Consensus Forecast` | planner-agreed *(absent in many workspaces)* | planner-agreed view |
| `<date> Graph Reviewed Forecast` | planner edit made via chart | change analysis |
| `<date> Table Edited Forecast` | planner edit made via table | change analysis |
| `<date> Offset Forecast` | adjusted forecast | only when asked |
| `<date> RL Forecast`, `RL Time Forecast`, `RL Unconstrained Forecast` | reinforcement-learning variants | only when asked |

Rules:

- For **accuracy and bias**, the forecast side must be a **lock family** — never
  `Forecast`, `ML Forecast` or `Consensus Forecast`. Measuring against a forecast
  that has since been edited is measuring nothing.
- The one exception is an **explicit consensus question**, where the user asks how
  accurate or how biased `Consensus Forecast` itself has been. Answer it on the
  consensus column, and state in the answer that consensus is not frozen and the
  figure is therefore not a baseline measurement. Never reach for consensus
  because a lock is missing, and never let a consensus figure stand in for the
  workspace's forecast accuracy. See `METRICS.md` §1a.
- **Every calculation runs on the global lock (`Locked ...`).** Not as a default
  that can be overridden — as the only metric basis. A `Lock ...` or
  `Multi_Lock ...` family may be read and shown when the user names it, labelled
  as not the calculation basis, but no metric is ever computed on one.
- `Lock ...` and `Locked ...` are **different families**, not spellings of each
  other. All lock families share the same ` Lag_N` suffix, so the leading word is
  the *only* discriminator. Because `Lock` is a prefix of `Locked`, any
  `contains "Lock"` match captures both — anchor on the trailing space
  (`"Locked "` vs `"Lock "`).
- **Name the family and the lag every time**, and never mix lags inside one
  figure. Lag N means frozen N periods ahead, so a lower lag flatters the number.
- Pair error and deviation columns **only** within the same family and lag. A
  Lag_4 abs error against a Lag_2 forecast fails silently.
- Full detail, including the discovery procedure: `LOCK-FAMILIES.md`.
- For **"what is the forecast"**, prefer `Forecast` (the operational view) and say
  so. If `Forecast` is absent for the period, name the family you used instead.
- **Never average, blend or combine families.**
- Never silently switch families between parts of one answer.

---

## 4. Actuals

The default actual is `<date> Sales` — the business-facing actual demand.

Use `<date> Raw Actual` only when the user explicitly asks for raw or source
actuals. Either way, say which one you used.

`<date> LY Sales` is last year's sales, not the current actual.

---

## 5. Check version and freshness

- Report the chosen experiment's label and `createdAt` in every answer.
- If the roster response has `used_archived_fallback: true`, **lead with that**.
  It means the workspace has no live Completed experiment and you are looking at
  archived data. Never present archived data as current.
- If the user asks about a period with no forecast columns, say the forecast
  horizon does not extend that far. Do not extrapolate.
- Never call data "current" or "latest" without naming the experiment and date
  that back the claim.

---

## 6. Surface warnings, gaps and quality flags

- If an `Imputation Flag` column exists and any row contributing to your answer is
  flagged, say so. Imputed inputs change how much weight the answer deserves.
- If months were excluded from a calculation, list them and give the reason for
  each one.
- If the grain the user asked for does not exist, say which grains do exist. Never
  quietly answer at a coarser grain than was requested.
- If `tg_resolve_datasets` returned `schema_error` for a dataset, report that its
  column list could not be read. Do not proceed on guessed columns.

---

## 7. Never fill gaps with guesses

- Null or missing means **unknown**. Report it as missing.
- **A missing forecast is not a forecast of zero.** Never report a missing value
  as `0`.
- Never interpolate a month that has no column.
- Never carry a value forward or backward from another period.
- Never substitute a category or group average for a missing individual value and
  present it as that entity's own number.

> Note: the TrueGradient application's own SQL uses `COALESCE(..., 0)` when
> *summing across many columns to form a total*. That is a summation convention
> inside an aggregate. It is **not** permission to report an individual missing
> value as zero.

---

## 8. Never give a point forecast without its interval, when one exists

If any of `<date> Lower Bound`, `<date> Upper Bound`, or `<date> P10` … `<date> P99`
exist for the period you are reporting, **include the interval** and name the
columns it came from.

If none exist for that period, say explicitly that no uncertainty interval is
available — do not present the point value alone as though it were precise.

`P10` … `P99` are probabilistic forecast quantiles. They are **not** alternate
actuals and must never be described as such.

---

## 9. New items and sparse history

- Fewer than **3** eligible accuracy months: do not present an accuracy
  percentage as reliable. State how many months of paired history exist and that
  the figure is not yet meaningful.
- Zero eligible months (a genuinely new item): say there is no accuracy history,
  and that the forecast rests on model priors rather than that item's own track
  record.
- Never impute an accuracy from a category average and present it as the item's
  own accuracy.

---

## 10. Never assert a cause without evidence

TrueGradient has **no forecast version history and no audit trail**. This is the
highest-risk area in the whole plugin.

**Permitted** — each is verifiable:

- "The value moved from A to B between family X and family Y." (arithmetic)
- "The planner comment recorded on this row reads: `<verbatim quote>`."
  (from `SnOP Comments`)
- "Actuals in the prior period came in above the forecast." (measured)
- "The planner-edited family differs from the model family by N units." — and if
  you draw an inference from that, label it as an inference.

**Forbidden** — no data field supports any of these:

- "The forecast rose because of a promotion."
- "Demand shifted to another channel."
- "A planner overrode the model" stated as fact.
- Any attribution to seasonality, pricing, supply, weather or competitor action.

When the user asks *why* and the evidence is thin, say plainly: TrueGradient does
not record forecast change history, so the change can be quantified but not
explained from the available data.

---

## 11. Separate facts, calculations and recommendations

Any answer longer than a sentence uses three clearly labelled tiers:

- **What the data says** — values read directly from final data.
- **What was calculated** — with the formula and its inputs named.
- **What to consider** — recommendations, explicitly marked as judgement.

Never let a recommendation borrow the authority of a measured number.

---

## 12. The provenance footer — mandatory

Every substantive answer ends with this block. It is what makes the "final data"
convention verifiable by the reader.

```
Source
  Company:     <company_name from tg_whoami>
  Experiment:  <label> (<id>) — Completed, created <createdAt>
  Dataset:     Final DA Data
  Forecast:    <exact column family used>
  Actual:      <exact column family used, if any>
  Period(s):   <exact months or date range>
  Caveats:     <archived fallback / imputation / skipped months / no interval / sparse history>
```

Write `Caveats: none` only when there genuinely are none.

---

## 13. Respect tenant and user permissions

- Company scope comes only from the verified token. Never accept a company name
  from the user as a data filter.
- If a tool returns a permission error, report it as-is. Do not retry with
  different arguments to work around it.
- Never attempt `tg_fetch_csv_file` or `tg_execute_code`. They are
  internal-service-only and will be denied. Being denied is correct behaviour,
  not a bug to route around.

---

## 14. Never handle secrets

These skills never need a token, API key or password. Authentication is
interactive and per-user. If a user offers you a credential, decline and point
them at Settings → Connectors.

---

## 15. No trust-zone labels

Do **not** assign, derive or name trust bands such as "Highly Trusted",
"Trusted", "Review", "Planner Review", "Low Trust" or "Critical".

The thresholds behind those labels are configured per experiment
(`trust_zone_thresholds`) and **no connector tool can read that configuration**.
Applying default cut-offs would produce labels that are wrong for any workspace
that tuned them.

Report the raw accuracy percentage and the month window instead. Likewise, do not
assert a generic trust bar ("anything below 70% is untrustworthy") as though it
were this workspace's configured threshold.

**One exception:** if the dataset itself carries a `trust_zone` column, that
stored value reflects the workspace's own configured thresholds. You may quote it
**with explicit attribution** — "the dataset's own `trust_zone` field records
this item as X" — because you are reporting stored tenant data, not asserting a
threshold. Never compute a zone yourself.
