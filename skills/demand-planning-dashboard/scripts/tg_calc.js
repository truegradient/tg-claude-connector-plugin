/*
 * tg_calc.js — calculation module for the TrueGradient Demand Planning Dashboard.
 * Single source of truth for formulas (see references/calculations.md).
 * Pure functions, no DOM, no network. Works in the browser (window.tgCalc) and Node.
 * Inline this file verbatim into the artifact; tab code must call these functions.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.tgCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- constants (edit here, nowhere else) ----------
  const T = {
    PACE_BEHIND: 0.85, PACE_NEAR: 0.95, PACE_AHEAD: 1.05, PACE_STALE_DAYS: 2,
    ABC_A: 80, ABC_B: 95, XYZ_X: 0.5, XYZ_Y: 1.0,
    Z_SPIKE: 2.5, MIN_BASE: 10, CLIFF_LOW: 0.5, CLIFF_HIGH: 2.0,
    SWING: 1.0, SWING_LY_TOL: 0.5, ACC_FLOOR: 30, IMPORTANT_CONTRIB: 1.0,
    STREAK_LOOKBACK: 3, YOY_MIN_BASE_UNITS: 50, YOY_MIN_BASE_VALUE: 500,
    DROP_PTS: 10, ROLLING_N: 3, GRAN_MAX_COLS: Infinity,
  };
  /** The forecast measure accuracy is scored on for the current run (§4.12). Starts as Lag_1; parseColumns picks the
   *  run's column (original "Locked ML Forecast", else "… Lag_<global_lag_n>") and applyAccuracyBasis confirms it
   *  has positive mass, else switches to the validation-period fallback. Read through C.LOCKED (a live getter). */
  const LOCKED_DEFAULT = "Locked ML Forecast Lag_1";
  let LOCKED = LOCKED_DEFAULT;
  /** pseudo-measure: the run's stored per-ts_id overall_accuracy (validation fallback with no forecast columns) */
  const STORED = "@stored accuracy";
  /** pseudo-measures: TrueGradient's validation (test-split) prediction and actual from the Forecast Data dataset,
   *  joined onto Final DA rows (§4.12c). Scored instead of Sales when the basis is "forecastData". */
  const VALID = "@validation forecast", VALID_ACT = "@validation actual";
  const actOf = (fm) => (fm === VALID ? VALID_ACT : "Sales");
  const LOCK_RE = /^(?:Locked|Lock) ML Forecast(?: Lag_?(\d+))?$/i;
  const WAREHOUSE_REGION = {
    "WH_US_1": "United States", "FBA-US": "United States", "FBT-US": "United States",
    "WH_UK_1": "United Kingdom", "FBA-UK": "United Kingdom", "FBT-UK": "United Kingdom",
    "WH_ROW_1": "ROW",
  };
  const SUFFIX_CHANNEL = {
    SH_Sub: "Web store subscription", SH: "Web store", CS: "CS activities",
    TT: "Social shop", IO: "Influencer Order", FBA: "Marketplace",
  };
  const RISK_ORDER = ["StockOut", "CriticalStock", "LowInventory", "Stable", "ExcessStock"];

  // ---------- parsing ----------
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (/^(nan|none|null|undefined)$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const z = (v) => num(v) ?? 0;

  const COL_RE = /^(\d{4}-\d{2}-\d{2}) (.+)$/;
  /** columns -> { measures: {measure: [monthEnd...]}, history, current, future, locked } */
  function parseColumns(columns, opts) {
    const measures = {};
    for (const c of columns) {
      const m = COL_RE.exec(c);
      if (!m) continue;
      (measures[m[2]] = measures[m[2]] || new Set()).add(m[1]);
    }
    const sorted = {};
    for (const k in measures) sorted[k] = [...measures[k]].sort();
    const history = sorted["Raw Actual"] || [];
    const future = sorted["Forecast"] || [];
    const detected = detectGrain([...history, ...future]);
    const grain = (opts && opts.grain) || detected;
    // §4.12 accuracy basis. Window = every date with BOTH a Sales and a locked column, on or before
    // activity_end_date (else the last history date). Locked columns for later dates are "locked ahead".
    const acc = (opts && opts.accuracy) || {};
    const cutoff = acc.activityEnd || history[history.length - 1] || null;
    const salesDates = sorted["Sales"] || history;
    const closedSales = salesDates.filter((d) => !cutoff || d <= cutoff);
    const lagN = Number.isFinite(acc.lagN) ? acc.lagN : null;
    const cands = Object.keys(sorted).filter((m) => LOCK_RE.test(m)).map((m) => ({ measure: m, lag: LOCK_RE.exec(m)[1] == null ? null : Number(LOCK_RE.exec(m)[1]) }));
    const original = cands.find((x) => x.lag === null);
    const lagCol = cands.find((x) => x.lag !== null && x.lag === (lagN ?? 1))
      || (lagN === null ? cands.filter((x) => x.lag !== null).sort((a, b) => a.lag - b.lag)[0] : null);
    const lockedCandidates = [original, lagCol].filter(Boolean).map((x) => x.measure);
    const lockedMeasure = lockedCandidates[0] || LOCKED_DEFAULT;
    const paired = (m) => (sorted[m] || []).filter((d) => closedSales.includes(d));
    return {
      measures: sorted, history, future, grain, detectedGrain: detected, perYear: GRAIN[grain].perYear,
      current: future[0] || null,
      lockedMeasure, lockedCandidates, lagN, activityEnd: acc.activityEnd || null, cutoff, closedSales,
      rollingN: Number.isFinite(acc.rollingN) && acc.rollingN > 0 ? acc.rollingN : T.ROLLING_N, rollingFromConfig: Number.isFinite(acc.rollingN) && acc.rollingN > 0,
      validationHorizon: Number.isFinite(acc.validationHorizon) ? acc.validationHorizon : null,
      accPath: "locked", basisChecked: false,
      locked: paired(lockedMeasure),
      lockedAhead: (sorted[lockedMeasure] || []).filter((d) => !closedSales.includes(d)),
      latestClosed: history[history.length - 1] || null,
    };
  }
  /** §4.12 Confirm the accuracy basis on the loaded rows (mutates and returns cols):
   *  1. original "Locked ML Forecast", else the lag-N locked column — the first with any positive value in its
   *     window → path "locked" (window = paired Sales + locked dates ≤ activity end; rolling = last past_accuracy_horizon);
   *  2. neither has positive mass → validation fallback: window = latest validation_horizon Sales dates ≤ activity end
   *     (all of them if missing/0); forecast = dated "ML Forecast" in Final DA if it has positive mass there (path
   *     "validation"), else the run's stored per-ts_id overall_accuracy (path "stored"). On the fallback rolling = overall.
   *  opts.current → also make this the module's current measure (C.LOCKED). */
  function applyAccuracyBasis(rows, cols, opts) {
    if (!cols) return cols;
    const has = (m, ds) => { for (const r of rows) for (const d of ds) { const v = val(r, d, m); if (v !== null && v > 0) return true; } return false; };
    const paired = (m) => (cols.measures[m] || []).filter((d) => cols.closedSales.includes(d));
    let pick = null;
    for (const m of cols.lockedCandidates) { const ds = paired(m); if (ds.length && has(m, ds)) { pick = m; break; } }
    if (pick) {
      cols.accPath = "locked"; cols.lockedMeasure = pick; cols.locked = paired(pick);
      cols.lockedAhead = (cols.measures[pick] || []).filter((d) => !cols.closedSales.includes(d));
      cols.rollingN = cols.rollingFromConfig ? cols.rollingN : T.ROLLING_N;
    } else {
      const vh = cols.validationHorizon;
      const win = vh && vh > 0 ? cols.closedSales.slice(-vh) : cols.closedSales.slice();
      const ml = (cols.measures["ML Forecast"] || []).filter((d) => win.includes(d));
      const fd = opts && opts.forecastData ? win.filter((d) => (opts.forecastData.dates || []).includes(d)) : [];
      if (fd.length) { cols.accPath = "forecastData"; cols.lockedMeasure = VALID; cols.locked = fd; }
      else if (ml.length && has("ML Forecast", ml)) { cols.accPath = "validation"; cols.lockedMeasure = "ML Forecast"; cols.locked = ml; }
      else { cols.accPath = "stored"; cols.lockedMeasure = STORED; cols.locked = win; }
      cols.validationWindow = win; cols.lockedAhead = []; cols.rollingN = Math.max(1, cols.locked.length);   // rolling = overall
    }
    cols.basisChecked = true;
    if (opts && opts.current) LOCKED = cols.lockedMeasure;
    return cols;
  }
  /** §4.12c Join TrueGradient's Forecast Data (test split) onto Final DA rows: for each validation date d,
   *  row["<d> @validation forecast"] = pred and row["<d> @validation actual"] = actual (negative → 0, null → 0).
   *  Only series present in Final DA are scored. → { matched, unmatched, dates } */
  function applyForecastData(rows, fdRows, tsCols, dateCol, dates) {
    const key = (r) => tsCols.map((c) => String(r[c] ?? "")).join("|");
    const idx = new Map(rows.map((r) => [key(r), r]));
    let matched = 0, unmatched = 0; const seen = new Set();
    for (const f of fdRows || []) {
      if (String(f.split ?? "test").trim().toLowerCase() !== "test") continue;
      const d = String(f[dateCol] || "").slice(0, 10); if (!dates.includes(d)) continue;
      const r = idx.get(key(f)); if (!r) { unmatched++; continue; }
      const a = Math.max(0, num(f.actual) ?? 0), p = Math.max(0, num(f.pred) ?? 0);
      r[col(d, VALID)] = p; r[col(d, VALID_ACT)] = a; matched++; seen.add(d);
    }
    return { matched, unmatched, dates: dates.filter((d) => seen.has(d)) };
  }
  /** §4.12c per-ts_id validation accuracy and trust zone exactly as TrueGradient's Accuracy Deep Dive computes them:
   *  acc = 100 − (Σ|pred − actual| ÷ Σ actual) × 100 over the validation dates (0 when Σ actual = 0);
   *  zone: Highly Trusted > 80 (80.00 itself is Trusted) · Trusted ≥ 70 · Review ≥ 60 · Planner Review ≥ 40 ·
   *  Low Trust ≥ 20 · Critical below. Verified on a sample weekly run: 27 / 23 / 36 / 81 / 26 / 525 of 718. */
  function trustZoneFD(acc) {
    if (acc === null || acc === undefined || !Number.isFinite(acc)) return "Not Available";
    return acc > 80 ? "Highly Trusted" : acc >= 70 ? "Trusted" : acc >= 60 ? "Review" : acc >= 40 ? "Planner Review" : acc >= 20 ? "Low Trust" : "Critical";
  }
  function fdSeriesAccuracy(rows, dates) {
    for (const r of rows) {
      let e = 0, a = 0, n = 0;
      for (const d of dates) { const F = val(r, d, VALID), A = val(r, d, VALID_ACT); if (F === null || A === null) continue; e += Math.abs(F - A); a += A; n++; }
      r._fdAcc = n ? (a > 0 ? 100 - (e / a) * 100 : 0) : null;
      r._fdZone = n ? trustZoneFD(r._fdAcc) : "Not Available";
    }
    return rows;
  }
  /** §8 Inventory-constrained pacing target. A series cannot sell more than the stock it has, so its target for the
   *  period is min(forecast, available) where available = sold so far + on hand now (≈ stock at the period start)
   *  [+ in transit when mode = "transit"]. Series without an inventory record keep their forecast.
   *  inv = { index: Map(key → { onHand, inTransit }), keyRow: row → key, mode }. Grouping by keyRow lets the cap work
   *  at the forecast series (ts) level or, when inventory is kept per item only, at the item level.
   *  → { target, forecast, sold, inventory, matched, groups, capped } */
  function constrainedTarget(rows, m, inv) {
    let target = 0, forecast = 0, sold = 0, inventory = 0, matched = 0, capped = 0, groups = 0;
    for (const [k, rs] of groupBy(rows, inv.keyRow)) {
      groups++;
      const F = rs.reduce((t, r) => t + Math.max(0, val(r, m, "Forecast") || 0), 0), A = rs.reduce((t, r) => t + Math.max(0, val(r, m, "Sales") || 0), 0);
      forecast += F; sold += A;
      const x = inv.index.get(k);
      if (!x) { target += F; continue; }
      const avail = A + Math.max(0, x.onHand || 0) + (inv.mode === "transit" ? Math.max(0, x.inTransit || 0) : 0);
      matched++; inventory += avail;
      if (avail < F) { capped++; target += avail; } else target += F;
    }
    return { target, forecast, sold, inventory, matched, groups, capped };
  }
  /** short label for the current basis, e.g. "Locked Lag-4", "Locked ML", "ML Forecast (validation)" */
  function lockLabel(cols) {
    const m = (cols && cols.lockedMeasure) || LOCKED;
    if (m === STORED) return "stored accuracy (validation)";
    if (m === VALID) return "ML Accuracy (validation)";
    if (m === "ML Forecast") return "ML Forecast (validation)";
    const x = LOCK_RE.exec(m); return x ? (x[1] ? `Locked Lag-${x[1]}` : "Locked ML") : m;
  }
  const col = (month, measure) => month + " " + measure;
  const val = (row, month, measure) => num(row[col(month, measure)]);

  function monthShift(monthEnd, k) {
    const [y, m] = monthEnd.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + k + 1, 0)); // last day of target month
    return d.toISOString().slice(0, 10);
  }
  const daysInMonth = (monthEnd) => Number(monthEnd.slice(8, 10));
  const monthLabel = (monthEnd) => {
    const d = new Date(monthEnd + "T00:00:00Z");
    return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + "'" + monthEnd.slice(2, 4);
  };

  // ---------- time grain (§0): daily, weekly or monthly experiments ----------
  // Grain is read from the data: the median gap between the dates in "<YYYY-MM-DD> <measure>" columns.
  const DAY_MS = 864e5;
  const toMs = (d) => Date.parse(d + "T00:00:00Z");
  const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, k) => isoDate(toMs(d) + k * DAY_MS);
  const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY_MS);
  /** "day" (gap ≤ 1.5 days), "week" (≤ 10 days) or "month"; fewer than two dates → "month". */
  function detectGrain(dates) {
    const u = [...new Set(dates || [])].sort();
    if (u.length < 2) return "month";
    const g = []; for (let i = 1; i < u.length; i++) g.push(daysBetween(u[i - 1], u[i]));
    g.sort((a, b) => a - b);
    const med = g[Math.floor(g.length / 2)];
    return med <= 1.5 ? "day" : med <= 10 ? "week" : "month";
  }
  /** periods per year and the words the UI uses for one period */
  const GRAIN = {
    day: { perYear: 365, one: "day", many: "days", short: "d", toDate: "day-to-date", periodic: "Daily" },
    week: { perYear: 52, one: "week", many: "weeks", short: "wk", toDate: "week-to-date", periodic: "Weekly" },
    month: { perYear: 12, one: "month", many: "months", short: "mo", toDate: "month-to-date", periodic: "Monthly" },
  };
  /** move a period date by k periods of the grain */
  function periodShift(p, k, grain) { return grain === "week" ? addDays(p, 7 * k) : grain === "day" ? addDays(p, k) : monthShift(p, k); }
  /** same period last year: monthly −12 months; weekly and daily −364 days (keeps the weekday) */
  function lyOf(p, grain) { return grain === "week" || grain === "day" ? addDays(p, -364) : monthShift(p, -12); }
  /** calendar days in a period */
  function periodDays(p, grain) { return grain === "week" ? 7 : grain === "day" ? 1 : daysInMonth(p); }
  /** Whether weekly dates mark the first or the last day of their week. TrueGradient's current period
   *  (first Forecast date) contains the as-of date: on/after it → dates are week ends; before it → week starts.
   *  Monthly dates are month ends; daily dates are the day itself. */
  function periodAnchor(cols, asOf) {
    if (!cols || cols.grain !== "week" || !cols.current || !asOf) return "end";
    return cols.current >= asOf ? "end" : "start";
  }
  /** first and last calendar day covered by a period */
  function periodRange(p, grain, anchor) {
    if (grain === "day") return { start: p, end: p };
    if (grain === "week") return anchor === "start" ? { start: p, end: addDays(p, 6) } : { start: addDays(p, -6), end: p };
    return { start: p.slice(0, 8) + "01", end: monthShift(p, 0) };
  }
  /** short label for a period: Aug'26 · Wk 31 Aug'26 · 31 Aug'26 */
  function periodLabel(p, grain) {
    if (!p) return "";
    if (grain !== "week" && grain !== "day") return monthLabel(p);
    const d = new Date(p + "T00:00:00Z");
    const s = `${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}'${p.slice(2, 4)}`;
    return grain === "week" ? "Wk " + s : s;
  }

  // ---------- schema adapter (§0.2): runs name the same thing differently ----------
  // The dashboard is written against canonical column names. Each dataset's real columns are mapped onto them
  // once, after loading: the canonical field is ADDED to each row (never overwritten) from the first candidate
  // that exists. Labels keep showing the real source column (aliasSource).
  const ALIASES = {
    "Final DA Data": {
      product_variant_code: ["product_variant_code", "@ts0", "New_Item", "item", "sku", "SKU", "item_id", "product_id"],
      channel_name: ["channel_name", "@ts1", "Customer ID", "customer", "channel"],
      Region_name: ["Region_name", "@ts2", "region", "Region"],
      product_category: ["product_category", "itemcategory_description", "category", "item_category", "product_type"],
      variant_name: ["variant_name", "product_name", "description", "item_description", "product_description", "name"],
    },
    "DOI Details": {
      component_sku: ["component_sku", "Component SKU", "@ts0", "New_Item", "product_variant_code", "sku", "item"],
      Warehouse: ["Warehouse", "Location", "location", "warehouse", "@ts1"],
      variant_name: ["variant_name", "product_name", "description", "item_description"],
      product_category: ["product_category", "itemcategory_description", "category"],
      updated_TG_Reorder_now: ["updated_TG_Reorder_now", "TG Reorder now", "TG_Reorder_now", "TG Reorder Quantity"],
      updated_Excess_Stock: ["updated_Excess_Stock", "Excess_Stock", "Excess Stock"],
      Final_Potential_Sales_Loss: ["Final_Potential_Sales_Loss", "Potential_Sales_Loss", "Potential Sales Loss"],
    },
    "Supply Plan": {
      component_sku: ["component_sku", "Component SKU", "@ts0", "New_Item", "product_variant_code", "sku", "item"],
      Warehouse: ["Warehouse", "Location", "location", "@ts1"],
      variant_name: ["variant_name", "product_name", "description"],
      product_category: ["product_category", "itemcategory_description", "category"],
    },
    "Stock Transfer": { component_sku: ["component_sku", "Component SKU", "@ts0", "New_Item", "sku"], Warehouse: ["Warehouse", "To_Facility", "Location", "@ts1"] },
  };
  ALIASES["Final DA Data Value"] = ALIASES["Final DA Data"];
  ALIASES["Supply Plan Value"] = ALIASES["Supply Plan"];
  /** canonical → real source column for a dataset's columns ("@tsN" = N-th ts_id column). Columns that already
   *  carry the canonical name map to themselves; canonical fields with no source are left out. */
  function aliasMap(dataset, columns, tsIdCols) {
    const table = ALIASES[dataset] || {}, cols = new Set(columns || []), ts = tsIdCols || TS_ID, used = new Set(), out = {};
    for (const [canon, cands] of Object.entries(table)) {
      for (const c of cands) {
        const src = c.startsWith("@ts") ? ts[Number(c.slice(3))] : c;
        if (src && cols.has(src) && (src === canon || !used.has(src) || canon === "variant_name" || canon === "product_category")) { out[canon] = src; used.add(src); break; }
      }
    }
    return out;
  }
  /** add canonical fields to each row from their source column (rows are mutated; existing values win) */
  function applyAliases(rows, map) {
    const pairs = Object.entries(map || {}).filter(([canon, src]) => canon !== src);
    if (!pairs.length) return rows;
    for (const r of rows) for (const [canon, src] of pairs) if (r[canon] === undefined) r[canon] = r[src];
    return rows;
  }

  // ---------- run configuration (tg_experiment_details) ----------
  // The ts_id (series key) comes from the run's saved configuration: series.ts_id_columns.
  // Default = the reference runs' key; call setTsIdColumns(runConfig(details).tsIdColumns) after loading details.
  const DEFAULT_TS_ID = ["product_variant_code", "channel_name", "Region_name"];
  let TS_ID = DEFAULT_TS_ID.slice();
  /** Use these columns as the ts_id. Only columns present in `available` (if given) are accepted; otherwise
   *  the default key stays. Returns the key in use. */
  function setTsIdColumns(columns, available) {
    const ok = Array.isArray(columns) && columns.length && columns.every((c) => typeof c === "string" && c && (!available || available.includes(c)));
    TS_ID = ok ? columns.slice() : DEFAULT_TS_ID.slice();
    return TS_ID.slice();
  }
  const tsIdColumns = () => TS_ID.slice();
  /** one ts_id = one time series; key = values of the ts_id columns joined by "|" */
  function comboKey(r) { return TS_ID.map((c) => r[c]).join("|"); }
  /** TrueGradient frequency codes → grain: D/B → day, W… → week, M/MS/ME → month; unknown → null */
  function grainFromFrequency(f) {
    const x = String(f || "").trim().toUpperCase();
    if (!x) return null;
    if (/^(D|B|C)$/.test(x) || /DAI/.test(x)) return "day";
    if (/^W/.test(x) || /WEEK/.test(x)) return "week";
    if (/^(M|MS|ME|BM|BMS|SM|SMS)$/.test(x) || /MONTH/.test(x)) return "month";
    return null;
  }
  /** Normalise one entry of tg_experiment_details.experiments[] into what the dashboard uses. */
  function runConfig(d) {
    const s = (d && d.series) || {}, f = (d && d.forecast) || {}, w = (d && d.data_window) || {}, m = (d && d.modelling) || {};
    return {
      tsIdColumns: Array.isArray(s.ts_id_columns) && s.ts_id_columns.length ? s.ts_id_columns.slice() : null,
      tsIdDisagg: Array.isArray(s.ts_id_columns_disagg) ? s.ts_id_columns_disagg.slice() : null,
      tsIdDescription: s.ts_id_description || null,
      frequency: s.frequency || null, frequencyLabel: s.frequency_label || null, grain: grainFromFrequency(s.frequency || s.frequency_label),
      timestampColumn: s.timestamp_column || null, dateFormat: s.date_format || null, target: s.target_column || null,
      horizon: num(f.forecast_horizon), validationHorizon: num(f.validation_horizon), horizonUnit: f.horizon_unit || null,
      drivers: Array.isArray(f.driver_columns) ? f.driver_columns.slice() : [], aggregation: f.aggregation_method || null,
      plannerColumns: f.planner_forecast_columns || f.consensus_forecast_columns || null,
      activityEndDate: typeof w.activity_end_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(w.activity_end_date) ? w.activity_end_date.slice(0, 10) : null,
      historyDays: num(w.history), activityPeriod: num(w.activity_period), inputDatasets: Array.isArray(w.input_datasets) ? w.input_datasets.map((x) => x.name).filter(Boolean) : [],
      metric: m.metric || null, models: Array.isArray(m.candidate_models) ? m.candidate_models.slice() : [], ensemble: m.ensemble || null,
      inventoryColumn: (d && d.inventory && d.inventory.inventory_column) || null,
      // accuracy settings (dashboard_settings): lag of the locked forecast to score, rolling horizon
      globalLagN: num(((d && d.accuracy) || {}).global_lag_n ?? (((d && d.raw_sections) || {}).dashboard_settings || {}).global_lag_n),
      pastAccuracyHorizon: num(((d && d.accuracy) || {}).past_accuracy_horizon), testHorizon: num(((d && d.accuracy) || {}).test_horizon),
    };
  }
  /** Settings that make two runs not directly comparable (ts_id, grain, target). */
  function setupDiff(a, b) {
    const out = [];
    if (!a || !b) return out;
    if (a.tsIdColumns && b.tsIdColumns && a.tsIdColumns.join("|") !== b.tsIdColumns.join("|")) out.push("ts_id");
    if (a.grain && b.grain && a.grain !== b.grain) out.push("frequency");
    if (a.target && b.target && a.target !== b.target) out.push("target");
    return out;
  }
  /** Every ts_id should be exactly one Final DA Data row (accuracy is scored per ts_id). */
  function tsIdCheck(rows) {
    const seen = new Map(); let dup = 0, first = null;
    for (const r of rows) { const k = comboKey(r); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n === 2) { dup++; if (!first) first = k; } }
    return { rows: rows.length, tsIds: seen.size, duplicated: dup, firstDuplicate: first, ok: dup === 0 };
  }

  function displayName(r) {
    for (const k of ["variant_name", "product_name", "description", "item_description"]) {
      if (r[k] && r[k] !== "UNKNOWN") return r[k];
    }
    return r.product_variant_code;
  }

  // ---------- source selection (calculations §1) ----------
  function pickDefaultSource(experiments, saved) {
    if (!experiments || !experiments.length) return null;
    // live = not archived (isArchive false). Production is a separate flag: it only picks the default
    // run inside a pipeline. The page opens on the pipeline of the newest live run.
    const liveOf = (e) => (e.isLive !== undefined ? e.isLive : e.isArchive !== true) === true;
    const prodOf = (e) => (e.tgProduction !== undefined ? e.tgProduction : e.isProduction) === true;
    const live = experiments.filter(liveOf);
    const pool = live.length ? live : experiments;
    const pipelines = [];
    for (const e of pool) { const t = e.tag || "Untagged"; if (!pipelines.includes(t)) pipelines.push(t); }
    const firstIn = (tag) => { const inTag = pool.filter((e) => (e.tag || "Untagged") === tag); return (live.length ? inTag.find(prodOf) : null) || inTag[0]; };
    let pipeline = pipelines[0];
    let exp = firstIn(pipeline);
    let savedValid = false;
    if (saved && saved.experimentId) {
      const s = experiments.find((e) => e.id === saved.experimentId);
      if (s) { exp = s; pipeline = s.tag || "Untagged"; savedValid = true; }
    }
    return {
      pipeline, experimentId: exp.id, experiment: exp,
      isLive: liveOf(exp), isProduction: prodOf(exp), anyLive: live.length > 0,
      multiPipeline: pipelines.length > 1, pipelines,
      defaultFor: (tag) => (firstIn(tag) || {}).id,
      savedIgnored: !!(saved && saved.experimentId && !savedValid),
    };
  }
  function previousRun(experiments, exp) {
    const tag = exp.tag || "Untagged";
    return experiments
      .filter((e) => (e.tag || "Untagged") === tag && e.createdAt < exp.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  }
  // ---------- run dates (§1.2) ----------
  // TrueGradient refreshes experiments daily, so a run's sales are complete through the date it was LAST
  // UPDATED. The connector may return that under any of these names (roster entry or details.experiment).
  const UPDATED_FIELDS = ["updatedAt", "updated_at", "lastUpdatedAt", "last_updated_at", "lastUpdated", "modifiedAt", "modified_at", "lastModifiedAt", "last_modified_date"];
  const toDateStr = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? "" : "Z"));
    return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
  };
  /** UTC date of the run's last update, if the connector provides one; else null */
  function lastUpdatedDate(exp) { for (const f of UPDATED_FIELDS) { const d = exp && toDateStr(exp[f]); if (d) return d; } return null; }
  /** The run's as-of date = its last update (sales are complete through it); else its creation date. */
  const asOfDate = (exp) => lastUpdatedDate(exp) || new Date(exp.createdAt).toISOString().slice(0, 10);
  /** Last day with sales in the run, inclusive: the latest of last update, creation date and the configured
   *  activity_end_date. → { date, source: "last_updated" | "run_date" | "activity_end_date" } */
  function dataThroughDate(exp, cfg) {
    const c = [[lastUpdatedDate(exp), "last_updated"], [exp && exp.createdAt != null ? toDateStr(exp.createdAt) : null, "run_date"], [cfg && cfg.activityEndDate, "activity_end_date"]].filter((x) => x[0]);
    if (!c.length) return { date: null, source: null };
    c.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    return { date: c[0][0], source: c[0][1] };
  }

  // ---------- filtering & aggregation (§2) ----------
  function applyFilters(rows, f) {
    const q = (f.sku || "").trim().toLowerCase();
    const inSet = (set, v) => !set || !set.length || set.includes(v);
    return rows.filter((r) =>
      (!q || [r.product_variant_code, r.variant_name, r.product_name]
        .some((x) => x && String(x).toLowerCase().includes(q))) &&
      inSet(f.platforms, r.channel_name) && inSet(f.regions, r.Region_name) &&
      inSet(f.categories, r.product_category));
  }
  function sumMeasure(rows, month, measure) {
    let s = 0, any = false;
    for (const r of rows) { const v = val(r, month, measure); if (v !== null) { s += v; any = true; } }
    return any ? s : null;
  }
  function series(rows, months, measure) { return months.map((m) => sumMeasure(rows, m, measure)); }
  function groupBy(rows, keyFn) {
    const g = new Map();
    for (const r of rows) { const k = keyFn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return g;
  }

  // ---------- accuracy (§4) ----------
  function accuracy(F, A) {
    if (F === null || A === null) return null;
    if (A > 0) return (1 - Math.abs(F - A) / A) * 100;
    return F === 0 ? 100 : 0;
  }
  function bias(F, A) { return F === null || A === null || A === 0 ? null : (F / A) * 100; }
  /** cells: [{F, A}] -> bottom-up WAPE accuracy, bias, sums */
  function wape(cells) {
    let e = 0, a = 0, f = 0, n = 0, nf = 0;
    for (const c of cells) {
      if (c.A === null || c.A === undefined) continue;
      const hasF = c.F !== null && c.F !== undefined, hasE = c.E !== null && c.E !== undefined;
      if (!hasF && !hasE) continue;
      // error = stored Abs Error when given (> 0), else |F − A| (§4.12)
      e += hasE ? c.E : Math.abs(c.F - c.A); a += c.A; n++;
      if (hasF) { f += c.F; nf++; }
    }
    const fOk = n > 0 && nf === n;
    return {
      accuracy: a > 0 ? (1 - e / a) * 100 : (n ? (e === 0 ? 100 : 0) : null),
      bias: a > 0 && fOk ? (f / a) * 100 : null, absError: e, actual: a, forecast: fOk ? f : null, cells: n,
    };
  }
  /** (row × period) cells of a forecast measure against Sales. measure defaults to Locked ML Forecast Lag_1. */
  function lockedCells(rows, months, measure) {
    const fm = measure || LOCKED, out = [];
    if (fm === STORED) {
      // stored fallback: TrueGradient's per-ts_id overall_accuracy over the validation window → error = (1 − acc) × ΣA,
      // spread over the window's periods by Sales (totals exact; per-period split is not meaningful)
      for (const r of rows) {
        const acc = num(r.overall_accuracy);
        for (const m of months) { const A = val(r, m, "Sales"); out.push({ F: null, A: acc === null ? null : A, E: acc === null || A === null ? null : Math.max(0, A) * (1 - acc / 100), row: r, month: m }); }
      }
      return out;
    }
    const ae = fm + " Abs Error";
    for (const r of rows) for (const m of months) {
      const F = val(r, m, fm), A = val(r, m, actOf(fm)), E = F !== null && A !== null && fm !== VALID ? val(r, m, ae) : null;
      out.push({ F, A, E: E !== null && E > 0 ? E : null, row: r, month: m });
    }
    return out;
  }
  /** reproduces stored overall_accuracy */
  const overallAccuracy = (row, cols) => wape(lockedCells([row], cols.locked, cols.lockedMeasure)).accuracy;
  /** reproduces stored rolling_accuracy (latest locked month only) */
  function latestMonthAccuracy(row, cols) {
    const m = cols.locked[cols.locked.length - 1];
    return m ? wape(lockedCells([row], [m], cols.lockedMeasure)).accuracy : null;
  }
  function rollingBias3(rows, cols) {
    return wape(lockedCells(rows, cols.locked.slice(-(cols.rollingN || 3)), cols.lockedMeasure)).bias;
  }
  /** aggregate-first variant (errors net out) */
  function aggregatedAccuracy(rows, months) {
    return wape(months.map((m) => ({ F: sumMeasure(rows, m, LOCKED), A: sumMeasure(rows, m, "Sales") })));
  }

  /** §4 aggregate rolling accuracy = WAPE over the last 3 locked months.
   *  This is TrueGradient's all-level rolling_accuracy (verified to 2 decimals on two runs).
   *  For ONE row TrueGradient's stored rolling_accuracy is the latest locked month (latestMonthAccuracy). */
  function rollingAccuracy3(rows, cols) { return wape(lockedCells(rows, cols.locked.slice(-(cols.rollingN || 3)), cols.lockedMeasure)).accuracy; }
  /** §4 Rolling aggregated accuracy — WORKING DEFINITION, not yet confirmed by TrueGradient:
   *  per row, Σ F and Σ A over the last 3 locked months (months where both exist), then WAPE across rows. */
  function rollingAggregatedAccuracy(rows, cols) {
    const ms = cols.locked.slice(-(cols.rollingN || 3));
    return wape(rows.map((r) => {
      let f = 0, a = 0, n = 0;
      for (const m of ms) { const F = val(r, m, cols.lockedMeasure || LOCKED), A = val(r, m, "Sales"); if (F === null || A === null) continue; f += F; a += A; n++; }
      return n ? { F: f, A: a } : { F: null, A: null };
    })).accuracy;
  }
  /** §4 one row of TrueGradient's accuracy report for a set of ts_id rows (bottom-up at row grain). */
  function accuracySummary(rows, allRows, cols) {
    const L = cols.locked, L3 = L.slice(-(cols.rollingN || 3));
    const fm = cols.lockedMeasure || LOCKED;
    const w = wape(lockedCells(rows, L, fm)), w3 = wape(lockedCells(rows, L3, fm));
    return {
      combos: rows.length,
      contribution: contribution(rows, allRows, cols),
      overall: w.accuracy, rolling: w3.accuracy, rollingAggregated: rollingAggregatedAccuracy(rows, cols), rollingBias: w3.bias,
      months: L.map((m) => { const x = wape(lockedCells(rows, [m], fm)); return { month: m, accuracy: x.accuracy, bias: x.bias, absError: x.absError, actual: x.actual, forecast: x.forecast }; }),
      window: L, rollingWindow: L3,
      sums: { absError: w.absError, actual: w.actual, forecast: w.forecast, rollingAbsError: w3.absError, rollingActual: w3.actual, rollingForecast: w3.forecast },
    };
  }
  // ---------- granularity, compare forecasts, date window (§4.10) ----------
  /** Special granularity token: each ts_id (one Final DA Data row). [] = Overall (all filtered rows). */
  const TS_GRAN = "@ts_id";
  const dimText = (v) => (v == null || v === "" ? "—" : String(v));
  /** Normalise a granularity: drop blanks/duplicates; ts_id is exclusive; no column limit (T.GRAN_MAX_COLS), as the app. */
  function normalizeGranularity(by) {
    const cs = [...new Set((by || []).filter((c) => c !== null && c !== undefined && c !== ""))];
    if (cs.includes(TS_GRAN)) return [TS_GRAN];
    return cs.slice(0, T.GRAN_MAX_COLS);
  }
  /** Group key of a row at a granularity. Overall → "All"; ts_id → comboKey; columns → values joined " | ". */
  function granularityKey(by) {
    const cs = normalizeGranularity(by);
    if (!cs.length) return () => "All";
    if (cs[0] === TS_GRAN) return comboKey;
    return (r) => cs.map((c) => dimText(r[c])).join(" | ");
  }
  /** Display values of a row's group, one per granularity column (ts_id → its ts_id columns). */
  function granularityParts(by, r) {
    const cs = normalizeGranularity(by);
    if (!cs.length) return ["All"];
    return (cs[0] === TS_GRAN ? TS_ID : cs).map((c) => dimText(r[c]));
  }
  /** Columns a granularity displays (ts_id expands to the ts_id columns). */
  function granularityColumns(by) { const cs = normalizeGranularity(by); return !cs.length ? [] : cs[0] === TS_GRAN ? TS_ID.slice() : cs; }
  /** rows → [{ key, parts, rows }] at a granularity, first-seen order */
  function groupByGranularity(rows, by) {
    const kf = granularityKey(by), out = [];
    for (const [key, rs] of groupBy(rows, kf)) out.push({ key, parts: granularityParts(by, rs[0]), rows: rs });
    return out;
  }
  const FORECAST_RE = /forecast|budget|lock/i;
  const NOT_FORECAST_RE = /abs error|deviation|accuracy|bias|yoy|perc change|bound|offset/i;
  /** Forecast measures that can be scored against Sales: their CLOSED periods (dates that are also history dates).
   *  Locked ML Forecast Lag_1 first, then other locked lags by lag number, then the rest alphabetically. */
  function forecastMeasures(cols) {
    const h = new Set(cols.closedSales || cols.history || []);
    const basis = cols.lockedMeasure || LOCKED;
    const rank = (m) => (m === basis ? 0 : /lock/i.test(m) ? 1 : /consensus/i.test(m) ? 2 : 3);
    const lagN = (m) => { const x = /lag_?(\d+)/i.exec(m); return x ? Number(x[1]) : 99; };
    return Object.entries(cols.measures || {})
      .filter(([m]) => FORECAST_RE.test(m) && !NOT_FORECAST_RE.test(m))
      .map(([measure, ds]) => ({ measure, periods: ds.filter((d) => h.has(d)) }))
      .filter((x) => x.periods.length)
      .concat(basis === STORED || basis === VALID || (basis === "ML Forecast" && !(cols.measures || {})["ML Forecast"]) ? [{ measure: basis, periods: cols.locked.slice() }] : [])
      .map((x) => (x.measure === basis ? { measure: x.measure, periods: cols.locked.slice() } : x))
      .filter((x, i, a) => a.findIndex((y) => y.measure === x.measure) === i)
      .sort((a, b) => rank(a.measure) - rank(b.measure) || lagN(a.measure) - lagN(b.measure) || a.measure.localeCompare(b.measure));
  }
  /** periods within [from, to] (inclusive ISO dates; either may be null) */
  function periodWindow(periods, from, to) { return (periods || []).filter((p) => (!from || p >= from) && (!to || p <= to)); }
  /** One accuracy report row for a set of ts_id rows, for any forecast measure and window.
   *  Bottom-up at the ts_id grain (each row's error counted on its own), like accuracySummary.
   *  opts: { measure = Locked Lag-1, window = that measure's closed periods } */
  function accuracyReport(rows, allRows, cols, opts) {
    const o = opts || {}, fm = o.measure || cols.lockedMeasure || LOCKED;
    const own = fm === LOCKED || fm === cols.lockedMeasure ? cols.locked : ((forecastMeasures(cols).find((x) => x.measure === fm) || {}).periods || []);
    const L = (o.window ? own.filter((p) => o.window.includes(p)) : own).slice().sort();
    const L3 = L.slice(-(cols.rollingN || T.ROLLING_N));
    const w = wape(lockedCells(rows, L, fm)), w3 = wape(lockedCells(rows, L3, fm));
    // aggregated (§4.12): per ts_id Σ F and Σ A over the dates first, then WAPE across ts_ids
    const aggOver = (ms) => wape(rows.map((r) => {
      let f = 0, a = 0, n = 0;
      for (const m of ms) { const F = val(r, m, fm), A = val(r, m, actOf(fm)); if (F === null || A === null) continue; f += F; a += A; n++; }
      return n ? { F: f, A: a } : { F: null, A: null };
    }));
    const ra = aggOver(L3), oa = aggOver(L);
    const tf = wape(L.map((m) => ({ F: sumMeasure(rows, m, fm), A: sumMeasure(rows, m, actOf(fm)) })));
    return {
      measure: fm, combos: rows.length, contribution: contribution(rows, allRows, cols),
      overall: w.accuracy, bias: w.bias, rolling: w3.accuracy, rollingAggregated: ra.accuracy, rollingBias: w3.bias,
      overallAggregated: oa.accuracy, aggregatedBias: oa.bias, rollingAggregatedBias: ra.bias,
      wmape: w.actual > 0 ? (w.absError / w.actual) * 100 : null, rollingWmape: w3.actual > 0 ? (w3.absError / w3.actual) * 100 : null,
      aggregated: tf.accuracy,
      months: L.map((m) => { const x = wape(lockedCells(rows, [m], fm)); return { month: m, accuracy: x.accuracy, bias: x.bias, absError: x.absError, actual: x.actual, forecast: x.forecast, cells: x.cells }; }),
      window: L, rollingWindow: L3,
      sums: { absError: w.absError, actual: w.actual, forecast: w.forecast, cells: w.cells, rollingAbsError: w3.absError, rollingActual: w3.actual, rollingForecast: w3.forecast },
    };
  }
  /** Report per group at a granularity: [{ key, parts, rows, combos, contribution, reports: {measure: report} }],
   *  sorted by contribution desc. Every number is still bottom-up at ts_id inside its group, so groups add up:
   *  Σ group absError = total absError. opts: { by, measures, window } */
  function granularReport(rows, allRows, cols, opts) {
    const o = opts || {}, ms = (o.measures && o.measures.length ? o.measures : [cols.lockedMeasure || LOCKED]);
    const out = groupByGranularity(rows, o.by).map((g) => {
      const reports = {}; for (const m of ms) reports[m] = accuracyReport(g.rows, allRows, cols, { measure: m, window: o.window });
      return { key: g.key, parts: g.parts, rows: g.rows, combos: g.rows.length, contribution: contribution(g.rows, allRows, cols), reports };
    });
    return out.sort((a, b) => (b.contribution ?? -1) - (a.contribution ?? -1) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
  }
  const TRUST_ORDER = ["Highly Trusted", "Trusted", "Review", "Planner Review", "Low Trust", "Critical", "Not Available"];
  /** Trust-zone chips: per stored trust_zone, ts_id count and contribution (Σ Sales last 3 closed periods ÷ the
   *  scope's total). Zones in TrueGradient's order; unknown zones after. */
  function trustZoneSummary(rows, cols, column) {
    const c = column || "trust_zone", out = [];
    for (const [zone, rs] of groupBy(rows, (r) => dimText(r[c]))) out.push({ zone, count: rs.length, contribution: contribution(rs, rows, cols) });
    const rk = (z) => { const i = TRUST_ORDER.indexOf(z); return i < 0 ? 99 : i; };
    return out.sort((a, b) => rk(a.zone) - rk(b.zone) || a.zone.localeCompare(b.zone));
  }
  /** TrueGradient's trust-zone cut-offs on rolling accuracy (verified on 622 rows of a live run: every stored
   *  trust_zone equals trustZoneOf(stored rolling_accuracy)). No accuracy (no sales in the window) → Not Available. */
  const TRUST_CUTS = [[80, "Highly Trusted"], [70, "Trusted"], [60, "Review"], [40, "Planner Review"], [20, "Low Trust"]];
  function trustZoneOf(acc) {
    if (acc === null || acc === undefined || !Number.isFinite(acc)) return "Not Available";
    for (const [cut, zone] of TRUST_CUTS) if (acc >= cut) return zone;
    return "Critical";
  }
  /** Cells at a granularity LEVEL: for each group and period, Σ F and Σ A over the group's rows that have both,
   *  then one cell per group × period. Overall / ts_id → the ts_id cells (lockedCells) unchanged. */
  function levelCells(rows, months, measure, by) {
    const cs = normalizeGranularity(by), fm = measure || LOCKED;
    if (!cs.length || cs[0] === TS_GRAN) return lockedCells(rows, months, fm);
    const out = [];
    for (const g of groupByGranularity(rows, cs)) for (const m of months) {
      let f = 0, a = 0, n = 0, e = 0, noF = false;
      for (const c of lockedCells(g.rows, [m], fm)) {
        if (c.A === null) continue;
        if (c.F === null) { if (c.E === null || c.E === undefined) continue; noF = true; e += c.E; a += c.A; n++; continue; }
        f += c.F; a += c.A; n++;
      }
      // stored fallback has no forecast values, so groups cannot net errors: Σ errors is used (= ts_id result)
      out.push(n ? (noF ? { F: null, A: a, E: e, key: g.key, month: m } : { F: f, A: a, key: g.key, month: m }) : { F: null, A: null, key: g.key, month: m });
    }
    return out;
  }
  /** Accuracy AT a granularity level (headline tiles follow the Granularity control):
   *  Overall / ts_id = TrueGradient's ts_id WAPE (accuracyReport); columns = each group's total forecast vs its total
   *  Sales per period, then WAPE across group × period cells. Bias is the same at every level (ΣF ÷ ΣA).
   *  opts { by, measure, window } → { level, overall, rolling, rollingBias, bias, months[], window, rollingWindow,
   *  groups, groupsScored } */
  function levelReport(rows, allRows, cols, opts) {
    const o = opts || {}, by = normalizeGranularity(o.by), fm = o.measure || cols.lockedMeasure || LOCKED;
    const base = accuracyReport(rows, allRows, cols, { measure: fm, window: o.window });
    const L = base.window, L3 = base.rollingWindow;
    const isTs = !by.length || by[0] === TS_GRAN;
    const groups = isTs ? rows.length : groupByGranularity(rows, by).length;
    if (isTs) {
      const scored = new Set(lockedCells(rows, L, fm).filter((c) => (c.F !== null || (c.E !== null && c.E !== undefined)) && c.A !== null).map((c) => c.row)).size;
      return { level: by.length ? "ts_id" : "overall", overall: base.overall, rolling: base.rolling, rollingBias: base.rollingBias, bias: base.bias, months: base.months, window: L, rollingWindow: L3, groups, groupsScored: scored, base };
    }
    const cells = levelCells(rows, L, fm, by), w = wape(cells), w3 = wape(cells.filter((c) => L3.includes(c.month)));
    const months = L.map((m) => { const x = wape(cells.filter((c) => c.month === m)); return { month: m, accuracy: x.accuracy, bias: x.bias, absError: x.absError, actual: x.actual, forecast: x.forecast, cells: x.cells }; });
    const scored = new Set(cells.filter((c) => (c.F !== null || (c.E !== null && c.E !== undefined)) && c.A !== null).map((c) => c.key)).size;
    return { level: "group", overall: w.accuracy, rolling: w3.accuracy, rollingBias: w3.bias, bias: w.bias, months, window: L, rollingWindow: L3, groups, groupsScored: scored, base, sums: { absError: w.absError, actual: w.actual, forecast: w.forecast } };
  }
  /** Trust zones at a granularity. Overall / ts_id: the stored trust_zone of each ts_id. Columns: each GROUP gets
   *  the zone of its own rolling accuracy (group totals vs Sales over the last 3 periods of the window, trustZoneOf).
   *  → { groups: [{ key, zone, rolling, rows }], summary: [{ zone, count, tsids, contribution }] } (count = groups) */
  function granularTrust(rows, cols, opts) {
    const o = opts || {}, by = normalizeGranularity(o.by), fm = o.measure || cols.lockedMeasure || LOCKED, c = o.column || "trust_zone";
    const isTs = !by.length || by[0] === TS_GRAN;
    let groups;
    const fdPath = cols.accPath === "forecastData";
    if (isTs && fdPath) groups = rows.map((r) => ({ key: comboKey(r), zone: r._fdZone || "Not Available", rolling: r._fdAcc ?? null, rows: [r] }));
    else if (isTs) groups = rows.map((r) => ({ key: comboKey(r), zone: dimText(r[c]) === "—" ? trustZoneOf(num(r.rolling_accuracy)) : dimText(r[c]), rolling: num(r.rolling_accuracy), rows: [r] }));
    else {
      const own = fm === LOCKED || fm === cols.lockedMeasure ? cols.locked : ((forecastMeasures(cols).find((x) => x.measure === fm) || {}).periods || []);
      const L = (o.window ? own.filter((p) => o.window.includes(p)) : own).slice().sort(), L3 = L.slice(-(cols.rollingN || T.ROLLING_N));
      groups = groupByGranularity(rows, by).map((g) => { const acc = wape(levelCells(g.rows, L3, fm, by)).accuracy; return { key: g.key, zone: fdPath ? trustZoneFD(acc ?? 0) : trustZoneOf(acc), rolling: acc, rows: g.rows }; });
    }
    const by_z = new Map();
    for (const g of groups) { const x = by_z.get(g.zone) || { zone: g.zone, count: 0, rows: [] }; x.count++; x.rows.push(...g.rows); by_z.set(g.zone, x); }
    const rk = (z) => { const i = TRUST_ORDER.indexOf(z); return i < 0 ? 99 : i; };
    const summary = [...by_z.values()].map((x) => ({ zone: x.zone, count: x.count, tsids: x.rows.length, contribution: contribution(x.rows, rows, cols) })).sort((a, b) => rk(a.zone) - rk(b.zone));
    return { groups, summary };
  }
  // ---------- comparing runs (§13 Forecast by Experiment) ----------
  const GRAIN_RANK = { day: 0, week: 1, month: 2 };
  /** A run's frequency: its configured grain, else a hint from its label (…_Monthly / …_weekly / …_daily), else null. */
  function runFrequency(label, cfgGrain) {
    if (cfgGrain && GRAIN_RANK[cfgGrain] !== undefined) return cfgGrain;
    const l = String(label || "");
    return /month/i.test(l) ? "month" : /week/i.test(l) ? "week" : /da(il)?y/i.test(l) ? "day" : null;
  }
  /** The coarsest grain among runs (comparisons happen at it; finer runs are rolled up). */
  function coarsestGrain(grains) {
    let g = null; for (const x of grains) if (x && (g === null || GRAIN_RANK[x] > GRAIN_RANK[g])) g = x; return g || "month";
  }
  /** The period a dated value belongs to at a coarser grain: month → month-end date, week → the week-ending Sunday. */
  function rollupPeriod(date, toGrain) {
    if (toGrain === "month") return monthShift(date.slice(0, 7) + "-01", 0);
    if (toGrain === "week") { const dow = new Date(date + "T00:00:00Z").getUTCDay(); return dow === 0 ? date : addDays(date, 7 - dow); }
    return date;
  }
  /** [[date, value], …] → Map(period → Σ value) at toGrain (null values skipped; a period with none stays absent). */
  function rollupSeries(pairs, toGrain) {
    const out = new Map();
    for (const [d, v] of pairs) { if (v === null || v === undefined || !Number.isFinite(v)) continue; const k = rollupPeriod(d, toGrain); out.set(k, (out.get(k) || 0) + v); }
    return out;
  }
  /** Periods from a run's as-of date to a target period, at grain (0 = the as-of period itself; negative = target before). */
  function lagBetween(asOf, target, grain) {
    const a = rollupPeriod(asOf, grain), b = rollupPeriod(target, grain);
    if (grain === "month") { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); }
    return Math.round(daysBetween(a, b) / (grain === "week" ? 7 : 1));
  }
  /** Forecast consistency across runs for each target period: values present in ≥ 2 runs →
   *  { period, n, min, max, mean, spreadPct = (max − min) ÷ mean × 100, cov = sd ÷ mean × 100 }. */
  function forecastConsistency(runs, periods) {
    return periods.map((p) => {
      const v = runs.map((r) => r.values.get(p)).filter((x) => Number.isFinite(x));
      if (v.length < 2) return { period: p, n: v.length, min: null, max: null, mean: null, spreadPct: null, cov: null };
      const mean = v.reduce((a, b) => a + b, 0) / v.length, min = Math.min(...v), max = Math.max(...v);
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      return { period: p, n: v.length, min, max, mean, spreadPct: mean > 0 ? ((max - min) / mean) * 100 : null, cov: mean > 0 ? (sd / mean) * 100 : null };
    });
  }
  /** Indices of sharp accuracy drops in a period series: a local minimum at least minDrop points below the
   *  period before it (TrueGradient marks these on its accuracy chart). */
  function accuracyDrops(values, minDrop) {
    const d = minDrop ?? T.DROP_PTS, out = [];
    for (let i = 1; i < values.length; i++) {
      const a = values[i], p = values[i - 1], n = values[i + 1];
      if (a === null || a === undefined || p === null || p === undefined) continue;
      if (p - a >= d && (n === undefined || n === null || a <= n)) out.push(i);
    }
    return out;
  }


  // ---------- roster preparation (§1) ----------
  /** Sort newest first (the archived fallback list is NOT sorted) and decide what counts as live:
   *  live = not archived (isArchive !== true), whatever isProduction says. isProduction is kept as the raw
   *  TrueGradient flag (also copied to tgProduction) and never means "live". If only archived runs exist,
   *  nothing is live and full inventory-optimization runs come first.
   *  Returns { roster (each run with isLive), liveBasis: "notArchived" | "none" }. */
  function prepareRoster(experiments, usedArchivedFallback) {
    const fallback = !!usedArchivedFallback;
    const rank = (e) => (fallback && e.module_name !== "inventory-optimization" ? 1 : 0);
    const raw = (experiments || []).filter((e) => e && e.id).map((e) => ({ ...e, createdAt: num(e.createdAt) ?? 0 }))
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
    const liveBasis = !fallback && raw.some((e) => e.isArchive !== true) ? "notArchived" : "none";
    const roster = raw.map((e) => ({ ...e, lastUpdated: lastUpdatedDate(e), tgProduction: e.isProduction === true,
      isProduction: e.isProduction === true, isLive: liveBasis === "notArchived" && e.isArchive !== true }));
    return { roster, liveBasis };
  }

  /** §10 Forecast by Experiment: runs grouped by the UTC month they were created, newest month first.
   *  Each month defaults to its production run (raw isProduction flag, archived or not — tgProduction when the
   *  roster went through prepareRoster), else the latest run created that month.
   *  → [{ month: "YYYY-MM", runs: [newest first], defaultId, defaultReason: "production" | "latest" }] */
  function monthlyRuns(experiments) { return runsByPeriod(experiments, "month"); }
  /** Same as monthlyRuns for any grain: runs grouped by the UTC day, ISO week (Monday) or month they were
   *  created. → [{ period, month (= period), label, runs, defaultId, defaultReason }] newest period first. */
  function runsByPeriod(experiments, grain) {
    const keyOf = (d) => grain === "day" ? d : grain === "week" ? addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7)) : d.slice(0, 7);
    const labelOf = (k) => grain === "day" ? periodLabel(k, "day") : grain === "week" ? "Wk of " + periodLabel(k, "day") : monthLabel(monthShift(k + "-01", 0));
    const by = new Map();
    for (const e of experiments || []) {
      if (!e || !e.id) continue;
      const k = keyOf(asOfDate(e));
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(e);
    }
    const isProd = (e) => (e.tgProduction !== undefined ? e.tgProduction : e.isProduction) === true;
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, runs]) => {
      const sorted = runs.slice().sort((a, b) => (num(b.createdAt) ?? 0) - (num(a.createdAt) ?? 0));
      const prod = sorted.find(isProd);
      return { period: month, month, label: labelOf(month), runs: sorted, defaultId: (prod || sorted[0]).id, defaultReason: prod ? "production" : "latest" };
    });
  }

  // ---------- reconciliation with TrueGradient's own stored values (§4.9) ----------
  /** Per locked month: Σ|F − A| recomputed vs Σ stored "<m> Locked ML Forecast Lag_1 Abs Error".
   *  ok = within half a unit per row (stored values may be rounded). stored null = column absent. */
  function reconcileAbsError(rows, cols) {
    return cols.locked.map((m) => {
      let stored = 0, computed = 0, nStored = 0;
      for (const r of rows) {
        const e = val(r, m, (cols.lockedMeasure || LOCKED) + " Abs Error"); if (e !== null) { stored += e; nStored++; }
        const F = val(r, m, cols.lockedMeasure || LOCKED), A = val(r, m, "Sales"); if (F !== null && A !== null) computed += Math.abs(F - A);
      }
      const has = nStored > 0;
      return { month: m, stored: has ? stored : null, computed, ok: !has || Math.abs(stored - computed) <= 0.5 * nStored + 1e-6 };
    });
  }
  /** Rows whose stored overall_accuracy / rolling_accuracy differ from the recomputation by > tol points. */
  function reconcileRowAccuracy(rows, cols, tol) {
    tol = tol === undefined ? 0.05 : tol;
    let checked = 0; const mismatched = [];
    for (const r of rows) {
      const so = num(r.overall_accuracy), sr = num(r.rolling_accuracy);
      if (so === null && sr === null) continue;
      checked++;
      const o = overallAccuracy(r, cols);
      // stored rolling = WAPE over the last past_accuracy_horizon dates (older runs: the latest date only) — accept either
      const rN = wape(lockedCells([r], cols.locked.slice(-(cols.rollingN || 3)), cols.lockedMeasure)).accuracy, r1 = latestMonthAccuracy(r, cols);
      const ro = sr !== null && r1 !== null && Math.abs(r1 - sr) <= tol ? r1 : rN;
      const bad = (so !== null && o !== null && Math.abs(o - so) > tol) || (sr !== null && ro !== null && Math.abs(ro - sr) > tol);
      if (bad) mismatched.push({ key: comboKey(r), storedOverall: so, overall: o, storedRolling: sr, rolling: ro });
    }
    return { checked, mismatched };
  }

  // ---------- helpers that used to live in the page (§6, §8, §9, §11) ----------
  /** §6/§8 past month: Σ Sales and Σ forecast-of-record over rows that have one. */
  function forecastOfRecordSums(rows, month, priorIndex) {
    let A = 0, F = 0, used = 0;
    for (const r of rows) { const f = forecastOfRecord(r, month, priorIndex).F; if (f === null) continue; A += z(val(r, month, "Sales")); F += f; used++; }
    return { A, F, used };
  }
  /** §11 share of rows where Graph Reviewed or Table Edited differs from ML Forecast by ≥ 0.5 in any month. */
  function overrideShare(rows, months) {
    if (!rows.length) return null; let k = 0;
    for (const r of rows) if (months.some((m) => { const ml = val(r, m, "ML Forecast"); if (ml === null) return false;
      return ["Graph Reviewed Forecast", "Table Edited Forecast"].some((x) => { const v = val(r, m, x); return v !== null && Math.abs(v - ml) >= 0.5; }); })) k++;
    return (k / rows.length) * 100;
  }
  /** §9 safety stock units = Safety Stock Days × Forecast ÷ days in month (vars = pivoted supply-plan variables). */
  function safetyStockUnits(vars, m, grain) { const d = num((vars["Safety Stock Days"] || {})[m]), f = num((vars["Forecast"] || {})[m]); return d === null || f === null ? null : (d * f) / periodDays(m, grain || "month"); }
  /** §9 aggregated days on inventory = Σ End Inventory ÷ Σ (Forecast ÷ days in month). */
  function aggregatedDays(entries, m, grain) { let e = 0, f = 0; for (const x of entries) { e += z((x.vars["End Inventory"] || {})[m]); f += z((x.vars["Forecast"] || {})[m]) / periodDays(m, grain || "month"); } return f > 0 ? e / f : null; }
  /** §9 reorder now is due: quantity > 0 and TG Reorder Date on or before the as-of date (blank date = due). */
  function reorderDue(r, asOf) { return z(r.updated_TG_Reorder_now) > 0 && (!r["TG Reorder Date"] || r["TG Reorder Date"] <= asOf); }

  // ---------- contribution & AB (§5.1, §5.2) ----------
  function last3Closed(cols) { return cols.history.slice(-3); }
  function contribution(selRows, allRows, cols) {
    const ms = last3Closed(cols);
    const s = (rows) => rows.reduce((t, r) => t + ms.reduce((u, m) => u + z(val(r, m, "Sales")), 0), 0);
    const tot = s(allRows);
    return tot > 0 ? (s(selRows) / tot) * 100 : null;
  }

  // ---------- forecast of record (§3) ----------
  /** priorIndex: Map comboKey -> row of the previous run (optional) */
  function forecastOfRecord(row, month, priorIndex) {
    const l = LOCKED === STORED ? null : val(row, month, LOCKED);
    if (l !== null) return { F: l, source: lockLabel() };
    if (priorIndex) {
      const p = priorIndex.get(comboKey(row));
      const f = p ? val(p, month, "Forecast") : null;
      if (f !== null) return { F: f, source: "Prior run consensus" };
    }
    return { F: null, source: null };
  }

  // ---------- top movers (§6) ----------
  function topMovers(rows, month, opts) {
    const { grain = "sku", topN = 10, priorIndex = null, timeGrain = "month", by = null } = opts || {};
    // by = a granularity (§4.10) — any columns, ts_id or Overall; grain "sku" | "combo" kept for older callers
    const key = by ? granularityKey(by) : grain === "sku" ? (r) => r.product_variant_code : comboKey;
    const groups = groupBy(rows, key);
    const lyMonth = lyOf(month, timeGrain);
    const out = [];
    for (const [k, rs] of groups) {
      let A = 0, F = 0, LY = 0, used = 0;
      for (const r of rs) {
        const f = forecastOfRecord(r, month, priorIndex).F;
        if (f === null) continue;
        A += z(val(r, month, "Sales")); F += f; LY += z(val(r, lyMonth, "Sales")); used++;
      }
      if (!used) continue;
      const dev = A - F;
      out.push({
        key: k, parts: by ? granularityParts(by, rs[0]) : null, rows: rs, sku: rs[0].product_variant_code, name: displayName(rs[0]),
        lifestage: rs[0].Lifestage, A, F, LY, deviation: dev,
        deviationPct: F > 0 ? (dev / F) * 100 : null,
        streak: streak(rs, month, priorIndex, timeGrain),
      });
    }
    const over = out.filter((x) => x.deviation > 0).sort((a, b) => b.deviation - a.deviation).slice(0, topN);
    const under = out.filter((x) => x.deviation < 0).sort((a, b) => a.deviation - b.deviation).slice(0, topN);
    return { over, under };
  }
  function streak(rows, month, priorIndex, timeGrain) {
    const signAt = (m) => {
      let A = 0, F = 0, used = 0;
      for (const r of rows) {
        const f = forecastOfRecord(r, m, priorIndex).F;
        if (f === null) continue; A += z(val(r, m, "Sales")); F += f; used++;
      }
      return used ? Math.sign(A - F) : null;
    };
    const s0 = signAt(month);
    if (!s0) return { n: 0, dir: 0 };
    let n = 1;
    for (let k = 1; k < T.STREAK_LOOKBACK; k++) {
      if (signAt(periodShift(month, -k, timeGrain || "month")) === s0) n++; else break;
    }
    return { n, dir: s0 };
  }

  // ---------- YoY (§7) ----------
  function yoyPct(ty, ly) { return ty === null || ly === null || ly === 0 ? null : ((ty - ly) / ly) * 100; }
  function yoySeries(rows, cols, months) {
    return months.map((m) => {
      const isHist = cols.history.includes(m);
      const ty = isHist ? sumMeasure(rows, m, "Sales") : sumMeasure(rows, m, "Forecast");
      const ly = isHist ? sumMeasure(rows, lyOf(m, cols.grain), "Sales") : sumMeasure(rows, m, "LY Sales");
      return { month: m, kind: isHist ? "actual" : "forecast", ty, ly, yoy: yoyPct(ty, ly) };
    });
  }

  // ---------- pacing (§8) ----------
  /** §8 The three dates of pacing. Pacing is measured at DATA-THROUGH (last day with sales), never at the
   *  viewer's today: sales after data-through are not in the data, so using today would make everything look
   *  behind. today is used only to say how old the data is and to mark today on the chart.
   *  → { today, todayDay (1-based day of the period, may be < 1 or > D), todayInPeriod, dataLagDays, stale } */
  function pacingClock(periodStart, periodEnd, dataThrough, today) {
    if (!today) return { today: null, todayDay: null, todayInPeriod: false, dataLagDays: null, stale: false };
    const lag = dataThrough ? daysBetween(dataThrough, today) : null;
    return { today, todayDay: daysBetween(periodStart, today) + 1, todayInPeriod: today >= periodStart && today <= periodEnd,
      todayAfterPeriod: today > periodEnd, dataLagDays: lag, stale: lag !== null && lag > T.PACE_STALE_DAYS };
  }

  /** §8 period-to-date pacing from a single period total (monthly or weekly experiments).
   *  monthEnd = the period's date column; grain/anchor say which calendar days it covers. */
  function pacing({ mtd, monthForecast, asOf, monthEnd, weights, includeRunDay = false, grain = "month", anchor = "end", dataThrough = null, today = null }) {
    const D = periodDays(monthEnd, grain), r = periodRange(monthEnd, grain, anchor);
    const sameMonth = asOf >= r.start && asOf <= r.end;
    const day = sameMonth ? daysBetween(r.start, asOf) + 1 : D;
    // dataThrough (the run's activity_end_date) is the last day with sales in the data — use it when known;
    // otherwise assume data runs through the day before the run (or the run day with includeRunDay).
    let elapsed, open;
    if (dataThrough) { elapsed = Math.min(D, Math.max(0, daysBetween(r.start, dataThrough) + 1)); open = elapsed < D; }
    else { elapsed = Math.min(D, Math.max(1, includeRunDay ? day : day - 1)); open = sameMonth; }
    const w = Array.from({ length: D }, (_, i) => (weights && num(weights[i + 1]) !== null ? num(weights[i + 1]) : 1));
    const total = w.reduce((a, b) => a + b, 0);
    const share = (d) => w.slice(0, d).reduce((a, b) => a + b, 0) / total;
    const exp = open ? share(elapsed) : 1;
    const banked = monthForecast > 0 ? (mtd / monthForecast) * 100 : null;
    const idx = banked === null || exp === 0 ? null : banked / (exp * 100);
    const status = idx === null ? null : idx < T.PACE_BEHIND ? "Behind" : idx < T.PACE_NEAR ? "Near" : idx <= T.PACE_AHEAD ? "On" : "Ahead";
    const projected = exp > 0 ? mtd / exp : null;
    return {
      daysInMonth: D, periodDays: D, periodStart: r.start, periodEnd: r.end, elapsed, dataThrough: dataThrough || addDays(r.start, Math.max(0, elapsed - 1)), dataThroughSource: dataThrough ? "activity_end_date" : "assumed", expectedShare: exp, bankedPct: banked, paceIndex: idx, status,
      clock: pacingClock(r.start, r.end, dataThrough || addDays(r.start, Math.max(0, elapsed - 1)), today),
      projected, gap: projected === null ? null : projected - monthForecast,
      weighted: !!weights && w.some((x) => x !== 1),
      expectedCurve: Array.from({ length: D }, (_, i) => monthForecast * share(i + 1)),
      bands: { behind: 0.85 * exp * 100, near: 0.95 * exp * 100, on: 1.05 * exp * 100 },
    };
  }

  /** §8 daily experiments: pace the calendar month that contains asOf from real daily data.
   *  Plan of a day = forecast-of-record for a closed day (Locked Lag-1, else prior run Forecast), Forecast for
   *  the current and later days. Elapsed days = closed days of the month (plus the run day if includeRunDay).
   *  Expected share = Σ plan of elapsed days ÷ Σ plan of the month — the forecast itself shapes the curve. */
  function pacingDaily(rows, cols, asOf, opts) {
    const { priorIndex = null, includeRunDay = false, dataThrough = null, today = null } = opts || {};
    const ym = asOf.slice(0, 7);
    const days = [...new Set([...cols.history, ...cols.future])].filter((d) => d.slice(0, 7) === ym).sort();
    const closed = new Set(cols.history);
    let missingPlanDays = 0;
    const plan = days.map((d) => {
      let s = 0, any = false;
      for (const r of rows) {
        const f = closed.has(d) ? forecastOfRecord(r, d, priorIndex).F : val(r, d, "Forecast");
        if (f !== null) { s += f; any = true; }
      }
      if (!any) missingPlanDays++;
      return s;
    });
    // With dataThrough (the run's last update — sales complete through that day) every day up to it counts,
    // including the current day whose Sales column already holds that day's sales. Without it: closed days only.
    const elapsedIdx = days.map((d, i) => ((dataThrough ? d <= dataThrough && (closed.has(d) || val(rows[0] || {}, d, "Sales") !== null || rows.some((r) => val(r, d, "Sales") !== null)) : closed.has(d) || (includeRunDay && d === asOf)) ? i : -1)).filter((i) => i >= 0);
    const elapsed = elapsedIdx.length;
    const actual = days.map((d, i) => (elapsedIdx.includes(i) ? z(sumMeasure(rows, d, "Sales")) : null));
    const monthPlan = plan.reduce((a, b) => a + b, 0);
    const planToDate = elapsedIdx.reduce((t, i) => t + plan[i], 0);
    const mtd = elapsedIdx.reduce((t, i) => t + actual[i], 0);
    const exp = monthPlan > 0 ? planToDate / monthPlan : 0;
    const banked = monthPlan > 0 ? (mtd / monthPlan) * 100 : null;
    const idx = banked === null || exp === 0 ? null : banked / (exp * 100);
    const status = idx === null ? null : idx < T.PACE_BEHIND ? "Behind" : idx < T.PACE_NEAR ? "Near" : idx <= T.PACE_AHEAD ? "On" : "Ahead";
    const projected = exp > 0 ? mtd / exp : null;
    let cp = 0, ca = 0;
    return {
      daily: true, days, daysInMonth: days.length, periodDays: days.length, periodStart: days[0], periodEnd: days[days.length - 1],
      dataThrough: elapsedIdx.length ? days[elapsedIdx[elapsedIdx.length - 1]] : null,
      clock: pacingClock(days[0], days[days.length - 1], elapsedIdx.length ? days[elapsedIdx[elapsedIdx.length - 1]] : addDays(days[0], -1), today),
      elapsed, expectedShare: exp, bankedPct: banked, paceIndex: idx, status, projected,
      gap: projected === null ? null : projected - monthPlan, mtd, monthForecast: monthPlan, planToDate, missingPlanDays,
      weighted: true, expectedCurve: plan.map((v) => (cp += v)), actualCurve: actual.map((v) => (v === null ? null : (ca += v))),
      bands: { behind: 0.85 * exp * 100, near: 0.95 * exp * 100, on: 1.05 * exp * 100 },
    };
  }

  // ---------- inventory (§9) ----------
  function baseWarehouse(w) { return String(w || "").replace(/_(SH_Sub|SH|CS|IO|FBA|TT)$/, ""); }
  function warehouseSuffix(w) { const m = /_(SH_Sub|SH|CS|IO|FBA|TT)$/.exec(String(w || "")); return m ? m[1] : null; }
  function regionForWarehouse(w) { return WAREHOUSE_REGION[baseWarehouse(w)] || "UNKNOWN"; }
  function channelForWarehouse(w) {
    const s = warehouseSuffix(w) || (/^FBA-/.test(w) ? "FBA" : /^FBT-/.test(w) ? "TT" : null);
    if (!s) return null;
    if (s === "FBA") return regionForWarehouse(w) === "United Kingdom" ? "Marketplace UK" : "Marketplace US";
    return SUFFIX_CHANNEL[s];
  }
  function parsePyDict(s) {
    if (!s || s === "{}") return {};
    try { return JSON.parse(String(s).replace(/'/g, '"').replace(/\bNone\b/g, "null").replace(/\bnan\b/gi, "null")); }
    catch (e) { return {}; }
  }
  function parseOOS(details) {
    if (!details) return [];
    return String(details).split("|").map((x) => x.trim()).map((x) => {
      const m = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) \((\d+) days?\)/.exec(x);
      return m ? { start: m[1], end: m[2], days: Number(m[3]) } : null;
    }).filter(Boolean);
  }
  function inventoryTotals(rows, asOf) {
    const S = (k) => rows.reduce((t, r) => t + z(r[k]), 0);
    const risk = {}; RISK_ORDER.forEach((k) => (risk[k] = 0));
    for (const r of rows) if (r.Stock_Risk_Level in risk) risk[r.Stock_Risk_Level]++;
    const fpd = S("Forecast_Per_Day");
    return {
      risk,
      soh: S("Stock_On_Hand"), sohValue: S("soh_value"),
      reorderNow: S("updated_TG_Reorder_now"), reorderValue: S("Reorder_now_value"),
      excess: S("updated_Excess_Stock"), excessValue: S("Excess_Stock_value"),
      dead: S("Dead_Stock"), deadValue: S("Dead_Stock_value"),
      lostSales: S("Final_Potential_Sales_Loss"), lostSalesValue: S("Potential_Sales_Loss_value"),
      oosSkus: rows.filter((r) => z(r.OOS_Episode_Count) > 0).length,
      oosDays: S("Total_Projected_OOS_Days"),
      coverageDays: fpd > 0 ? S("Stock_On_Hand") / fpd : null,
      reorderDue: rows.filter((r) => reorderDue(r, asOf)).length,
    };
  }
  function pivotSupplyPlan(rows) {
    const out = new Map();
    for (const r of rows) {
      const k = r.component_sku + "|" + r.Warehouse;
      if (!out.has(k)) out.set(k, { sku: r.component_sku, warehouse: r.Warehouse, attrs: r, vars: {} });
      const months = {};
      for (const c in r) if (/^\d{4}-\d{2}-\d{2}$/.test(c)) months[c] = num(r[c]);
      out.get(k).vars[r.Variable] = months;
    }
    return out;
  }
  /** §11 Supply Plan at the item level: every location of an item summed. Day-ratio variables are left out
   *  (not summable — the page recomputes aggregated Days On Inventory). */
  function pivotSupplyPlanByItem(rows) {
    const out = new Map();
    for (const x of pivotSupplyPlan(rows).values()) {
      const k = String(x.sku);
      if (!out.has(k)) out.set(k, { sku: x.sku, warehouse: null, locations: 0, attrs: x.attrs, vars: {} });
      const o = out.get(k); o.locations++;
      for (const [v, ms] of Object.entries(x.vars)) {
        if (/Days/.test(v)) continue;
        const t = o.vars[v] || (o.vars[v] = {});
        for (const [m, n] of Object.entries(ms)) if (n !== null && n !== undefined) t[m] = (t[m] || 0) + n;
      }
    }
    return out;
  }
  const INV_SUM = ["Stock_On_Hand", "In Transit", "Open PO", "Sales Per Day", "Forecast_Per_Day", "updated_TG_Reorder_now", "updated_Excess_Stock",
    "Final_Potential_Sales_Loss", "Dead_Stock", "TG Safety Stock", "TG Reorder Point", "soh_value", "Reorder_now_value", "Excess_Stock_value",
    "Dead_Stock_value", "Potential_Sales_Loss_value", "Total_Projected_OOS_Days", "OOS_Episode_Count", "potential_stock_wastage", "potential_stock_wastage_value",
    "sales_last7days", "sales_last30days", "sales_last60days", "sales_last90days", "_fc30", "_fc60"];
  /** §11 DOI Details rolled up to the item: quantities and values summed over its locations, DOI recomputed
   *  (Σ on hand ÷ Σ forecast per day), worst risk level, earliest OOS / reorder date. */
  /** §11 DOI of a roll-up, the inventory report's rule: rank the member rows by stock on hand (largest first);
   *  if there is no second row or its on hand is below 70% of the largest, use the largest row's value, else the
   *  average of the top two rows' values (null when either is missing). Never summed, never recomputed.
   *  → { value, nodesUsed } */
  function doiTopNodes(rows, field) {
    const rk = rows.map((r) => ({ soh: num(r.Stock_On_Hand), v: num(r[field]) })).sort((a, b) => (b.soh ?? -Infinity) - (a.soh ?? -Infinity));
    if (!rk.length) return { value: null, nodesUsed: 0 };
    const [a, b] = rk;
    if (!b || b.soh === null || a.soh === null || b.soh < 0.7 * a.soh) return { value: a.v, nodesUsed: 1 };
    return { value: a.v === null || b.v === null ? null : (a.v + b.v) / 2, nodesUsed: 2 };
  }
  /** §11 DOI Details rows rolled up by keyFn (item, or item × base warehouse): quantities and values summed,
   *  Days on Inventory and DOI_Current_Stock by the top-node rule (doiTopNodes), worst risk level, earliest OOS /
   *  reorder date, longest lead time, `_locations` = member locations, `_nodes` = rows the DOI came from. */
  function inventoryRollup(rows, keyFn, fill) {
    const out = [];
    for (const [, rs] of groupBy(rows, keyFn)) {
      const o = { ...rs[0], ...(fill ? fill(rs[0]) : { Warehouse: null }), _locations: new Set(rs.map((r) => r.Warehouse)).size, _rows: rs.length };
      for (const f of INV_SUM) { let t = 0, any = false; for (const r of rs) { const v = num(r[f]); if (v !== null) { t += v; any = true; } } o[f] = any ? String(t) : null; }
      const dc = doiTopNodes(rs, "DOI_Current_Stock"), di = doiTopNodes(rs, "Days on Inventory");
      o.DOI_Current_Stock = dc.value === null ? null : String(dc.value); o["Days on Inventory"] = di.value === null ? null : String(di.value);
      o._nodes = Math.max(dc.nodesUsed, di.nodesUsed);
      o["Minimum Order Quantity"] = null;
      const lt = rs.map((r) => num(r.lead_time)).filter((v) => v !== null); o.lead_time = lt.length ? String(Math.max(...lt)) : null;
      const ri = (r) => { const i = RISK_ORDER.indexOf(r.Stock_Risk_Level); return i < 0 ? 99 : i; };
      o.Stock_Risk_Level = rs.slice().sort((a, b) => ri(a) - ri(b))[0].Stock_Risk_Level;
      const first = (k) => rs.map((r) => r[k]).filter(Boolean).sort()[0] || null;
      o.Current_OOS_Date = first("Current_OOS_Date"); o["TG Reorder Date"] = first("TG Reorder Date");
      o.OOS_Episode_Details = rs.map((r) => r.OOS_Episode_Details).filter(Boolean).join(" | ") || null;
      out.push(o);
    }
    return out;
  }
  /** §11 roll-up to the item (all locations) */
  const inventoryByItem = (rows) => inventoryRollup(rows, (r) => String(r.component_sku));
  /** §11 roll-up to item × base warehouse (allocation suffix _SH_Sub/_SH/_CS/_IO/_FBA/_TT removed) */
  const inventoryByBase = (rows) => inventoryRollup(rows, (r) => String(r.component_sku) + "|" + baseWarehouse(r.Warehouse), (r) => ({ Warehouse: baseWarehouse(r.Warehouse) }));
  /** §11 Forecast next 30 / 60 days per item × location from the Supply Plan's monthly Forecast: the first future
   *  month, and the first two (the report's fc_30 / fc_60). → Map("<item>|<location>" → { fc30, fc60 }) */
  function supplyForecastNext(spRows) {
    const out = new Map();
    for (const r of spRows || []) {
      if (r.Variable !== "Forecast") continue;
      const ms = Object.keys(r).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)).sort();
      if (!ms.length) continue;
      const k = String(r.component_sku) + "|" + String(r.Warehouse), v0 = num(r[ms[0]]), v1 = ms[1] ? num(r[ms[1]]) : null;
      const prev = out.get(k) || { fc30: 0, fc60: 0 };
      out.set(k, { fc30: prev.fc30 + (v0 || 0), fc60: prev.fc60 + (v0 || 0) + (v1 || 0) });
    }
    return out;
  }
  function supplyIdentityCheck(vars) {
    const B = vars["Beginning Inventory"] || {}, I = vars["Total Inbounds"] || {}, F = vars["Forecast"] || {}, E = vars["End Inventory"] || {};
    return Object.keys(E).sort().map((m) => {
      const expect = Math.max(0, z(B[m]) + z(I[m]) - z(F[m]));
      return { month: m, expected: expect, actual: z(E[m]), ok: Math.abs(expect - z(E[m])) <= 1 };
    });
  }

  // ---------- ABC / XYZ (§10) ----------
  function abcClassify(items, aCut = T.ABC_A, bCut = T.ABC_B) {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const tot = sorted.reduce((t, x) => t + Math.max(0, x.value), 0);
    let cum = 0;
    return sorted.map((x) => {
      const before = tot > 0 ? (cum / tot) * 100 : 100;
      cum += Math.max(0, x.value);
      const cls = before < aCut ? "A" : before < bCut ? "B" : "C";
      return { ...x, share: tot > 0 ? (x.value / tot) * 100 : 0, cumShare: tot > 0 ? (cum / tot) * 100 : 0, abc: cls };
    });
  }
  function cov(values) {
    const v = values.map(z); const n = v.length; if (!n) return null;
    const mean = v.reduce((a, b) => a + b, 0) / n; if (mean === 0) return null;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return sd / mean;
  }
  function xyzClassify(c, xCut = T.XYZ_X, yCut = T.XYZ_Y) {
    if (c === null) return "No demand";
    return c <= xCut ? "X" : c <= yCut ? "Y" : "Z";
  }

  // ---------- anomalies (§12) ----------
  function detectAnomalies(row, cols, allContribution) {
    const out = [];
    const h = cols.history, A = (m) => z(val(row, m, "Sales"));
    const important = row.AB_Class === "A" || z(allContribution ?? row["% Contribution Last 3 Months"]) >= T.IMPORTANT_CONTRIB;
    const sev = important ? "High" : "Medium";
    const last = h[h.length - 1];
    if (h.length >= 7) {
      const prev = h.slice(-7, -1).map(A); const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
      const sd = Math.sqrt(prev.reduce((a, b) => a + (b - mean) ** 2, 0) / prev.length);
      if (mean >= T.MIN_BASE && sd > 0) {
        const zz = (A(last) - mean) / sd;
        if (zz >= T.Z_SPIKE) out.push({ code: "SPIKE", severity: sev, z: zz, month: last });
        if (zz <= -T.Z_SPIKE) out.push({ code: "DROP", severity: sev, z: zz, month: last });
      }
    }
    if (h.slice(-6).some((m) => Math.abs(A(m) - z(val(row, m, "Raw Actual"))) > 0.5) || String(row["Imputation Flag"]) === "1")
      out.push({ code: "CLEANED", severity: "Info" });
    const l3 = h.slice(-3).map(A); const mean3 = l3.reduce((a, b) => a + b, 0) / (l3.length || 1);
    const f = cols.future.map((m) => z(val(row, m, "Forecast")));
    const next3 = f.slice(0, 3).reduce((a, b) => a + b, 0);
    if (mean3 >= T.MIN_BASE && f.length) {
      const ratio = f[0] / mean3;
      if (ratio < T.CLIFF_LOW || ratio > T.CLIFF_HIGH) out.push({ code: "CLIFF", severity: sev, ratio });
      if (next3 === 0) out.push({ code: "TO_ZERO", severity: "High" });
    }
    if (h.slice(-6).every((m) => A(m) === 0) && next3 > 0 && !/^New/i.test(row.Lifestage || ""))
      out.push({ code: "NO_HISTORY", severity: "Medium" });
    for (let i = 1; i < cols.future.length; i++) {
      const p = f[i - 1], c = f[i];
      if (p < T.MIN_BASE) continue;
      const r = c / p - 1;
      const lyP = val(row, cols.future[i - 1], "LY Sales"), lyC = val(row, cols.future[i], "LY Sales");
      const lyR = lyP && lyC !== null ? lyC / lyP - 1 : null;
      if (Math.abs(r) > T.SWING && (lyR === null || Math.abs(lyR) <= T.SWING_LY_TOL)) {
        out.push({ code: "SWING", severity: "Medium", month: cols.future[i], change: r * 100 }); break;
      }
    }
    if (row.AB_Class === "A" && (z(row.rolling_accuracy) < 0 || z(row.overall_accuracy) < T.ACC_FLOOR))
      out.push({ code: "ACCURACY", severity: "High" });
    return out;
  }

  // ---------- loading & caching (runtime-and-connector.md "Performance") ----------
  /** Validity stamp of a run's data: its last-update time (ms). null = the connector gave none → never persist. */
  function cacheStamp(e) {
    if (!e) return null;
    for (const k of ["updatedAt", "updated_at", "lastUpdatedAt", "last_updated_at", "modifiedAt", "modified_at"]) {
      const v = e[k]; if (v == null || v === "") continue;
      const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }
  /** Rows → compact columnar pack for storage ({ cols, data: [[…], …] }), ~half the size of row objects. */
  function packRows(rows) {
    const cols = []; const seen = new Set();
    for (const r of rows) for (const k in r) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return { cols, data: rows.map((r) => cols.map((c) => (r[c] === undefined ? null : r[c]))) };
  }
  function unpackRows(pack) {
    const { cols, data } = pack || { cols: [], data: [] };
    return data.map((a) => { const o = {}; for (let i = 0; i < cols.length; i++) if (a[i] !== null) o[cols[i]] = a[i]; return o; });
  }
  /** Pages to request for a dataset of `total` rows at `size` rows per page (1-based). total unknown → null. */
  function pagePlan(total, size) {
    if (!Number.isFinite(total) || total < 0 || !(size > 0)) return null;
    return Array.from({ length: Math.max(1, Math.ceil(total / size)) }, (_, i) => i + 1);
  }
  // ---------- large runs: keep only what the tabs read (runtime-and-connector.md "Large runs") ----------
  /** Dated Final DA measures the dashboard never reads — dropped on load to save memory. Unknown measures are kept. */
  const DROP_MEASURE_RE = /^(P(?!10$|50$|90$)\d+|RL Time Forecast|Offset Forecast|Lower Bound|Upper Bound|YoY Perc Change|Cons_Locked_Deviation|Bias|Accuracy|Deviation\b.*)$/;
  function keepColumn(column) {
    const m = COL_RE.exec(column);
    if (!m) return true;                                            // ids, dimensions, stored metrics
    const meas = m[2];
    if (DROP_MEASURE_RE.test(meas)) return false;
    if (/ Abs Error$/.test(meas)) return LOCK_RE.test(meas.replace(/ Abs Error$/, ""));   // only the locked forecast's stored error is read
    return true;
  }
  const projectColumns = (columns) => (columns || []).filter(keepColumn);
  /** One loaded row, compacted in place: unread dated columns removed, dated values stored as numbers. */
  function compactRow(r) {
    for (const k in r) {
      const m = COL_RE.exec(k);
      if (!m) continue;
      if (!keepColumn(k)) { delete r[k]; continue; }
      const v = r[k]; if (typeof v === "string") { const n = num(v); r[k] = n === null ? null : n; }
    }
    return r;
  }
  /** Rough in-browser cost of a table: rows × columns kept. */
  const tableCells = (rows, columns) => (Number.isFinite(rows) ? rows : 0) * ((columns || []).length || 0);
  /** Values the browser can hold safely: ~6M per GB of device memory (navigator.deviceMemory, default 4 GB). */
  const cellBudget = (deviceMemoryGb) => Math.round((Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0 ? Math.min(deviceMemoryGb, 16) : 4) * 6e6);
  function normalizeRow(r) { return r; } // values stay strings; read through num()/val()

  const api = {
    T, WAREHOUSE_REGION, SUFFIX_CHANNEL, RISK_ORDER,
    num, parseColumns, col, val, monthShift, daysInMonth, monthLabel, comboKey, displayName,
    GRAIN, detectGrain, grainFromFrequency, pacingClock, ALIASES, aliasMap, applyAliases, runConfig, setupDiff, tsIdCheck, setTsIdColumns, tsIdColumns, periodShift, lyOf, periodDays, periodAnchor, periodRange, periodLabel, addDays, daysBetween,
    pickDefaultSource, previousRun, asOfDate, lastUpdatedDate, dataThroughDate, UPDATED_FIELDS,
    applyFilters, sumMeasure, series, groupBy,
    accuracy, bias, wape, lockedCells, overallAccuracy, latestMonthAccuracy, rollingBias3, aggregatedAccuracy,
    rollingAccuracy3, rollingAggregatedAccuracy, accuracySummary, reconcileAbsError, reconcileRowAccuracy,
    LOCKED_DEFAULT, STORED, LOCK_RE, applyAccuracyBasis, lockLabel, TS_GRAN, TRUST_ORDER, normalizeGranularity, granularityKey, granularityParts, granularityColumns, groupByGranularity,
    forecastMeasures, periodWindow, accuracyReport, granularReport, trustZoneSummary, accuracyDrops,
    TRUST_CUTS, trustZoneOf, levelCells, levelReport, granularTrust,
    constrainedTarget, VALID, VALID_ACT, applyForecastData, trustZoneFD, fdSeriesAccuracy,
    GRAIN_RANK, runFrequency, coarsestGrain, rollupPeriod, rollupSeries, lagBetween, forecastConsistency,
    forecastOfRecordSums, overrideShare, safetyStockUnits, aggregatedDays, reorderDue, prepareRoster, monthlyRuns, runsByPeriod, pacingDaily,
    contribution, forecastOfRecord, topMovers, streak,
    yoyPct, yoySeries, pacing,
    baseWarehouse, warehouseSuffix, regionForWarehouse, channelForWarehouse, parsePyDict, parseOOS,
    inventoryTotals, pivotSupplyPlan, pivotSupplyPlanByItem, inventoryByItem, inventoryByBase, inventoryRollup, doiTopNodes, supplyForecastNext, supplyIdentityCheck,
    abcClassify, cov, xyzClassify, detectAnomalies, normalizeRow, cacheStamp, packRows, unpackRows, pagePlan, keepColumn, projectColumns, compactRow, tableCells, cellBudget,
  };
  Object.defineProperty(api, "LOCKED", { get: () => LOCKED, enumerable: true });
  /** for tests / a run switch: reset the current basis */
  api.resetAccuracyBasis = () => { LOCKED = LOCKED_DEFAULT; };
  /** make an already-resolved cols the current basis (C.LOCKED) without re-checking */
  api.useAccuracyBasis = (cols) => { if (cols && cols.lockedMeasure) LOCKED = cols.lockedMeasure; };
  return api;
});
