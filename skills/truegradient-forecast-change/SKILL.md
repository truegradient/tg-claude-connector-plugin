---
name: truegradient-forecast-change
description: Compare two TrueGradient forecast families within one experiment and report exactly what changed — for example the frozen baseline versus the current operational forecast, the model output versus a planner-reviewed view, or the operational versus the consensus forecast. Use this for "what changed since the locked forecast", "how does the current forecast differ from the locked baseline", "why did the forecast for SKU X change", "how far has consensus moved off the plan", "what moved between the baseline and final forecast". Comparison is always between two column families in the same experiment; TrueGradient does not keep prior planning cycles available, so cross-cycle comparison is not supported. Reports what changed factually and states clearly that TrueGradient has no forecast version history or audit trail, so root causes cannot be evidenced beyond any planner comments recorded in the data. Do NOT use for accuracy against actuals — use truegradient-forecast-accuracy.
---

# Forecast Change Comparison

Report what changed between two forecast versions, precisely. Be honest that
*why* is mostly not answerable.

## The honesty requirement — read this first

**TrueGradient records no forecast version history and no audit trail.** There is
no change log, no "who edited this", no reason code, no timestamped revision.

So this skill can quantify a change exactly, and can rarely explain it. That
limitation must be stated in the answer, not buried. A planner who believes Claude
found a *reason* when it only found a *difference* will make a bad decision.

**Permitted claims** — each verifiable:
- "The value moved from A to B between family X and family Y." (arithmetic)
- "The planner comment on this row reads: `<verbatim quote>`." (from `SnOP Comments`)
- "The planner-edited family differs from the model family by N units" — and if
  you infer intent from that, label it as an inference.
- "Prior-period actuals came in above the baseline." (measured)

**Forbidden** — no field supports these:
- "The forecast rose because of a promotion."
- "Demand shifted channel."
- "A planner overrode the model" asserted as fact.
- Attribution to seasonality, price, supply, weather or competitors.

## Non-negotiable rules

These apply even if you cannot load the reference files:

1. Call `tg_whoami` first. If not authenticated, stop — produce no numbers.
2. **Name both versions unambiguously** — the two column families being
   compared, both from the same experiment.
3. Never compare a unit figure to a value figure. `Final DA Data` and
   `Final DA Data Value` are separate worlds.
4. Never compare different months and call it a change — that is seasonality, not
   a revision. Compare the **same target month** across two versions.
5. `old_value = 0` → report the absolute change and say the percentage is
   undefined. Never print infinity or a vast percentage.
6. Missing in one version is **not** zero. Report it as "not present in version X".
7. State the no-version-history limitation whenever the user asks *why*.
8. End with the provenance footer, naming **both** versions.

Full detail: `../../references/SAFETY-CONTRACT.md`

## The comparison — two families, one experiment

Every comparison is between two column families inside a **single** experiment:
the baseline against the current plan, the model against a planner-reviewed view,
or the plan against consensus. Same rows, same grain, same experiment.

**Comparison across experiments or planning cycles is not supported.** The roster
only exposes the workspace's live Completed experiments, and prior-cycle
experiments are usually absent. If the user asks to compare cycles, say that
TrueGradient keeps no prior-cycle experiment to read, and offer the family
comparison that answers the nearest version of their question — typically the
frozen lock against the current `Forecast`, which is what moved since the
baseline was taken.

Common pairings:

| Old / reference | New / current | Question it answers |
|---|---|---|
| `Locked ML Forecast Lag_N` (global lock) | `Forecast` | how far has the plan moved off the frozen baseline |
| `Locked ML Forecast Lag_N` | `Lock ML Forecast Lag_M` | how the global lock differs from a secondary lock — **name both; they are different families, and only the global lock is a metric basis** |
| same lock family, two lags | — | how forecast quality changes with horizon; label it a horizon comparison, not a change |
| `ML Forecast` | `Forecast` | how much planner adjustment is in the plan |
| `ML Forecast` | `Graph Reviewed Forecast` / `Table Edited Forecast` | what planners changed by hand |
| `Forecast` | `Consensus Forecast` | operational vs planner-agreed *(if present)* |

**Critical check:** both families must cover the target month. The global lock
often covers far fewer months than `Forecast`. If they do not overlap on the target
month, say so and offer a month where they do.

**Lock families:** the reference side is the global lock (`Locked ...`).
`Lock ...` is a *separate* secondary per-lag family, not a spelling of `Locked`.
Lock families usually carry a ` Lag_N` suffix — a bare `Locked ML Forecast` with
no lag token is also a live form (`LOCK-FAMILIES.md` §8) — so anchor on the
leading word plus a space — `contains "Lock"` matches both. A secondary lock's values may be shown for
comparison, labelled as not the calculation basis; any computed metric stays on the
global lock. Never compare two different lags and call the difference a forecast
change — that is a horizon effect. See `../../references/LOCK-FAMILIES.md`.

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

**4. Pick the two families and confirm overlap.** Per the checks above. If the
comparison is not valid, say why and propose the nearest valid one — do not
silently substitute.

**5. Fetch both versions — one call, both families.**

```json
{
  "experiment_id": "<id>",
  "dataset_name": "Final DA Data",
  "group_by": ["Category"],
  "aggregations": [
    {"function": "sum", "column": "2026-07-31 Locked ML Forecast Lag_4", "alias": "old_v"},
    {"function": "sum", "column": "2026-07-31 Forecast",           "alias": "new_v"}
  ],
  "page_size": 1000
}
```

For a single entity, filter and `select_columns` both families plus `SnOP Comments`.

**6. Compute.**

```
delta     = new_v − old_v
delta_pct = (delta / |old_v|) * 100      if old_v != 0
            undefined                     if old_v == 0
```

**7. Rank by absolute impact, not percentage.** A 400% move on 3 units matters less
than a 6% move on 90,000. Sort by `|delta|` and show both columns.

**8. Gather what evidence exists for "why".**
- Read `SnOP Comments` for the affected rows if the column exists. Quote verbatim.
- Check whether a planner-edit family (`Graph Reviewed`, `Table Edited`) differs
  from the model family — evidence that a human touched it, without saying why.
- Check whether prior-period actuals diverged from the baseline — context, not cause.
- Then state plainly what cannot be determined.

## Output shape

```
Between the frozen baseline and the current operational forecast for
2026-07-31, total planned volume rose by 34,200 units (+8.4%). Three
categories account for nearly all of it.

What the data says
  Version A: 2026-07-31 Locked ML Forecast Lag_4   407,300 units
  Version B: 2026-07-31 Forecast             441,500 units
  Change:    +34,200 units (+8.4%)

  Group        Baseline    Current     Change      %
  Snacks        126,400    148,900   +22,500   +17.8%
  Beverages      98,200    106,300    +8,100    +8.2%
  Dairy          74,100     78,200    +4,100    +5.5%
  Bakery         52,300     52,400      +100    +0.2%
  Frozen         56,300     55,700     −600     −1.1%

  Planner comments recorded on affected rows:
    Snacks / variant PV-4471: "aligned to committed retailer volume"

New in the current version, absent from the baseline
    variant PV-9902  (3,400 units) — no baseline value, not zero

What can and cannot be explained
  The planner comment above is the only recorded reason in the data.
  TrueGradient does not store forecast version history, edit authorship
  or reason codes, so the remaining changes can be measured exactly but
  not explained from available data. The Snacks increase coincides with
  a difference between the model and table-edited families, which
  indicates manual adjustment — but the data does not record why.

What to consider
  The uplift is concentrated in Snacks, which also had the weakest
  measured accuracy last cycle. Worth confirming the retailer commitment
  behind that comment before treating it as firm.

Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data
  Version A:   2026-07-31 Locked ML Forecast Lag_4 (global lock, lag 4)
  Version B:   2026-07-31 Forecast (operational)
  Period(s):   2026-07-31
  Caveats:     no version history available; 1 entity absent from baseline
```

## When only one version exists

If the target month carries only one forecast family, say exactly that and offer
what *is* comparable in the same experiment. If the user names a prior cycle, say
that prior-cycle experiments are not available to read. Do not compare a different
month, and do not compare a different experiment, and present either as a version
change.

## Boundaries

- accuracy against actuals → **truegradient-forecast-accuracy**
- a single current value → **truegradient-forecast-lookup**
- risk ranking → **truegradient-forecast-risk**
- "who changed it" → **cannot be answered at all.** No authorship is recorded. Say
  so plainly rather than guessing from column names.

## References

- `../../references/LOCK-FAMILIES.md` — lock families and lags; why a lag
  difference is not a forecast change
- `../../references/SAFETY-CONTRACT.md` — §10 on causal claims
- `../../references/METRICS.md` — §5 change arithmetic
- `../../references/DATA-CONTRACT.md` — the forecast family table
- `../../references/COLUMN-DISCOVERY.md` — overlap checking
- `../../references/TOOL-GUIDE.md` — experiment resolution and fetch shapes
