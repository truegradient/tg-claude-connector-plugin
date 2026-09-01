# TrueGradient Connector Tool Guide

The five read-only tools, how to choose between them, and what their failures mean.

All five are read-only. None can modify TrueGradient data. Your company is never
an argument — it comes from your signed login token and is re-verified on every
data call, so reaching another company's data is structurally impossible.

---

## 1. The standard four-step flow

```
tg_whoami                              confirm who and which company
      ↓
tg_list_experiments_for_analysis        pick the experiment
      ↓
tg_resolve_datasets                     discover datasets, columns, grain
      ↓
tg_fetch_dataset                        read or compute
```

`tg_dataset_info` is an optional cheap probe between steps 3 and 4 when you need
row counts before planning a read.

Never skip step 3. It is the only way to learn the real column names, and column
names vary per workspace.

---

## 2. Tool reference

### 2.1 `tg_whoami`

**Args:** none.

**Returns:**
```json
{"authenticated": true, "company_id": "...", "company_name": "...",
 "user_id": "...", "email": "...", "granted_permissions": ["..."],
 "caller_type": "claude_user", "auth_type": "..."}
```

**When:** first call in any data conversation.

**Failure:** `{"authenticated": false, "error": "..."}` → stop entirely; tell the
user to connect the connector. Do not call other tools.

---

### 2.2 `tg_list_experiments_for_analysis`

**Args:**

| Arg | Type | Notes |
|---|---|---|
| `module` | string, optional | one of `demand-planning`, `inventory-optimization`, `pricing-promotion-optimization`. Omit to see all. |

**Returns:**
```json
{"company_id": "...", "module": "...", "known_modules": [...], "count": 3,
 "used_archived_fallback": false,
 "experiments": [{"id": "...", "label": "...", "exp_description": "...",
                  "module_name": "demand-planning", "tag": "...",
                  "createdAt": "...", "experimentStatus": "Completed",
                  "isProduction": false}]}
```

Newest first. Every entry is already `Completed`, not trashed, not archived.

**When:** always, before touching data. Pass `module: "demand-planning"` for
forecast questions to keep the list focused.

**Two responses that must change your answer:**

- **`used_archived_fallback: true`** — the workspace has **no live experiment**;
  these are archived. Lead your answer with that fact. Do not present archived
  data as current.
- **`count: 0`** with a `diagnostics` object — nothing passed the filter. Show the
  diagnostics and stop. **Never invent an experiment or any data.**

**Note on `isProduction`:** it is set when the experiment is created. It is **not**
a forecast approval or sign-off. Do not treat it as one.

---

### 2.3 `tg_resolve_datasets`

**Args:**

| Arg | Type | Notes |
|---|---|---|
| `experiment_ids` | list of strings | the ids you picked |
| `experiment_id` | string, optional | convenience for a single id; merged with the list |
| `tables` | list of strings, optional | restrict to specific dataset names |

**Returns:**
```json
{"requested_ids": [...], "resolved_count": 1,
 "experiments": [{"experiment_id": "...", "module_name": "demand-planning",
   "datasets": [{"table": "Final DA Data", "resolved": true,
                 "doc_summary": "...", "columns": ["...", "..."],
                 "sample_row": {...}}]}],
 "errors": [{"experiment_id": "...", "error": "..."}]}
```

**When:** always, before any read. `columns` is the **authoritative vocabulary** —
the only column names you may use anywhere.

**Do not filter the roster by module for forecast questions.** `module` filters on
the experiment's own label, and forecast data is not confined to
`demand-planning`: an IBP workspace labels every experiment
`inventory-optimization` and keeps `Final DA Data` inside those. Observed live:
`module="demand-planning"` returned `count: 0` with
`diagnostics.distinct_modules_seen: {"inventory-optimization": 18}`, while the
same workspace's `Final DA Data` carried 419 columns of Sales, lock families and
stored accuracy. Call the roster unfiltered and route on the datasets an
experiment actually resolves. A `count: 0` with a non-empty `raw_count` means the
filter dropped everything — read `dropped_by` before reporting no data.

The tool accepts multiple ids and resolves them in one backend fetch, but the
skills work on **one experiment at a time**: prior-cycle experiments are usually
absent from the live roster, so cross-cycle comparison is not supported. If you
do need to survey several live experiments, pass their ids in a single call
rather than making separate ones.

**Failures:**

- `resolved: false` with a `reason` → that dataset name has no mapping in this
  module. Pick another.
- `schema_error` on a dataset → the column probe failed. The dataset is still
  selectable, but you have **no column list**. Report that; do not guess columns.
- An entry in `errors[]` → that experiment id is not among your company's usable
  experiments. Re-list; never guess an id.

---

### 2.4 `tg_dataset_info`

**Args:** `experiment_id`, `dataset_name`.

**Returns:**
```json
{"experiment_id": "...", "dataset_name": "Final DA Data",
 "total_rows": 3200, "total_pages": 4, "page_size_limit": 1000,
 "columns": [...], "column_count": 632}
```

**When:** you need row counts before planning a read, or you want the column count
to confirm the dataset is wide.

`total_rows` / `total_pages` may be `null` if the engine reports no count — then
paginate until `has_more` is false.

---

### 2.5 `tg_fetch_dataset`

The workhorse. **Two modes, selected automatically from the arguments.**

| Arg | Type | Notes |
|---|---|---|
| `experiment_id` | string | required |
| `dataset_name` | string | required — the `table` value from `tg_resolve_datasets` |
| `page` | int | 1-based, plain mode only |
| `page_size` | int | default 50, **max 1000** |
| `filters` | list | `{"column","operator","value"}` or `"values"` for list/range operators |
| `group_by` | list | column names |
| `aggregations` | list | `{"function","column","alias"}` |
| `sort_by` | list | `{"column","direction"}`, or `"-col"` for desc |
| `having` | list | same shape as `filters`, applied after grouping |
| `select_columns` | list | project only these (plain reads) |
| `limit` | int | max rows for a computed read |
| `distinct` | bool | |

**Mode selection:** passing **any** of `filters`, `group_by`, `aggregations`,
`sort_by`, `select_columns`, `limit`, `distinct` switches to **computed mode**,
which returns the final result set rather than a page. Otherwise you get a plain
paginated read.

**Returns:**
```json
{"experiment_id": "...", "dataset_name": "...", "mode": "analytics",
 "page": 1, "page_size": 50, "returned": 12, "columns": [...],
 "rows": [{"col": "value"}], "has_more": false, "next_page": null,
 "total_rows": 3200}
```

`mode` is `"rows"` (plain) or `"analytics"` (computed).

**Operators:** `=` `!=` `>` `>=` `<` `<=` `contains` `not_contains`
`starts_with` `ends_with` `in` `not_in` `between` `not_between` `is_null`
`is_not_null`

**Aggregation functions that work:** `count` `sum` `avg` `min` `max`
`count_distinct` `median` `percentile` `stddev` `variance` `string_agg`

**`min` and `max` are unsafe on the stored metric columns.** Those columns come
back as strings, and `min`/`max` compare them as text, not numbers. Observed live
on `overall_accuracy` within the Critical zone: `min` returned `"-1.59"` and `max`
returned `"9.3"` while `avg` returned `-13.21` — impossible numerically, because
`"-1.59" < "-133.33"` lexicographically. `avg` and `sum` return proper numbers.
So: never use `min`/`max` to find a best or worst stored accuracy, bias or
contribution. Sort with `sort_by` and read the end rows, or pull the values and
compare them yourself after casting.

**Aggregation functions that are broken — never send:** `wmape` `accuracy`
`bias` `mape` `mae` `rmse` `sum_columns`. They validate but lose the
`actual_column` / `columns[]` they require. See `METRICS.md` §0.

`count` needs no `column`. `percentile` needs a `percentile` value between 0 and 1.

---

## 3. Operational rules that materially affect cost and correctness

**Rule 1 — never do an unfiltered plain read of `Final DA Data`.**
It can have 600+ columns. A default plain read returns 50 rows × every column and
will flood the conversation for no benefit. **Always** pass `select_columns` or
`aggregations`. A wide plain read is a design failure, not a slow path.

**Rule 2 — batch aggregations into one call.**
One call can carry many aggregations. Request every month's sums together rather
than one call per month. For 5 months × 3 columns that is one call, not fifteen.

**Rule 3 — detect truncation.**
In computed mode with no `limit`, if `returned == page_size` the result was
truncated and a larger `page_size` would show more. With an explicit `limit`,
`returned == limit` is the intended size, not truncation.

**Rule 4 — sort by an aggregation's alias** to rank groups. Sorting by a raw
column that isn't in the result shape will fail.

**Rule 5 — only use column names from `tg_resolve_datasets`.**
Never build a name from a calendar or a naming pattern. If `2024-10-31 Sales`
exists, that does **not** mean `2024-10-31 Locked ML Forecast Lag_4` exists.
Constructing names by pattern is a known, observed cause of `COLUMN_NOT_FOUND`.
Lock columns are the worst offender: `Locked ML Forecast Lag_4` and
`Lock ML Forecast Lag_4` are **different families** two characters apart, so a
name that is nearly right is not right. See `LOCK-FAMILIES.md` §3.

**Rule 6 — quote column names exactly.** They contain spaces and vary in case
(`Region_name`, `channel_name`, `AB_Class`, `2026-07-31 Locked ML Forecast Lag_4`).
Copy them verbatim from the live list.

**Rule 7 — prefer server-side computation.** Push filtering, grouping and
aggregation into the tool. Do not pull rows to count them yourself.

---

## 4. Tools you must not call

`tg_fetch_csv_file` and `tg_execute_code` are internal-service-only. They are
blocked for Claude users at the server and will return:

```
'<tool>' is a private internal-service tool; it is not available to
caller_type='claude_user'.
```

That denial is **correct behaviour**. Do not attempt these tools, and do not try
to route around the restriction. If a user asks for arbitrary code execution
against their data, explain that the connector deliberately exposes only
structured read tools.

---

## 5. Error reference

Tools return errors as JSON **inside a successful response** — as
`{"error": "...", "status_code": ..., "debug": ...}` — not as exceptions. Always
check for an `error` key before using a result.

| Signal | Meaning | Correct response |
|---|---|---|
| `{"authenticated": false}` | connector not authenticated | stop; give reconnect steps; produce no numbers |
| `experiment '<id>' not found among your company's experiments` | bad id, or archived/trashed/not Completed | re-list experiments; never guess an id |
| `unknown dataset '<name>' for this experiment's module` | bad dataset name | use a `table` value from `tg_resolve_datasets` |
| `unknown module '<x>'` + `known_modules` | bad module filter | use one of the listed modules |
| `count: 0` + `diagnostics` | nothing passed the server filter | show diagnostics; **never invent data** |
| `used_archived_fallback: true` | no live experiments exist | lead with the archived caveat |
| `schema_error` on a dataset | column probe failed | report it; do not guess columns |
| `experiment_ids is required` | no id supplied | supply ids from the roster |
| `page and page_size must be integers` / `page is 1-based and must be >= 1` | bad paging | fix and retry |
| `<x>.function '<f>' is not supported` | bad aggregation function | use a working function from §2.5 |
| `is a private internal-service tool` | blocked tool attempted | do not retry — this is correct |
| Query-engine network or status error | upstream issue | report it plainly; do not retry in a loop |

---

## 6. Worked example — accuracy by category

**Goal:** accuracy per category over all eligible months.

```
1. tg_whoami
   → company_name "Acme Foods"

2. tg_list_experiments_for_analysis()          # unfiltered — see below
   → experiments[0] = {id: "exp_912", label: "Aug 2026 cycle",
                       createdAt: "2026-08-01", experimentStatus: "Completed"}
   → used_archived_fallback: false          ✓ live data

3. tg_resolve_datasets(experiment_ids=["exp_912"])
   → Final DA Data columns include:
       product_variant_code, channel_name, Region_name, Category, AB_Class
       2024-08-31 Sales ... 2026-07-31 Sales            (24 months)
       2026-03-31 Locked ML Forecast Lag_4 ... 2026-07-31 ...  (5 months only)
       2026-03-31 Locked ML Forecast Lag_4 Abs Error ... (5)
   → global lock (`Locked`) at Lag_4 is the default baseline; no secondary
     `Lock ...` or `Multi_Lock ...` family present in this example

4. Build the eligible set.
   Paired months: 2026-03-31, 04-30, 05-31, 06-30, 07-31
   Today is 2026-08-03 → current month is 2026-08 → nothing to drop for that.
   Eligible = those 5 months. 19 Sales months have no baseline → excluded.

5. tg_fetch_dataset(
     experiment_id="exp_912",
     dataset_name="Final DA Data",
     group_by=["Category"],
     aggregations=[ 15 sum entries: a_/f_/e_ per eligible month ],
     page_size=1000)

6. Per category, per month: no month is skipped — a zero baseline and a zero
   actual are both real errors that belong in the pooled sums.
   err = Σ(abs error) when > 0, else |Σactual − Σbaseline|.
   accuracy = (1 − Σerr/Σact) * 100      — 1 − WMAPE; may be negative
   undefined only if Σact == 0 across the whole window

7. Answer, with the window stated, months excluded listed, and the
   provenance footer.
```

**What this example must never do:** request `2025-01-31 Locked ML Forecast Lag_4`
— that column does not exist. Only the 5 real baseline months are usable. Nor may
it fill the gap with a secondary `Lock ...` family at a different lag.
