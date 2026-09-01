# Lock Families and Lags

Which frozen baseline every calculation runs on, how to tell the lock families
apart, and why a two-character misread produces a confidently wrong number.

> **The rule in one line: all metrics are computed on the global lock —
> `<date> Locked ML Forecast Lag_N`.** The families differ *only* in the leading
> word. `Locked` is global and primary. `Lock` is not.

---

## 1. The families

All lock columns share the **same suffix convention**. The only thing that
distinguishes the families is the leading word:

```
<date> Locked ML Forecast Lag_N        global / primary lock
<date> Lock ML Forecast Lag_N          secondary, per-lag lock
```

| Family | What it is | Role |
|---|---|---|
| **`Locked ...`** | the **global / primary lock** | **the sole basis for every calculation** |
| **`Lock ...`** | a **secondary, per-lag lock** — one per additional lag the workspace configured | readable on request; never a metric basis |
| **`Multi_Lock ...`** | forecast locked for the remainder of the year from a single experiment | readable on request; never a metric basis |

**`Locked` is not a longer spelling of `Lock`.** They are separate families whose
names happen to overlap. A workspace that configures extra lags gets
`Lock ML Forecast Lag_2`, `Lock ML Forecast Lag_3` and so on **alongside** its
global `Locked ML Forecast Lag_N`.

---

## 2. Calculations run on the global lock only

Accuracy, bias, error, deviation, risk ranking, contribution — every computed
metric — uses the **global lock** and nothing else.

1. Find the `Locked ...` family. That is the baseline. There is no choice to make
   and no default to fall back from.
2. Pair it with `<date> Sales` and, when present, its **own**
   `... Lag_N Abs Error` column.
3. **Never compute a metric on a `Lock ...` or `Multi_Lock ...` family**, even if
   the user names one. Those families exist so that they can be told apart from
   the global lock and kept out of it.
4. If a user explicitly asks about a secondary lock, you may **read and show its
   values** side by side with the global lock — clearly labelled as a secondary
   lock and **not** the calculation basis. Say plainly that metrics are computed
   on the global lock.
5. If **no** `Locked ...` family exists, no accuracy or bias figure can be
   produced. Say so, and list which lock families do exist. Never substitute one
   to manufacture a number, and never fall back to `Forecast`, `ML Forecast` or
   `Consensus Forecast` — none of those is frozen. A user who *asks for* a
   consensus figure may be given one on `Consensus Forecast`, labelled as not a
   frozen baseline (`METRICS.md` §1a); that is an answer to their question, not a
   substitute for the missing lock, and it is never called the workspace's
   accuracy.
6. **Always name the family and the lag** in the answer and the provenance footer:
   "78% against the global lock at Lag_4", never "78%".

> If several `Locked ...` lags exist, do not pick silently: report which lags are
> available, use the one with the widest paired coverage, say which you used and
> why, and offer the alternatives. Never blend lags into one figure.

---

## 3. The two-character trap

Because the suffixes are identical, `Locked ML Forecast Lag_4` and
`Lock ML Forecast Lag_4` differ by exactly two characters — and `Lock` is a
**prefix of** `Locked`, so loose matching captures both families:

| Test | `Locked ML Forecast Lag_4` | `Lock ML Forecast Lag_4` |
|---|---|---|
| `contains "Lock"` | **yes** | yes |
| `starts_with "Lock"` | **yes** | yes |
| `starts_with "Lock "` *(trailing space)* | no | yes |
| `starts_with "Locked "` | yes | no |

**Anchor on the trailing space.** `Lock ` cannot match `Locked ML ...`, because the
character after `Lock` is `e`, not a space. So:

```
family startswith "Locked "     -> GLOBAL      <- every calculation
family startswith "Multi_Lock " -> MULTI-PERIOD
family startswith "Lock "       -> SECONDARY
```

A bare `contains "Lock"` — in a filter, a family match, or a column scan — is the
one mistake that silently folds secondary locks into a global-lock answer. It is
also invisible: nothing errors, and the number looks reasonable.

---

## 4. The lag suffix

`Lag_N` means the forecast was frozen **N periods before the period it
predicts**. A lower lag is a shorter horizon and will usually look more accurate,
because the forecast had more information when it was frozen.

The suffix is uniform across families: a single space, then `Lag_`, then the
number.

```
Locked ML Forecast Lag_4        global lock, lag 4
Lock ML Forecast Lag_2          secondary lock, lag 2
```

Rules:

- **One lag per figure.** Never average months from different lags.
- **A lag difference is not a forecast change.** If two accuracy figures were
  measured at different lags, the difference is a horizon effect. Say so; never
  attribute it to demand, the model or a planner.
- Comparing lags **on purpose** is legitimate — it shows how quality decays with
  horizon. Label it a horizon comparison, name both lags, and note that only the
  global lock's figure is a computed metric.
- Even though the convention is uniform, **copy column names verbatim from the
  live list**. That is rule zero in `COLUMN-DISCOVERY.md` and it still applies: a
  lag that exists for one family or month may not exist for another.

---

## 5. Derived columns inherit family and lag

Error, deviation and risk columns are generated per family **and** per lag:

```
<date> Locked ML Forecast Lag_N Abs Error
<date> Deviation Locked Lag_N
Risk_Locked_Lag_N_<date>
```

**Pair only within the global lock and a single lag.** Using a Lag_4 absolute
error as the numerator for a Lag_2 forecast is arithmetically valid and completely
meaningless — nothing errors, and the result is wrong. This is the most dangerous
failure mode in this document, because it is silent.

Before computing, verify that the actual, the forecast and the error column all
name the **same** family and the **same** lag.

`<date> Bias`, `<date> Accuracy`, `overall_accuracy` and `rolling_accuracy` carry
**no family or lag token**. Which lock produced them is not recoverable from the
column name. Quote them as precomputed, and do not claim they are the global lock
unless something in the data says so.

---

## 6. `Multi_Lock`

A `Multi_Lock` family is frozen once and covers the **rest of the year**, so the
distance between the lock event and the target period **grows across the
horizon**: an early month is a short horizon, a December month may be many
periods out.

- It is **not** a calculation basis (§2). Metrics stay on the global lock.
- Do not report "the lag" for it; horizon distance varies by target month.
- If asked to show it, prefer a **per-month** view over one blended number, so the
  horizon effect stays visible, and say it is not comparable with a fixed-lag
  figure.

---

## 7. Discovery procedure

Run this after `tg_resolve_datasets`, before any calculation.

```
1. Split every column on  ^(\d{4}-\d{2}-\d{2})\s+(.+)$
       -> (month, family)

2. Classify each distinct family by its leading word, anchored on the space:
       startswith "Locked "     -> global        <- the calculation basis
       startswith "Multi_Lock " -> multi-period
       startswith "Lock "       -> secondary
       otherwise                -> not a lock family

3. Extract the lag with  Lag_(\d+)$
       no match -> a legacy unsuffixed column; record the lag as "unstated"

4. Build:  family -> lag -> [months covered]

5. Take the global lock. Keep ONE lag (widest paired coverage if several,
   disclosed per section 2).

6. Pair that family+lag with "<date> Sales" and its own Abs Error column.

7. Report the family, the lag, the month window and every excluded month.
```

Expect ragged coverage: the global lock routinely covers far fewer months than
`Sales`. That bounds how much history is measurable and must be reported.

---

## 8. Migration note

Workspaces created before this schema change may still carry a bare
`Locked ML Forecast` with no lag suffix. Both forms may coexist.

- A bare `Locked ML Forecast` is the global lock with an **unstated** lag. Use it,
  and say the lag is not recorded in the column name.
- Never treat a bare column and a `Lag_N` column as the same series, and never
  concatenate their months into one window.
- Only the live column list tells you which form this workspace uses. Older
  examples elsewhere in this plugin show the bare form; the live list overrides
  them every time.

---

## 9. Provenance of this document

- The `Locked ML Forecast Lag_4` form, its `Abs Error`,
  `Deviation Locked Lag_4` and `Risk_Locked_Lag_4_<date>` companions, and the
  absence of family/lag tokens on `Bias`, `Accuracy`, `overall_accuracy` and
  `rolling_accuracy`: read from a live workspace via `tg_resolve_datasets`.
- The family taxonomy, `Locked` as the global and primary lock, the secondary
  `Lock ... Lag_N` families, `Multi_Lock` as the rest-of-year lock, the uniform
  `Lag_N` suffix convention across families, and the instruction that **all
  calculations run on the global lock**: specified by TrueGradient.
- Only the global lock has been observed in a live export. The secondary and
  multi-period families are documented from specification. `Multi_Lock`'s suffix
  convention in particular is unconfirmed — classify it by its leading word and
  read its lag from the live list rather than assuming one.
- The varying-horizon behaviour in section 6 is reasoning from the definition, not
  a measurement. Treat it as guidance and disclose it as such.
- No customer row values, identifiers or workspace names appear here.
