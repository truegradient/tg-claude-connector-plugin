# TrueGradient Planning Analysis — Claude Plugin

Five skills that make Claude answer demand, supply and inventory questions from
**final, approved TrueGradient data only** — with the right metric definitions,
the right column families, and explicit provenance on every answer.

Version 1.0.0

---

## What this plugin is

A set of **instructions** for Claude. It contains no data, no credentials, and no
executable code.

It works alongside the **TrueGradient AI connector**, which is a separate service
that provides the read-only tools Claude uses to fetch data. The connector does
the fetching; this plugin makes Claude use it correctly.

| | |
|---|---|
| **The plugin does** | give Claude planning procedures, metric formulas and safety rules |
| **The plugin does not** | fetch data, authenticate anyone, or store anything |
| **The connector does** | fetch your company's data, read-only, scoped to your login |
| **You do** | sign in once through Settings → Connectors |

**No API keys or secrets are involved anywhere.** Authentication is interactive and
per person.

---

## The five skills

| Skill | Answers |
|---|---|
| `truegradient-forecast-lookup` | "What is the forecast for SKU X next month?" — with its uncertainty range |
| `truegradient-forecast-accuracy` | "How accurate have we been? What's our bias? Which categories are worsening?" |
| `truegradient-forecast-risk` | "Which items carry the most forecast risk? Where should planners focus?" |
| `truegradient-forecast-change` | "What changed between the locked baseline and the current forecast?" |
| `truegradient-supply-inventory` | "How does inventory look month on month? When do we run out? What should I reorder? Where's my excess?" |

Claude picks the right one from your question. You can also name a skill directly.

### How the supply skill routes

Supply and inventory answers come from one of two datasets, and which one is the
whole ballgame:

| Your question | Dataset |
|---|---|
| anything with a **time axis** — month on month, when do we run out, future cover | `Supply Plan` (time-phased) |
| anything **as of now** — stock on hand, total inventory, reorder now, excess, policy | `DOI Details` (snapshot) |

If a question needs both, Claude reads both and says so. The footer always names
which dataset and which measures produced the number.

---

## For the organization admin

### 1. Upload the plugin

1. Claude → **Organization settings → Plugins → Upload a file**
2. Select `truegradient-forecast-plugin-1.0.0.zip`
3. Confirm **five skills** are detected
4. Choose an availability level:

| Level | Behaviour | Recommendation |
|---|---|---|
| Available for install | members opt in | **Start here** — let a pilot group validate against real data |
| Installed by default | present for everyone, removable | move here once the pilot passes `TEST-CHECKLIST.md` |
| Required | present, not removable | only if forecast answers must always be governed by these rules |

### 2. Add the connector — do this too

**The plugin alone does not grant data access.** Add the connector at the
organization level:

1. **Organization settings → Connectors → Add custom connector**
2. URL: `https://mcp-server.truegradient.ai/mcp`
3. Save

Do this regardless of the plugin upload. The plugin ships a `.mcp.json` declaring
the same URL, which some Claude surfaces can pick up automatically — but the org
connector is the reliable path, and the skills are built to fail safely (refusing
to produce numbers) if the tools are absent.

### 3. Security notes for review

- **Read-only.** Every connector tool is read-only. Nothing can modify TrueGradient data.
- **Company isolation is structural.** Tools take no company identifier. Your
  company comes from the signed login token and is re-verified on every data call.
- **OAuth 2.1 with mandatory PKCE.** Members sign in with Google through
  TrueGradient's identity gateway. The connector never sees a password.
- **No secrets in this ZIP.** It is text only — verify with
  `grep -rniE 'api[_-]?key|secret|password|bearer' .`
- **No customer data in this ZIP.** No rows, no values, no identifiers, no
  workspace names.

---

## For members

### Install and connect

1. **Settings → Plugins** → find **TrueGradient Forecast Analysis** → Install
   *(skip if your admin installed it by default)*
2. **Settings → Connectors** → **TrueGradient AI** → **Connect**
3. Sign in with Google and choose your company
4. Verify: ask **"Who am I in TrueGradient?"** — you should see your company name

### Try it

```
Who am I in TrueGradient?
What TrueGradient experiments can I analyse?
What's the final forecast for <a real SKU or category> next month?
How accurate has our forecast been over the last few months?
Which categories carry the most forecast risk?
What changed between the locked baseline and the current forecast?
How does inventory for <a real SKU> look month on month?
When is <a real SKU> projected to run out?
What should I reorder now, and how much capital is tied up in excess?
```

### What good answers look like

Every substantive answer ends with a provenance block:

```
Source
  Company:     Acme Foods
  Experiment:  Aug 2026 cycle (exp_912) — Completed, created 2026-08-01
  Dataset:     Final DA Data
  Forecast:    Locked ML Forecast Lag_4 (global lock, lag 4)
  Actual:      Sales
  Period(s):   2026-03-31 .. 2026-07-31 (5 eligible months)
  Caveats:     19 months excluded for missing baseline
```

Read it. It tells you exactly which version of which data produced the number —
which matters, because TrueGradient has no single "approved" flag (see below).

---

## Which baseline accuracy is measured against

**Every number Claude calculates is measured against the global lock**,
`Locked ML Forecast Lag_N`. TrueGradient freezes forecasts into several lock
families, but only one of them is a metric basis:

| Family | What it is | Role |
|---|---|---|
| `Locked ML Forecast Lag_N` | the **global / primary lock** | **every calculation** |
| `Lock ML Forecast Lag_N` | a **secondary, per-lag lock** | shown if you ask; never calculated on |
| `Multi_Lock ...` | forecast locked for the rest of the year from one experiment | shown if you ask; never calculated on |

Three things worth knowing as a reader:

- **`Lock` and `Locked` are different families, not spellings of each other.** All
  of them use the same ` Lag_N` suffix, so the leading word is the only thing that
  tells them apart. Claude anchors on it deliberately, because a loose match for
  "Lock" would also catch "Locked".
- **Naming a secondary lock does not move the calculation.** Claude will read and
  show it beside the global lock, labelled — but any accuracy or bias Claude
  *computes* stays on the global lock. Ask for a secondary lock's *values*, not its
  *accuracy*. Figures the workspace itself stored (`rolling_accuracy`,
  `overall_accuracy`, `trust_zone`) carry no lag token, so Claude quotes them as
  precomputed rather than attributing them to a lock and lag.
- **The lag matters.** `Lag_N` means the forecast was frozen N periods before the
  period it predicts, so a lower lag will usually look more accurate. Claude keeps
  a single lag per figure and names it in the footer. If an accuracy number moves
  between reports, check the lag before concluding the forecast changed.

---

## How "final data" is defined — and its limitation

Data is treated as final only when all three hold:

1. the experiment passed TrueGradient's server-side gate — Completed, not trashed,
   not archived;
2. the dataset is `Final DA Data` (units) or `Final DA Data Value` (money);
3. the forecast column family is named explicitly in the answer.

**Known limitation, stated plainly:** TrueGradient has no explicit approval,
publication or version field for forecast data. "Final" is a convention, not a
flag that can be tested. If your workspace keeps a draft and an approved forecast
in two separate Completed experiments, nothing in the data distinguishes them —
Claude will use the newest and tell you which one it used.

That is why the provenance footer is mandatory: it turns an unverifiable claim into
one you can check at a glance. If the experiment named in the footer is not the one
you meant, name the one you want in your question.

---

## Guarantees the skills enforce

- Final data only — never draft, partial or unverified
- The workspace is identified before any private data is read
- Data version and freshness are always stated; archived-only data is flagged loudly
- Accuracy is always measured against the **global lock**, with the family and lag
  named — never against an edited forecast, never against a secondary lock, never
  blending lags
- Point forecasts always carry their uncertainty interval when one exists
- Inventory balances are never "reconciled" — end inventory is floored at zero per
  SKU, so shortfalls are read from the loss fields, never inferred by subtraction
- Recommended supply is never added to committed supply, and reorder placement is
  never confused with reorder arrival
- Stock-risk and trust labels are quoted from the data, never derived
- Missing values are reported as missing — **never** as zero, never interpolated
- Causes of forecast changes are never asserted without evidence
- Facts, calculations and recommendations are labelled separately
- Insufficient evidence produces a clear "cannot determine", not a guess
- Trust-zone labels are never invented — thresholds are workspace config that no
  tool can read, so raw accuracy is reported instead

---

## Troubleshooting

**Skills don't trigger**
Confirm the plugin is installed for your account, not merely uploaded by your
admin. You can name a skill explicitly: "use the TrueGradient forecast accuracy
skill". Phrasing matters — "sales numbers" may not read as a forecasting question;
try "forecast".

**No TrueGradient tools available**
Settings → Connectors → is **TrueGradient AI** listed and connected? If not, add
`https://mcp-server.truegradient.ai/mcp`. The skills should already be telling you
they have no data access — **if a skill produced numbers with no connector, that is
a critical bug; please report it.**

**Authentication fails**
Re-run Connect. Your Google account must be known to TrueGradient. Sessions last up
to 60 days, then need reconnecting. A "reuse detected" style failure means the token
family was invalidated for safety — disconnect fully, then reconnect.

**"Only archived experiments available"**
Your workspace has no live Completed experiment. Fix that in TrueGradient; Claude is
reporting the situation correctly.

**Inventory numbers don't add up**
They are not meant to. `End Inventory` is clamped at zero for every SKU, so any
demand you could not serve is dropped rather than carried as a negative — which
means the columns will not reconcile, especially once summed across SKUs. The plan
is also simulated daily inside each period bucket. Read unmet demand from the
sales-loss fields instead. Claude should be explaining this rather than producing
a reconciliation; if it produces one, that is a bug.

**A reorder number looks too high**
Check whether it is pre- or post-transfer. `TG Reorder now` is before the transfer
model has moved existing stock; `updated_TG_Reorder_now` is after. Claude should
default to the post-transfer figure and name it. The footer tells you which was
used.

**Accuracy figures look wrong or low**
Check the month window in the footer. The current month is kept out of the pooled
figure — it is month-to-date against a full-month forecast — though it is still
shown separately as a partial point. Months without a column for the chosen lock
family are skipped — often most of them. Check the lag named in the footer too: a figure measured against the global
lock at Lag_4 is not comparable with one at Lag_2.
Also note this "accuracy" is `(1 − WMAPE) × 100`, where **higher is better** — the
opposite direction from WMAPE and MAPE themselves. It has no floor: a group whose
absolute error exceeds its actuals gets a **negative** accuracy, which is a real
result, not a bug.

**Support:** support@truegradient.ai

---

## Packaging for upload

```bash
./scripts/package.sh        # → dist/tg-claude-connector-plugin-<version>.zip
```

**The plugin root must be the archive root.** `.claude-plugin/plugin.json` has to
sit at the top level of the zip with `references/` and `skills/` beside it. An
archive with a wrapper directory does not load.

That is why **GitHub's "Download ZIP" button cannot be used to install this
plugin** — it wraps everything in `tg-claude-connector-plugin-<branch>/`. Anyone
who downloads that way and uploads it will get a load failure. Distribute the
archive `scripts/package.sh` builds, attached to a tagged release, and point
people at that asset rather than at the repo's ZIP link.

`package.sh` runs `verify-plugin.sh` first and then refuses to emit an archive
that has a wrapper directory, is missing `references/` or `skills/`, does not
carry exactly five `skills/*/SKILL.md` files, or contains `__MACOSX` /
`.DS_Store` entries. Local-only files (`.claude/`, `.gitignore`, `.git/`) are
excluded.

---

## Releasing

The version of record is `version` in `.claude-plugin/plugin.json`. Three places
must agree, and `scripts/verify-plugin.sh` fails the push if they drift:

| Where | What it must say |
|---|---|
| `.claude-plugin/plugin.json` | `"version": "X.Y.Z"` |
| `README.md` | the `Version X.Y.Z` line near the top |
| `CHANGELOG.md` | newest `## X.Y.Z — YYYY-MM-DD` heading |

Semver, read for a plugin made of prompts rather than code:

- **patch** — wording, examples, a clarified rule that does not change what Claude
  is allowed to answer.
- **minor** — a new skill, a new capability, or a rule that lets Claude answer
  something it previously declined.
- **major** — a metric definition changes, or a rule that previously forbade
  something now permits it (or the reverse). Anyone comparing figures across the
  boundary needs to know. An accuracy-formula correction is the shape of change
  that would justify one.

Before pushing:

```bash
./scripts/verify-plugin.sh          # must exit 0
git tag -a v1.0.0 -m "1.0.0"        # tag matches plugin.json exactly
```

`TEST-CHECKLIST.md` is the acceptance gate for a release against a real
workspace. Any test marked **Fail (critical)** blocks promotion.

---

## Contents

```
.claude-plugin/plugin.json     manifest — the version of record
.mcp.json                      connector declaration (best-effort)
.gitignore                     excludes .claude/settings.local.json and archives
LICENSE                        proprietary notice
README.md                      this file
CHANGELOG.md
TEST-CHECKLIST.md              55 acceptance tests (10 groups)
scripts/verify-plugin.sh       pre-push checks: versions, descriptions,
                               cross-references, rules that must not regress
scripts/package.sh             builds the upload archive; refuses a bad layout
references/
  SAFETY-CONTRACT.md           the hard rules, loaded by every skill
  DATA-CONTRACT.md             column families, grain, what varies per workspace
  COLUMN-DISCOVERY.md          runtime discovery, the AB-class rule
  METRICS.md                   exact formulas matching the TrueGradient app
  TOOL-GUIDE.md                the 5 tools: args, shapes, errors, worked example
  SUPPLY-DATA-CONTRACT.md      supply/inventory datasets, routing rule, traps
  LOCK-FAMILIES.md             lock families, lags, baseline selection
  COLUMN-SEMANTICS.md          what each column MEANS and which one to pick
skills/
  truegradient-forecast-lookup/SKILL.md
  truegradient-forecast-accuracy/SKILL.md
  truegradient-forecast-risk/SKILL.md
  truegradient-forecast-change/SKILL.md
  truegradient-supply-inventory/SKILL.md
```
