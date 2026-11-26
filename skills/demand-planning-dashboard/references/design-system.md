# Design system

Direction taken from the reference screenshots: a quiet, warm-dark "planning desk" —
olive-brown surfaces, a serif for titles, a plain sans for data, mint for good /
over-performance, clay-orange for shortfalls, periwinkle-blue for ahead/excess.
Numbers are the hero; chrome stays low-contrast. Light mode is the same system on
paper-white, not an inverted afterthought.

## Tokens

Define on `:root` (light), redefine under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }`
and again under `:root[data-theme="dark"]`. Every colour in CSS and charts reads a token.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#1d1b15` | `#f5f3ec` | page |
| `--surface` | `#25231b` | `#fffdf8` | cards |
| `--surface-2` | `#2d2a21` | `#efece2` | table header, inputs |
| `--border` | `#3b372b` | `#ddd8c9` | hairlines |
| `--text` | `#ece6d5` | `#24221b` | primary text |
| `--muted` | `#a39b85` | `#5f5a4d` | labels, captions (on surfaces only) |
| `--accent` | `#72d0ae` | `#1f8f6a` | active tab, primary button, good, over-performance |
| `--accent-ink` | `#10241c` | `#ffffff` | text on accent |
| `--warn` | `#e3925f` | `#b85a2c` | under-performance, behind, over-forecast bias |
| `--info` | `#7f9cf0` | `#3a5fc4` | ahead of pace, excess, under-forecast bias |
| `--caution` | `#d9b35a` | `#9a7516` | near pace, review |
| `--bad` | `#e06a6a` | `#b63b3b` | stock-out, critical |
| `--grid` | `rgba(236,230,213,.08)` | `rgba(36,34,27,.08)` | chart grid |

Chart series palette (consistent across tabs):
Actuals `--accent` · LY Sales `--muted` · Locked ML Lag-1 `#c9a27a`/`#8a6a43` ·
ML Forecast `--info` · Consensus Forecast `--warn` · RL Unconstrained `#b48ee0`/`#7a52b3` ·
P10–P90 band = Consensus colour at 14% opacity.

Risk pills: StockOut `--bad`, CriticalStock `--warn`, LowInventory `--caution`,
Stable `--accent`, ExcessStock `--info`.

## Type

- Titles (page title, card titles): **Source Serif 4**, 600, from Google Fonts,
  fallback `Georgia, "Times New Roman", serif`.
- Everything else: **IBM Plex Sans** 400/500/600, fallback
  `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Numbers: `font-variant-numeric: tabular-nums;` everywhere data appears.
- Scale: 12 (captions, table header) · 13 (table body) · 14 (body) · 16 (card title) ·
  22 (page title) · 28 (KPI value) · 40 (gauge value).
- Labels in sentence case. Table headers may use small caps via
  `font-variant-caps: all-small-caps; letter-spacing: .04em` — not ALL CAPS strings.

## Design principles (apply on every tab)

1. **Nothing floats on the canvas.** `--bg` is only the gap between surfaces. Every piece
   of text — status lines ("✓ Matches TrueGradient …"), the accuracy-basis chips, notes,
   control labels — sits on a `--surface` panel with a border. Muted grey text loose on
   `--bg` reads as sinking into the background; don't ship it.
   - Filter bar and the tab's control row are surface **panels** (10px radius, 12px 14px padding).
   - Status and basis lines go in one **context strip** (`ctxStrip()` → `<section class="ctx">`),
     rows divided by a hairline, text in `--text`; the strip's lead labels are 600 weight.
     Error states stay outside the strip as their own block.
   - Safety net: any `.note`, `<p>` or chip row placed straight in a tab body gets a surface.
   - Inside cards, `--muted` is fine for subtitles and captions.
2. **Controls size to their content, then fill the row.** Filter bar and control rows are
   flex-wrap rows, not fixed grid columns: each field's basis is its own content
   (`flex: 1 1 auto`, min 150px, max 480px), so a long value (e.g. "Locked ML Forecast Lag_4")
   is never truncated while short ones stretch. Segmented controls (Months shown, View,
   Top N) take their natural width (`flex: 0 0 auto`), never scroll inside, and wrap only
   when the screen is narrower than the control.
3. **Lists are chips.** Any multi-value item (ts_id columns, models, drivers, datasets,
   mappings, the accuracy basis) renders as `.tag` pills — label + muted small text — never as
   a comma- or "·"-joined sentence.
4. **Show an experiment the way TrueGradient lists it — never as one appended string.**
   Wherever a run appears (source drawer, header badge tooltip, run pickers, compared-runs table):
   - **Name** (600 weight) + chips: Current source (highlighted), Live / Archived (amber),
     Production, frequency (Monthly / Weekly / Daily).
   - **Experiment ID** in monospace, selectable, with a copy button (`idEl`).
   - **Tag** (pipeline) chip and **Module** chip (accent text).
   - **Created at** and **Updated at** as two-line timestamps — "Nov 4, 2026" over "10:24:32 AM"
     in the viewer's local time (`whenEl`), from the roster's `createdAt` / `updatedAt`
     (`updated_at`); "—" when missing, never a date-only fallback dressed as a time.
   - Pickers listing runs use rich options (`runOption`: name + chips / ID / tag · module ·
     created · updated), are ≥ 560px wide, search name, ID, tag and module, and show their prompt
     ("Choose from n runs…") as a header, not as a selectable option.
   - Tables of runs use TrueGradient's columns: Experiment (name, ID, chips) · Tag · Module ·
     Created at · Updated at · then the tab's own columns.
5. **Dates read like TrueGradient everywhere:** "Nov 4, 2026" (`dayLab`) in every label, chip,
   badge and tooltip; ISO `YYYY-MM-DD` only inside date inputs and data. Frequencies by name
   ("Monthly"), never codes ("M", "W-SUN").
6. **One hierarchy per screen:** panel (filters) → panel (controls) → context strip → KPI
   tiles → cards. Equal 12px gaps between them; no extra rules or dividers on the canvas.
6b. **Explain in place, briefly.** How a number is calculated goes in an ⓘ beside it — KPI label or table
   column header — never in a paragraph above a table. Card subtitles are one short line.
7. **A KPI row is one line on desktop — never a lone tile below.** `.kpis` columns =
   the row's tile count (`--n`, set at render) above 1100px; 1100–640px splits evenly
   (`--n2 = ceil(n/2)`, e.g. 7 → 4 + 3); under 640px two per line with an odd last tile spanning
   the row; one per line under 400px. Rows of 6+ tiles are "dense" (smaller padding and value
   size). Labels never wrap: keep them short ("Stock-outs", not "Projected stock-outs" — the
   detail goes in the qualifier line), ellipsis + title as a last resort.
8. **Check it rendered.** Before publishing, render each tab at 1440px and ~900px and confirm:
   no element in `#main` with text has a transparent background, no `.seg` has
   `scrollWidth > clientWidth`, no control label is truncated, and every KPI row is a single
   line at 1280px.

## Layout

- Max content width 1440px; **10px** radius on cards, 6px on
  inputs/pills, 1px `--border`, no drop shadows (dark) / a single 0 1px 0 hairline (light).
- 24px page gutters (16px < 720px), 16px card padding, 12px gaps in KPI rows.
- Filter bar and control row: surface panels, `display:flex; flex-wrap:wrap; gap:10px 14px`
  (principle 2). One field per line under 420px. Segmented-control buttons never wrap their label.
- Tables: inside `overflow-x:auto` wrappers; sticky header and first column.
- Respect safe-area insets (viewport-fit=cover) as the publishing rules require.

## Components

- Segmented controls (Last 12 | Last 24 | All, Units | Revenue, Top N): pill group,
  active = accent fill + accent-ink text.
- Reload is an icon button (30px, 40px on touch) beside the connection pill, not a text
  button. "Clear filters": accent outline. Dropdowns: custom combobox button with 36px right
  padding and a drawn chevron.
- Tabs: text buttons, active underline 2px accent, muted otherwise; horizontally
  scrollable with fade edges on mobile.
- Tooltips: surface-2 background, 12px text, max 280px.
- Focus: 2px accent outline offset 2px on every interactive element.
- Motion: none on load; 150ms colour/opacity transitions on hover/active only;
  respect `prefers-reduced-motion`.

## Charts

Chart.js 4.4.1 UMD from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`).
Read colours from `getComputedStyle(document.documentElement)` at render and re-render
charts on theme change. Gauge is hand-drawn SVG (arcs + needle + marker). Grid lines
`--grid`, axes `--muted`, 11px ticks, no chart borders, legends as custom HTML
checkboxes (they double as series toggles).
