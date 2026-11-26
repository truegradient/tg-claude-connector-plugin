/*
 * Run: node scripts/test_tg_calc.js
 * Verifies tg_calc.js against (a) TrueGradient's stored per-row fields on real rows
 * observed from the connector and (b) worked examples from the reference dashboard.
 * Every assertion names the calculations.md section it protects.
 */
const C = require("./tg_calc.js");
let pass = 0, fail = 0;
function eq(name, got, want, tol = 0.01) {
  const ok = typeof want === "number" ? got !== null && Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// --- fixtures: locked window Mar–Aug 2026, Sales & Locked ML Lag_1 (strings, as the connector returns)
const L = ["2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"];
function mkRow(sales, locked, extra = {}) {
  const r = { ...extra };
  L.forEach((m, i) => { r[m + " Sales"] = String(sales[i]); r[m + " Raw Actual"] = String(sales[i]); r[m + " Locked ML Forecast Lag_1"] = String(locked[i]); });
  return r;
}
const cols = C.parseColumns([...L.map((m) => m + " Raw Actual"), ...L.map((m) => m + " Locked ML Forecast Lag_1"), "2026-11-30 Forecast", "2026-12-31 Forecast"]);
const rows = [
  { id: "ITEM-C1/Social", stored: [38.68, 44.9], r: mkRow([2387, 520, 2058, 572, 1860, 2704], [547, 1116, 1313, 967, 732, 1214]) },
  { id: "ITEM-B1/Web store", stored: [67.59, 52.0], r: mkRow([442, 769, 1570, 562, 1186, 2444], [679, 723, 1116, 319, 1079, 1271]) },
  { id: "ITEM-C2/Social", stored: [22.29, 58.23], r: mkRow([70, 4446, 896, 554, 1006, 1628], [49, 35, 66, 140, 679, 948]) },
  { id: "ITEM-C3/Social", stored: [6.43, 67.42], r: mkRow([13, 50, 435, 243, 465, 396], [336, 247, 77, 133, 83, 267]) },
  { id: "ITEM-C4/Web store (value)", stored: [12.93, -151.36], r: mkRow([1467370, 1345200, 1353180, 415150, 145160, 236740], [1130310, 34390, 2057700, 851200, 1082810, 831820]) },
  { id: "ITEM-C5 (zero locked)", stored: [0, 0], r: mkRow([0, 0, 330, 2065, 7090, 16950], [0, 0, 0, 0, 0, 0]) },
];
console.log("\n§4 accuracy reproduces stored overall_accuracy / rolling_accuracy");
for (const x of rows) {
  eq(`overall ${x.id}`, C.overallAccuracy(x.r, cols), x.stored[0]);
  eq(`rolling ${x.id}`, C.latestMonthAccuracy(x.r, cols), x.stored[1]);
}

console.log("\n§4 month-end accuracy & bias (reference dashboard row ITEM-A1)");
eq("consensus accuracy", C.accuracy(10944, 8054), 64.1, 0.05);
eq("consensus bias", C.bias(10944, 8054), 135.9, 0.05);
eq("lag-1 accuracy", C.accuracy(9588, 8054), 81.0, 0.05);
eq("lag-1 bias", C.bias(9588, 8054), 119.0, 0.05);
eq("A=0,F=0 → 100", C.accuracy(0, 0), 100);
eq("A=0,F>0 → 0", C.accuracy(5, 0), 0);
eq("bias A=0 → null", C.bias(5, 0), null);

console.log("\n§4 bottom-up WAPE vs aggregate-first");
const two = [mkRow([100, 100, 100, 100, 100, 100], [150, 150, 150, 150, 150, 150]), mkRow([100, 100, 100, 100, 100, 100], [50, 50, 50, 50, 50, 50])];
eq("bottom-up accuracy (errors don't cancel)", C.wape(C.lockedCells(two, cols.locked)).accuracy, 50);
eq("aggregate-first accuracy (errors cancel)", C.aggregatedAccuracy(two, cols.locked).accuracy, 100);
eq("rolling bias 3mo", C.rollingBias3([rows[0].r], cols), (967 + 732 + 1214) / (572 + 1860 + 2704) * 100);

console.log("\n§5.1 contribution");
const H = ["2026-08-31", "2026-09-30", "2026-10-31"];
const cc = C.parseColumns(H.map((m) => m + " Raw Actual"));
const sel = { [H[0] + " Sales"]: "2704", [H[1] + " Sales"]: "1561", [H[2] + " Sales"]: "2169" };
const rest = { [H[0] + " Sales"]: String(155789 - 6434), [H[1] + " Sales"]: "0", [H[2] + " Sales"]: "0" };
eq("contribution 6,434 / 155,789", C.contribution([sel], [sel, rest], cc), 4.13, 0.005);

console.log("\n§6 top movers deviation and streak");
const tm = {};
["2026-06-30", "2026-07-31", "2026-08-31"].forEach((m, i) => { tm[m + " Sales"] = String([1100, 1300, 5514][i]); tm[m + " Locked ML Forecast Lag_1"] = String([1000, 1000, 4024][i]); });
Object.assign(tm, { product_variant_code: "ITEM-A2", channel_name: "Web store", Region_name: "US" });
const mv = C.topMovers([tm], "2026-08-31", { grain: "sku", topN: 10 });
eq("deviation", mv.over[0].deviation, 1490);
eq("deviation %", mv.over[0].deviationPct, 37.0, 0.05);
eq("streak 3mo up", mv.over[0].streak, { n: 3, dir: 1 });

console.log("\n§8 pacing");
const p = C.pacing({ mtd: 61358, monthForecast: 125220, asOf: "2026-10-15", monthEnd: "2026-10-31" });
eq("elapsed = day(asOf) − 1", p.elapsed, 14);
eq("flat expected share", p.expectedShare, 14 / 31, 1e-9);
eq("banked %", p.bankedPct, 61358 / 125220 * 100);
eq("status", p.status, "Ahead");
const pw = C.pacing({ mtd: 50, monthForecast: 100, asOf: "2026-11-03", monthEnd: "2026-11-30", weights: { 1: 3, 2: 3 } });
eq("weighted expected share (promo days 1–2 ×3)", pw.expectedShare, 6 / (6 + 28), 1e-9);

console.log("\n§9 inventory mapping & parsing");
eq("base warehouse", C.baseWarehouse("WH_US_1_SH_Sub"), "WH_US_1");
eq("region FBA-US_FBA", C.regionForWarehouse("FBA-US_FBA"), "United States");
eq("region FBT-UK_TT", C.regionForWarehouse("FBT-UK_TT"), "United Kingdom");
eq("region WH_ROW_1_CS", C.regionForWarehouse("WH_ROW_1_CS"), "ROW");
eq("channel WH_UK_1_SH_Sub", C.channelForWarehouse("WH_UK_1_SH_Sub"), "Web store subscription");
eq("channel FBA-US_FBA", C.channelForWarehouse("FBA-US_FBA"), "Marketplace US");
eq("py dict", C.parsePyDict("{'WH_US_1_FBA': 1083.0}"), { WH_US_1_FBA: 1083 });
eq("OOS episodes", C.parseOOS("2026-11-23 to 2026-12-02 (9 days) | 2027-01-05 to 2027-01-31 (26 days)").map((e) => e.days), [9, 26]);
const inv = C.inventoryTotals([{ Stock_On_Hand: "31977.0", Forecast_Per_Day: "733.84", Stock_Risk_Level: "LowInventory", updated_TG_Reorder_now: "76319", "TG Reorder Date": "2026-11-02", OOS_Episode_Count: "2" }], "2026-11-02");
eq("reorder due", inv.reorderDue, 1);
eq("coverage days", inv.coverageDays, 31977 / 733.84);
const sp = C.supplyIdentityCheck({ "Beginning Inventory": { m: 100 }, "Total Inbounds": { m: 20 }, Forecast: { m: 50 }, "End Inventory": { m: 70 } });
eq("supply identity", sp[0].ok, true);

console.log("\n§10 ABC / XYZ");
const abc = C.abcClassify([{ k: "a", value: 70 }, { k: "b", value: 15 }, { k: "c", value: 10 }, { k: "d", value: 5 }]);
eq("ABC classes", abc.map((x) => x.abc), ["A", "A", "B", "C"]);
eq("CoV flat → X", C.xyzClassify(C.cov([10, 10, 10, 10])), "X");
eq("CoV lumpy → Z", C.xyzClassify(C.cov([0, 0, 0, 40])), "Z");
eq("zero demand", C.xyzClassify(C.cov([0, 0])), "No demand");

console.log("\n§1 source selection");
const ex = [
  { id: "e4", tag: "LT DP", isProduction: false, isArchive: false, createdAt: 4 },
  { id: "e3", tag: "Promo", isProduction: false, isArchive: false, createdAt: 3 },
  { id: "e2", tag: "Baseline", isProduction: true, isArchive: false, createdAt: 2 },
  { id: "e1", tag: "Promo", isProduction: true, isArchive: false, createdAt: 1 },
];
const s1 = C.pickDefaultSource(ex);
eq("live = not archived, production not needed: opens on newest live run", s1.experimentId, "e4");
eq("opening pipeline = newest live run's pipeline", s1.pipeline, "LT DP");
eq("non-production run is live", s1.isLive, true);
eq("production flag kept separate", s1.isProduction, false);
eq("multi pipeline", s1.multiPipeline, true);
eq("all 3 pipelines listed", s1.pipelines, ["LT DP", "Promo", "Baseline"]);
eq("pipeline default = its live production run", s1.defaultFor("Promo"), "e1");
eq("pipeline without production → newest live", s1.defaultFor("LT DP"), "e4");
eq("all archived → nothing live, first completed", C.pickDefaultSource([{ id: "x", tag: "Baseline", isProduction: true, isArchive: true, createdAt: 1 }]).isLive, false);
eq("saved override honoured", C.pickDefaultSource(ex, { experimentId: "e3" }).experimentId, "e3");
eq("stale override ignored", C.pickDefaultSource(ex, { experimentId: "gone" }).savedIgnored, true);

console.log("\nmonth helpers");
eq("monthShift −12", C.monthShift("2026-08-31", -12), "2025-08-31");
eq("monthShift into leap Feb", C.monthShift("2028-01-31", 1), "2028-02-29");
eq("num('nan')", C.num("nan"), null);


// =====================================================================================
// §4.9  TrueGradient all-level accuracy report — these MUST match to 2 decimals.
// Fixtures are rebuilt from the report's own monthly totals (Σ Sales, Σ |F−A|, Σ Locked
// Lag-1). WAPE depends only on these sums, so two rows per month (one over-, one under-
// forecast) reproduce every number in the report exactly.
// =====================================================================================
function reportFixture(totals) {
  const r1 = {}, r2 = {};
  totals.forEach(([m, A, E, F]) => {
    const over = (E + (F - A)) / 2, under = (E - (F - A)) / 2;
    if (!Number.isInteger(over) || over < 0 || under < 0) throw new Error("bad fixture " + m);
    const f1 = over, f2 = F - f1;                      // r1: A=0, F=over · r2: A=all, F=rest
    if (f2 < 0) throw new Error("negative f2 " + m);
    r1[m + " Sales"] = "0"; r1[m + " Locked ML Forecast Lag_1"] = String(f1); r1[m + " Locked ML Forecast Lag_1 Abs Error"] = String(f1);
    r2[m + " Sales"] = String(A); r2[m + " Locked ML Forecast Lag_1"] = String(f2); r2[m + " Locked ML Forecast Lag_1 Abs Error"] = String(Math.abs(f2 - A));
    r1[m + " Raw Actual"] = "0"; r2[m + " Raw Actual"] = String(A);
  });
  const ms = totals.map((t) => t[0]);
  const c = C.parseColumns([...ms.map((m) => m + " Raw Actual"), ...ms.map((m) => m + " Locked ML Forecast Lag_1"), "2026-11-30 Forecast"]);
  return { rows: [r1, r2], cols: c };
}
const REPORTS = [
  { name: "live run 0211_SKU_Channel_Region_Monthly (681 rows)",
    totals: [["2026-03-31", 35845, 32282, 34901], ["2026-04-30", 48490, 45612, 26354], ["2026-05-31", 50601, 52450, 55089],
             ["2026-06-30", 22960, 26533, 24789], ["2026-07-31", 23754, 35673, 36293], ["2026-08-31", 30289, 48078, 46135]],
    want: { overall: -13.54, rolling: -43.22, rollingBias: 139.24, months: [9.94, 5.94, -3.65, -15.56, -50.18, -58.73] } },
  { name: "run 0211_…_internal dataset (2,057 rows)",
    totals: [["2026-03-31", 35845, 35963, 38582], ["2026-04-30", 48490, 48350, 29092], ["2026-05-31", 81271, 73761, 55870],
             ["2026-06-30", 42983, 41247, 24970], ["2026-07-31", 50787, 58279, 36398], ["2026-08-31", 62928, 69770, 46190]],
    want: { overall: -1.57, rolling: -8.04, rollingBias: 68.64, months: [-0.33, 0.29, 9.24, 4.04, -14.75, -10.87] } },
];
console.log("\n§4.9 accuracySummary reproduces TrueGradient's all-level report");
for (const R of REPORTS) {
  const { rows: rr, cols: cc } = reportFixture(R.totals);
  const s = C.accuracySummary(rr, rr, cc);
  eq(`${R.name} overall`, +s.overall.toFixed(2), R.want.overall, 0.005);
  eq(`${R.name} rolling (3 mo)`, +s.rolling.toFixed(2), R.want.rolling, 0.005);
  eq(`${R.name} rolling bias`, +s.rollingBias.toFixed(2), R.want.rollingBias, 0.005);
  s.months.forEach((x, i) => eq(`${R.name} ${x.month}`, +x.accuracy.toFixed(2), R.want.months[i], 0.005));
  eq(`${R.name} rollingAccuracy3 = summary.rolling`, C.rollingAccuracy3(rr, cc), s.rolling, 1e-9);
  eq(`${R.name} rollingBias3 = summary.rollingBias`, C.rollingBias3(rr, cc), s.rollingBias, 1e-9);
  eq(`${R.name} contribution of all rows`, s.contribution, 100, 1e-9);
  eq(`${R.name} stored Abs Error reconciles`, C.reconcileAbsError(rr, cc).every((x) => x.ok), true);
}

console.log("\n§4 grain guard: summing rows before taking errors must NOT be used for headline numbers");
{
  // one product × channel with two region rows that err in opposite directions
  const m = "2026-08-31", mk = (A, F, reg) => ({ product_variant_code: "P", channel_name: "C", Region_name: reg, [m + " Sales"]: String(A), [m + " Raw Actual"]: String(A), [m + " Locked ML Forecast Lag_1"]: String(F) });
  const rr = [mk(100, 150, "US"), mk(100, 50, "UK")];
  const cc = C.parseColumns([m + " Raw Actual", m + " Locked ML Forecast Lag_1", "2026-11-30 Forecast"]);
  eq("row grain (TrueGradient): 1 − 100/200", C.accuracySummary(rr, rr, cc).overall, 50);
  eq("summed first would wrongly give 100", C.aggregatedAccuracy(rr, [m]).accuracy, 100);
}

console.log("\n§4 rolling aggregated (working definition)");
{
  const ms = ["2026-06-30", "2026-07-31", "2026-08-31"];
  const r = {}; [[100, 150], [100, 50], [100, 100]].forEach(([A, F], i) => { r[ms[i] + " Sales"] = String(A); r[ms[i] + " Raw Actual"] = String(A); r[ms[i] + " Locked ML Forecast Lag_1"] = String(F); });
  const cc = C.parseColumns([...ms.map((m) => m + " Raw Actual"), ...ms.map((m) => m + " Locked ML Forecast Lag_1"), "2026-11-30 Forecast"]);
  eq("rolling (per month) = 1 − 100/300", C.rollingAccuracy3([r], cc), 66.667, 0.01);
  eq("rolling aggregated (months summed per row) = 100", C.rollingAggregatedAccuracy([r], cc), 100);
}

console.log("\n§4.9 reconciliation flags drift");
{
  const m = "2026-08-31", cc = C.parseColumns([m + " Raw Actual", m + " Locked ML Forecast Lag_1", "2026-11-30 Forecast"]);
  const r = { [m + " Sales"]: "100", [m + " Raw Actual"]: "100", [m + " Locked ML Forecast Lag_1"]: "80", [m + " Locked ML Forecast Lag_1 Abs Error"]: "35", overall_accuracy: "65", rolling_accuracy: "65" };
  eq("abs error mismatch detected", C.reconcileAbsError([r], cc)[0].ok, false);
  eq("stored row accuracy matches (error = stored Abs Error when > 0, §4.12)", C.reconcileRowAccuracy([r], cc).mismatched.length, 0);
  eq("stored row accuracy drift detected", C.reconcileRowAccuracy([{ ...r, overall_accuracy: "70" }], cc).mismatched.length, 1);
}

console.log("\n§1 prepareRoster");
{
  const ex = [
    { id: "dp", module_name: "demand-planning", tag: null, createdAt: 3000, isProduction: false, isArchive: true },
    { id: "oct", module_name: "inventory-optimization", tag: "Baseline", createdAt: 1000, isProduction: false, isArchive: true },
    { id: "nov", module_name: "inventory-optimization", tag: "Baseline", createdAt: 2000, isProduction: false, isArchive: true },
    { id: "may", module_name: "inventory-optimization", tag: "Baseline", createdAt: 100, isProduction: true, isArchive: true },
  ];
  const p = C.prepareRoster(ex, true);
  eq("archived-only: nothing live", p.liveBasis, "none");
  eq("archived production run is not live", p.roster.find((e) => e.id === "may").isLive, false);
  eq("archived production run keeps its production flag", p.roster.find((e) => e.id === "may").isProduction, true);
  eq("default = newest full inventory run", C.pickDefaultSource(p.roster).experimentId, "nov");
  const q = C.prepareRoster([{ id: "a", createdAt: 1, isProduction: false, isArchive: false }, { id: "b", createdAt: 2, isProduction: false, isArchive: false }], false);
  eq("non-archived runs are live", q.liveBasis, "notArchived");
  eq("every non-archived run carries isLive", q.roster.map((e) => e.isLive), [true, true]);
  eq("newest non-archived is default", C.pickDefaultSource(q.roster).experimentId, "b");
  const r = C.prepareRoster([{ id: "old", createdAt: 1, isProduction: true, isArchive: false }, { id: "new", createdAt: 2, isProduction: false, isArchive: false }], false);
  eq("both live; production picks the default inside the pipeline", C.pickDefaultSource(r.roster).experimentId, "old");
  eq("non-production run is still live", r.roster.find((e) => e.id === "new").isLive, true);
  const m = C.prepareRoster([{ id: "p", createdAt: 1, isProduction: true, isArchive: false }, { id: "a", createdAt: 2, isProduction: false, isArchive: true }], false);
  eq("archived run is never live, even when a live one exists", m.roster.find((e) => e.id === "a").isLive, false);
}

console.log("\n§6 §9 §11 helpers");
{
  const m = "2026-08-31";
  eq("forecastOfRecordSums", C.forecastOfRecordSums([{ [m + " Sales"]: "10", [m + " Locked ML Forecast Lag_1"]: "12" }, { [m + " Sales"]: "5" }], m, null), { A: 10, F: 12, used: 1 });
  eq("overrideShare", C.overrideShare([{ [m + " ML Forecast"]: "10", [m + " Table Edited Forecast"]: "11" }, { [m + " ML Forecast"]: "10", [m + " Graph Reviewed Forecast"]: "10.2" }], [m]), 50);
  eq("safetyStockUnits 31 days", C.safetyStockUnits({ "Safety Stock Days": { [m]: "31" }, Forecast: { [m]: "62" } }, m), 62);
  eq("aggregatedDays", C.aggregatedDays([{ vars: { "End Inventory": { [m]: "62" }, Forecast: { [m]: "31" } } }], m), 62);
  eq("reorderDue blank date", C.reorderDue({ updated_TG_Reorder_now: "5" }, "2026-11-02"), true);
  eq("reorderDue future date", C.reorderDue({ updated_TG_Reorder_now: "5", "TG Reorder Date": "2027-01-01" }, "2026-11-02"), false);
}


console.log("\n§10 monthlyRuns: production run of each month, else the latest of that month");
{
  const d = (y, m, day) => Date.UTC(y, m - 1, day, 8);
  const ex = [
    { id: "nov-a", createdAt: d(2026, 11, 2), isProduction: false },
    { id: "oct-late", createdAt: d(2026, 10, 25), isProduction: false },
    { id: "oct-prod", createdAt: d(2026, 10, 2), isProduction: true, isArchive: true },
    { id: "sep-1", createdAt: d(2026, 9, 3), isProduction: false, isArchive: true },
    { id: "sep-2", createdAt: d(2026, 9, 20), isProduction: false, isArchive: true },
  ];
  const mr = C.monthlyRuns(ex);
  eq("months newest first", mr.map((x) => x.month), ["2026-11", "2026-10", "2026-09"]);
  eq("Oct → its production run (archived)", mr[1].defaultId, "oct-prod");
  eq("Oct reason", mr[1].defaultReason, "production");
  eq("Sep → latest of the month", mr[2].defaultId, "sep-2");
  eq("Sep reason", mr[2].defaultReason, "latest");
  eq("runs listed newest first", mr[1].runs.map((r) => r.id), ["oct-late", "oct-prod"]);
  const prepared = C.prepareRoster(ex, true).roster;   // archived production is not "live", but still the month's production run
  eq("after prepareRoster Oct still → production run", C.monthlyRuns(prepared)[1].defaultId, "oct-prod");
}


console.log("\n§0 time grain: daily / weekly / monthly read from the data");
{
  const wk = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23"], dy = ["2026-08-01", "2026-08-02", "2026-08-03"];
  eq("monthly columns → month", C.detectGrain(["2026-06-30", "2026-07-31", "2026-08-31"]), "month");
  eq("weekly columns → week", C.detectGrain(wk), "week");
  eq("daily columns → day", C.detectGrain(dy), "day");
  const wc = C.parseColumns([...wk.map((d) => d + " Raw Actual"), "2026-08-30 Forecast", "2026-09-06 Forecast"]);
  eq("parseColumns.grain weekly", wc.grain, "week");
  eq("periods per year weekly", wc.perYear, 52);
  eq("LY monthly = −12 months", C.lyOf("2026-08-31", "month"), "2025-08-31");
  eq("LY weekly = −364 days (same weekday)", C.lyOf("2026-08-30", "week"), "2025-08-31");
  eq("LY daily = −364 days", C.lyOf("2026-08-15", "day"), "2025-08-16");
  eq("shift weekly −2", C.periodShift("2026-08-30", -2, "week"), "2026-08-16");
  eq("week anchor: current on/after as-of → week ends", C.periodAnchor({ grain: "week", current: "2026-11-08" }, "2026-11-04"), "end");
  eq("week anchor: current before as-of → week starts", C.periodAnchor({ grain: "week", current: "2026-11-02" }, "2026-11-04"), "start");
  eq("week-end range", C.periodRange("2026-11-08", "week", "end"), { start: "2026-11-02", end: "2026-11-08" });
  eq("week-start range", C.periodRange("2026-11-02", "week", "start"), { start: "2026-11-02", end: "2026-11-08" });
  eq("labels", [C.periodLabel("2026-08-31", "month"), C.periodLabel("2026-08-30", "week"), C.periodLabel("2026-08-15", "day")], ["Aug'26", "Wk 30 Aug'26", "15 Aug'26"]);
}

console.log("\n§8 pacing — monthly unchanged, weekly period, daily from real days");
{
  const m = C.pacing({ mtd: 400, monthForecast: 3000, asOf: "2026-11-04", monthEnd: "2026-11-30" });
  eq("monthly: 3 of 30 days elapsed", m.elapsed, 3);
  eq("monthly: expected 10%", m.expectedShare, 0.1, 1e-9);
  eq("monthly: banked 13.3%", m.bankedPct, 13.333, 0.01);
  eq("monthly: pace index 1.33 → Ahead", [+(m.paceIndex.toFixed(2)), m.status], [1.33, "Ahead"]);
  const w = C.pacing({ mtd: 300, monthForecast: 1400, asOf: "2026-11-04", monthEnd: "2026-11-08", grain: "week", anchor: "end" });
  eq("weekly: week Mon 2 – Sun 8 Nov, 2 of 7 days elapsed", [w.periodStart, w.periodEnd, w.elapsed, w.periodDays], ["2026-11-02", "2026-11-08", 2, 7]);
  eq("weekly: expected 2/7", w.expectedShare, 2 / 7, 1e-9);
  eq("weekly: pace index = (300/1400) / (2/7) = 0.75 → Behind", [+(w.paceIndex.toFixed(2)), w.status], [0.75, "Behind"]);
  // daily: 1–3 Nov closed, 4 Nov = run day; plan 100/day except a 300 promo day on the 3rd
  const days = Array.from({ length: 30 }, (_, i) => "2026-11-" + String(i + 1).padStart(2, "0"));
  const hist = days.slice(0, 3), fut = days.slice(3);
  const r = {};
  hist.forEach((d, i) => { r[d + " Sales"] = String([90, 110, 330][i]); r[d + " Raw Actual"] = r[d + " Sales"]; r[d + " Locked ML Forecast Lag_1"] = String(i === 2 ? 300 : 100); });
  fut.forEach((d) => { r[d + " Forecast"] = "100"; });
  const dc = C.parseColumns([...hist.map((d) => d + " Raw Actual"), ...hist.map((d) => d + " Locked ML Forecast Lag_1"), ...fut.map((d) => d + " Forecast")]);
  const p = C.pacingDaily([r], dc, "2026-11-04");
  eq("daily: grain", dc.grain, "day");
  eq("daily: month plan = 2×100 + 300 + 27×100", p.monthForecast, 3200);
  eq("daily: 3 closed days elapsed", p.elapsed, 3);
  eq("daily: MTD = 90 + 110 + 330", p.mtd, 530);
  eq("daily: expected share = 500 / 3200", p.expectedShare, 500 / 3200, 1e-9);
  eq("daily: pace index = 530 / 500 = 1.06 → Ahead", [+(p.paceIndex.toFixed(2)), p.status], [1.06, "Ahead"]);
  eq("daily: actual curve is real cumulative sales", p.actualCurve.slice(0, 4), [90, 200, 530, null]);
}

console.log("\n§3 §7 LY and streak on weekly data");
{
  const wk = ["2025-08-31", "2026-08-16", "2026-08-23", "2026-08-30"];
  const r = { product_variant_code: "P", channel_name: "C", Region_name: "R" };
  wk.forEach((d, i) => { r[d + " Sales"] = String([50, 80, 90, 120][i]); r[d + " Raw Actual"] = r[d + " Sales"]; r[d + " Locked ML Forecast Lag_1"] = String([50, 100, 100, 100][i]); });
  const tm = C.topMovers([r], "2026-08-30", { grain: "combo", topN: 5, timeGrain: "week" });
  eq("weekly top mover LY = same week last year (2025-08-31)", tm.over[0].LY, 50);
  eq("weekly streak counts weeks: over this week only", tm.over[0].streak, { n: 1, dir: 1 });
  const wc = C.parseColumns(wk.map((d) => d + " Raw Actual"));
  eq("weekly yoySeries LY", C.yoySeries([r], wc, ["2026-08-30"])[0].ly, 50);
}

console.log("\n§10 runsByPeriod");
{
  const ex = [{ id: "w1a", createdAt: Date.UTC(2026, 10, 2, 9) }, { id: "w1b", createdAt: Date.UTC(2026, 10, 4, 9), isProduction: true }, { id: "w0", createdAt: Date.UTC(2026, 9, 28, 9) }];
  const rw = C.runsByPeriod(ex, "week");
  eq("weekly groups by ISO week (Monday)", rw.map((x) => x.period), ["2026-11-02", "2026-10-26"]);
  eq("week label", rw[0].label, "Wk of 2 Nov'26");
  eq("production run of the week", rw[0].defaultId, "w1b");
  eq("monthlyRuns = runsByPeriod month", C.monthlyRuns(ex).map((x) => x.month), ["2026-11", "2026-10"]);
  eq("safety stock units weekly = days × forecast ÷ 7", C.safetyStockUnits({ "Safety Stock Days": { d: "14" }, Forecast: { d: "70" } }, "d", "week"), 140);
}


console.log("\n§1.1 run configuration from tg_experiment_details");
{
  // shape of the live run's tg_experiment_details response (configuration metadata only)
  const details = { experiment_id: "x", series: { ts_id_columns: ["product_variant_code", "channel_name", "Region_name"], ts_id_description: "One time series per unique combination of: product_variant_code + channel_name + Region_name", timestamp_column: "create_date", date_format: "%Y-%m-%d", frequency: "M", frequency_label: "monthly", target_column: "quantity" },
    forecast: { forecast_horizon: 24, validation_horizon: 2, horizon_unit: "monthly", driver_columns: ["unit_price", "cost_price", "list_price"] },
    data_window: { activity_end_date: "2026-11-01", history: 730, input_datasets: [{ name: "custom_Sales_history" }] }, modelling: { metric: "WMAPE", candidate_models: ["Xgboost", "Lgbm"] } };
  const rc = C.runConfig(details);
  eq("ts_id columns", rc.tsIdColumns, ["product_variant_code", "channel_name", "Region_name"]);
  eq("frequency M → month", rc.grain, "month");
  eq("horizon 24, validation 2", [rc.horizon, rc.validationHorizon], [24, 2]);
  eq("activity end date", rc.activityEndDate, "2026-11-01");
  eq("metric", rc.metric, "WMAPE");
  eq("frequency codes", ["D", "W", "W-SUN", "M", "MS", "weekly", "Q"].map(C.grainFromFrequency), ["day", "week", "week", "month", "month", "week", null]);
  eq("empty details → nulls", [C.runConfig({}).tsIdColumns, C.runConfig({}).grain], [null, null]);
  const cc = C.parseColumns(["2026-08-02 Raw Actual", "2026-08-09 Raw Actual"], { grain: "month" });
  eq("config grain overrides detection", [cc.grain, cc.detectedGrain], ["month", "week"]);
  eq("setupDiff", C.setupDiff({ tsIdColumns: ["a"], grain: "week" }, { tsIdColumns: ["a", "b"], grain: "month" }), ["ts_id", "frequency"]);
}

console.log("\n§1.1 ts_id key follows the configuration");
{
  const r1 = { sku: "P", store: "S1", product_variant_code: "P", channel_name: "C", Region_name: "R" };
  eq("default key", C.comboKey(r1), "P|C|R");
  eq("unknown column rejected → default kept", C.setTsIdColumns(["sku", "nope"], ["sku", "store"]), ["product_variant_code", "channel_name", "Region_name"]);
  C.setTsIdColumns(["sku", "store"], ["sku", "store"]);
  eq("configured key", C.comboKey(r1), "P|S1");
  eq("tsIdCheck flags duplicates", C.tsIdCheck([r1, { ...r1 }, { ...r1, store: "S2" }]), { rows: 3, tsIds: 2, duplicated: 1, firstDuplicate: "P|S1", ok: false });
  C.setTsIdColumns(null);
  eq("reset to default", C.tsIdColumns(), ["product_variant_code", "channel_name", "Region_name"]);
}

console.log("\n§8 pacing uses the run's activity_end_date as data-through");
{
  const a = C.pacing({ mtd: 1200, monthForecast: 30000, asOf: "2026-11-02", monthEnd: "2026-11-30", dataThrough: "2026-11-01" });
  eq("data through 1 Nov → 1 of 30 days", [a.elapsed, a.dataThroughSource], [1, "activity_end_date"]);
  const b = C.pacing({ mtd: 0, monthForecast: 30000, asOf: "2026-11-01", monthEnd: "2026-11-30", dataThrough: "2026-10-31" });
  eq("data through last month → 0 days, no index", [b.elapsed, b.expectedShare, b.paceIndex], [0, 0, null]);
  const c = C.pacing({ mtd: 31200, monthForecast: 30000, asOf: "2026-11-02", monthEnd: "2026-10-31", dataThrough: "2026-11-01" });
  eq("closed month → expected 100%", [c.elapsed, c.expectedShare], [31, 1]);
  const d = C.pacing({ mtd: 8400, monthForecast: 30000, asOf: "2026-11-11", monthEnd: "2026-11-30" });
  eq("no data-through → day before the run (unchanged)", [d.elapsed, d.dataThrough, d.dataThroughSource], [10, "2026-11-10", "assumed"]);
}


console.log("\n§8 pacing dates: measured at data-through, today only reports how old the data is");
{
  const base = { mtd: 4800, monthForecast: 81000, asOf: "2026-11-02", monthEnd: "2026-11-30", dataThrough: "2026-11-01" };
  const a = C.pacing({ ...base, today: "2026-11-09" }), b = C.pacing(base);
  eq("elapsed = 1 day (sales through 1 Nov), not 9", a.elapsed, 1);
  eq("today does not change the maths", [a.expectedShare, a.bankedPct, a.paceIndex, a.projected], [b.expectedShare, b.bankedPct, b.paceIndex, b.projected]);
  eq("today = day 9 of the month", a.clock.todayDay, 9);
  eq("data is 8 days older than today → stale", [a.clock.dataLagDays, a.clock.stale], [8, true]);
  eq("fresh data (lag 1) is not stale", C.pacing({ ...base, today: "2026-11-02" }).clock.stale, false);
  eq("viewing after the period ends", C.pacing({ ...base, today: "2026-12-03" }).clock.todayAfterPeriod, true);
  eq("no today → clock empty", b.clock.today, null);
  const w = C.pacing({ mtd: 300, monthForecast: 1400, asOf: "2026-11-04", monthEnd: "2026-11-08", grain: "week", anchor: "end", dataThrough: "2026-11-03", today: "2026-11-06" });
  eq("weekly: today Fri = day 5 of Mon–Sun week, data 3 days old", [w.elapsed, w.clock.todayDay, w.clock.dataLagDays], [2, 5, 3]);
}


console.log("\n§1.2 data-through = the run's last update (daily refresh), inclusive");
{
  const created = Date.UTC(2026, 10, 2, 8, 29);
  eq("no last-updated field: run date", C.dataThroughDate({ createdAt: created }, { activityEndDate: "2026-11-01" }), { date: "2026-11-02", source: "run_date" });
  eq("last updated (ms) wins", C.dataThroughDate({ createdAt: created, updatedAt: Date.UTC(2026, 10, 8, 6) }, { activityEndDate: "2026-11-01" }), { date: "2026-11-08", source: "last_updated" });
  eq("last updated (ISO string)", C.lastUpdatedDate({ updated_at: "2026-11-08 06:00:00.123" }), "2026-11-08");
  eq("last updated (ISO Z)", C.lastUpdatedDate({ lastUpdatedAt: "2026-11-08T23:30:00Z" }), "2026-11-08");
  eq("later activity_end_date wins", C.dataThroughDate({ createdAt: created }, { activityEndDate: "2026-11-05" }), { date: "2026-11-05", source: "activity_end_date" });
  eq("as-of follows the last update", C.asOfDate({ createdAt: created, updatedAt: Date.UTC(2026, 10, 8) }), "2026-11-08");
  eq("prepareRoster keeps lastUpdated", C.prepareRoster([{ id: "a", createdAt: created, modifiedAt: "2026-11-08" }], false).roster[0].lastUpdated, "2026-11-08");
  const p = C.pacing({ mtd: 4800, monthForecast: 81000, asOf: "2026-11-08", monthEnd: "2026-11-30", dataThrough: "2026-11-08", today: "2026-11-09" });
  eq("updated 8 Nov → 8 of 30 days, data 1 day old (not stale)", [p.elapsed, p.clock.dataLagDays, p.clock.stale], [8, 1, false]);
  const q = C.pacing({ mtd: 4800, monthForecast: 81000, asOf: "2026-11-02", monthEnd: "2026-11-30", dataThrough: "2026-11-02", today: "2026-11-09" });
  eq("not refreshed since 2 Nov → 2 of 30 days, stale", [q.elapsed, q.clock.dataLagDays, q.clock.stale], [2, 7, true]);
}


console.log("\n§8 daily pacing counts the run day when sales are through it");
{
  const days = Array.from({ length: 30 }, (_, i) => "2026-11-" + String(i + 1).padStart(2, "0")), hist = days.slice(0, 3), fut = days.slice(3);
  const r = {}; hist.forEach((d, i) => { r[d + " Sales"] = String([90, 110, 330][i]); r[d + " Raw Actual"] = r[d + " Sales"]; r[d + " Locked ML Forecast Lag_1"] = String(i === 2 ? 300 : 100); });
  fut.forEach((d, i) => { r[d + " Forecast"] = "100"; r[d + " Sales"] = i === 0 ? "120" : "0"; });
  const cols = C.parseColumns([...hist.map((d) => d + " Raw Actual"), ...hist.map((d) => d + " Locked ML Forecast Lag_1"), ...fut.map((d) => d + " Forecast"), ...fut.map((d) => d + " Sales")]);
  const a = C.pacingDaily([r], cols, "2026-11-04", { dataThrough: "2026-11-04" });
  eq("data through run day 4 Nov → 4 days, MTD includes the run day", [a.elapsed, a.mtd, a.planToDate], [4, 650, 600]);
  const b = C.pacingDaily([r], cols, "2026-11-04", {});
  eq("no data-through → closed days only (unchanged)", [b.elapsed, b.mtd], [3, 530]);
}


console.log("\n§4.10 granularity, compare forecasts, date window");
{
  const P = ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31"];
  const mk = (item, cust, brand, zone, sales, lag1, lag3, budget) => {
    const r = { New_Item: item, "Customer ID": cust, brand_name: brand, trust_zone: zone };
    P.forEach((m, i) => { r[m + " Sales"] = String(sales[i]); r[m + " Raw Actual"] = String(sales[i]); r[m + " Locked ML Forecast Lag_1"] = String(lag1[i]);
      if (lag3) r[m + " Lock ML Forecast Lag_3"] = String(lag3[i]); r[m + " Budget"] = String(budget[i]); r[m + " Locked ML Forecast Lag_1 Abs Error"] = String(Math.abs(lag1[i] - sales[i])); });
    // Locked Lag-1 also locked AHEAD (future) on some runs: never scored
    r["2026-11-30 Locked ML Forecast Lag_1"] = "500"; r["2026-11-30 Forecast"] = "500"; r["2026-11-30 Sales"] = "0";
    return r;
  };
  const rs = [
    mk("I1", "C1", "Genie", "Trusted",  [100, 100, 100, 100, 100], [120, 80, 120, 80, 100], [100, 100, 100, 90, 110], [100, 100, 100, 100, 100]),
    mk("I1", "C2", "Genie", "Critical", [100, 100, 100, 100, 100], [80, 120, 80, 120, 100],  [100, 100, 100, 110, 90], [50, 50, 50, 50, 50]),
    mk("I2", "C1", "Diaper", "Review",  [50, 50, 0, 50, 50],       [50, 25, 10, 50, 100],   null,                     [50, 50, 50, 50, 50]),
  ];
  const colsG = C.parseColumns(Object.keys(rs[0]).concat(Object.keys(rs[2])));
  C.setTsIdColumns(["New_Item", "Customer ID"], Object.keys(rs[0]));
  eq("locked window = closed periods only (Nov locked-ahead excluded)", colsG.locked, P);
  eq("compare forecasts: Locked Lag-1 first, Lag-3 next, Budget; no Abs Error / Forecast (future only)", C.forecastMeasures(colsG).map((x) => x.measure), ["Locked ML Forecast Lag_1", "Lock ML Forecast Lag_3", "Budget"]);
  eq("normalize: ts_id is exclusive", C.normalizeGranularity(["brand_name", C.TS_GRAN]), [C.TS_GRAN]);
  eq("normalize: any number of columns (as the app), no blanks/dupes", C.normalizeGranularity(["a", "", "a", "b", "c", "d"]), ["a", "b", "c", "d"]);
  eq("key: overall", C.granularityKey([])(rs[0]), "All");
  eq("key: ts_id = comboKey", C.granularityKey([C.TS_GRAN])(rs[0]), "I1|C1");
  eq("key: two columns", C.granularityKey(["brand_name", "Customer ID"])(rs[0]), "Genie | C1");
  eq("parts: ts_id expands to its columns", C.granularityParts([C.TS_GRAN], rs[1]), ["I1", "C2"]);
  eq("parts: blank value shown as —", C.granularityParts(["x"], {}), ["—"]);
  const base = C.accuracySummary(rs, rs, colsG), rep = C.accuracyReport(rs, rs, colsG);
  eq("accuracyReport (default Lag-1) = accuracySummary: overall", rep.overall, base.overall);
  eq("accuracyReport = accuracySummary: rolling / rolling aggregated / rolling bias", [rep.rolling, rep.rollingAggregated, rep.rollingBias].map((v) => +v.toFixed(4)), [base.rolling, base.rollingAggregated, base.rollingBias].map((v) => +v.toFixed(4)));
  const ov = C.granularReport(rs, rs, colsG, { by: [] });
  eq("Overall granularity = one group equal to the headline", [ov.length, +ov[0].reports[C.LOCKED].overall.toFixed(4)], [1, +base.overall.toFixed(4)]);
  const byItem = C.granularReport(rs, rs, colsG, { by: ["New_Item"] });
  const tot = byItem.reduce((t, g) => t + g.reports[C.LOCKED].sums.absError, 0);
  eq("groups add up: Σ group abs error = total abs error", tot, base.sums.absError);
  const i1 = byItem.find((g) => g.key === "I1").reports[C.LOCKED];
  // I1: two customers over/under by 20 each month → bottom-up keeps the errors, total-first cancels them
  eq("I1 bottom-up overall (errors kept per ts_id)", i1.overall, (1 - 160 / 1000) * 100);
  eq("I1 aggregated (total first, errors net out)", i1.aggregated, 100);
  eq("sorted by contribution desc", byItem.map((g) => g.key), ["I1", "I2"]);
  const lag3 = C.accuracyReport(rs, rs, colsG, { measure: "Lock ML Forecast Lag_3" });
  eq("Lag-3 window = its own closed periods; rows without it skipped", [lag3.window.length, lag3.sums.cells], [5, 10]);
  const win = C.periodWindow(P, "2026-07-31", "2026-09-30");
  eq("periodWindow inclusive", win, ["2026-07-31", "2026-08-31", "2026-09-30"]);
  const w = C.accuracyReport(rs, rs, colsG, { window: win });
  eq("date window: rolling = last 3 periods of the window", w.rollingWindow, win);
  eq("date window: overall uses the window only", w.window, win);
  const tz = C.trustZoneSummary(rs, colsG);
  eq("trust zones in TrueGradient order with counts", tz.map((z) => [z.zone, z.count]), [["Trusted", 1], ["Review", 1], ["Critical", 1]]);
  eq("trust-zone contribution sums to 100", tz.reduce((t, z) => t + z.contribution, 0), 100);
  eq("accuracy drops: local minima ≥ 10 pts below the period before", C.accuracyDrops([60, 40, 55, 54, 30, 31, 70]), [1, 4]);
  eq("accuracy drops: small dips and nulls ignored", C.accuracyDrops([60, 55, null, 20, 25]), []);
  const tm = C.topMovers(rs, "2026-10-31", { by: ["Customer ID"], topN: 5 });
  eq("top movers at any granularity", [tm.under.map((x) => x.key), tm.under[0].parts, tm.under[0].deviation], [["C1"], ["C1"], -50]);
  C.setTsIdColumns(null);
}

console.log("\n§4.10 granularity on weekly and daily runs");
{
  const W = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"];
  const r = {}; W.forEach((d, i) => { r[d + " Sales"] = "10"; r[d + " Raw Actual"] = "10"; r[d + " Locked ML Forecast Lag_1"] = String([10, 10, 5, 15, 10][i]); });
  r["2026-10-11 Forecast"] = "10";
  const cw = C.parseColumns(Object.keys(r));
  eq("weekly grain detected", cw.grain, "week");
  const rp = C.accuracyReport([r], [r], cw);
  eq("weekly rolling = last 3 weeks", rp.rollingWindow, W.slice(-3));
  eq("weekly rolling accuracy", rp.rolling, (1 - 10 / 30) * 100);
  const D = Array.from({ length: 10 }, (_, i) => "2026-10-" + String(i + 1).padStart(2, "0"));
  const d = {}; D.forEach((x, i) => { d[x + " Sales"] = "4"; d[x + " Raw Actual"] = "4"; d[x + " Locked ML Forecast Lag_1"] = i < 7 ? "4" : "0"; });
  d["2026-10-11 Forecast"] = "4";
  const cd = C.parseColumns(Object.keys(d));
  eq("daily grain detected", cd.grain, "day");
  const rd = C.accuracyReport([d], [d], cd, { window: C.periodWindow(cd.locked, "2026-10-05", null) });
  eq("daily window + rolling last 3 days", [rd.window.length, rd.rollingWindow[0], rd.rolling], [6, "2026-10-08", 0]);
}


console.log("\n§4.11 trust zones from rolling accuracy, accuracy at a granularity level");
{
  // stored (rolling_accuracy → trust_zone) pairs observed on the live US run, incl. every edge value
  const obs = [[86.19,"Highly Trusted"],[80,"Highly Trusted"],[68235.71,"Highly Trusted"],[79.85,"Trusted"],[70.03,"Trusted"],[69.46,"Review"],[60,"Review"],
    [59.82,"Planner Review"],[40.05,"Planner Review"],[39.56,"Low Trust"],[20,"Low Trust"],[19.72,"Critical"],[0,"Critical"],[-205.53,"Critical"],[null,"Not Available"]];
  eq("trustZoneOf reproduces every stored zone", obs.map(([a]) => C.trustZoneOf(a)), obs.map(([, z]) => z));
  const P = ["2026-08-31", "2026-09-30", "2026-10-31"];
  const mk = (item, cust, s, f) => { const r = { New_Item: item, "Customer ID": cust, trust_zone: "x" }; P.forEach((m, i) => { r[m + " Sales"] = String(s[i]); r[m + " Raw Actual"] = String(s[i]); r[m + " Locked ML Forecast Lag_1"] = String(f[i]); }); r["2026-11-30 Forecast"] = "1"; return r; };
  const rs = [mk("I1", "C1", [100, 100, 100], [150, 150, 150]), mk("I2", "C1", [100, 100, 100], [50, 50, 50]), mk("I3", "C2", [100, 100, 100], [100, 100, 100])];
  const cl = C.parseColumns(Object.keys(rs[0]));
  C.setTsIdColumns(["New_Item", "Customer ID"], Object.keys(rs[0]));
  const ts = C.levelReport(rs, rs, cl, { by: [] }), cust = C.levelReport(rs, rs, cl, { by: ["Customer ID"] });
  eq("Overall level = ts_id WAPE (TrueGradient headline)", ts.overall, (1 - 300 / 900) * 100);
  eq("Customer level: C1 errors net inside the customer, C2 exact → 100", cust.overall, 100);
  eq("bias is the same at every level", [ts.bias, cust.bias], [100, 100]);
  eq("groups scored at customer level", [cust.groups, cust.groupsScored], [2, 2]);
  const gt = C.granularTrust(rs, cl, { by: ["Customer ID"] });
  eq("group zones from group rolling accuracy", gt.groups.map((g) => [g.key, g.zone]), [["C1", "Highly Trusted"], ["C2", "Highly Trusted"]]);
  const gi = C.granularTrust(rs, cl, { by: ["New_Item"] });
  eq("item level: I1 50% → Planner Review, I2 50% → Planner Review, I3 100% → Highly Trusted", gi.summary.map((z) => [z.zone, z.count]), [["Highly Trusted", 1], ["Planner Review", 2]]);
  eq("ts_id level uses the stored zone", C.granularTrust(rs, cl, { by: [C.TS_GRAN] }).summary.map((z) => z.zone), ["x"]);
  C.setTsIdColumns(null);
}


console.log("\n§4.12 accuracy basis: lag-N locked, activity end, past_accuracy_horizon, validation fallback");
{
  // live sample monthly run, row ITEM-A3 × Web store: global_lag_n 4, past_accuracy_horizon 3, activity_end 2026-11-01
  const M = ["2025-01-31","2025-02-28","2025-03-31","2025-04-30","2025-05-31","2025-06-30","2025-07-31","2025-08-31","2025-09-30","2025-10-31","2025-11-30","2025-12-31",
    "2026-01-31","2026-02-28","2026-03-31","2026-04-30","2026-05-31","2026-06-30","2026-07-31","2026-08-31","2026-09-30","2026-10-31"];
  const S = [94,174,187,203,153,159,131,181,337,203,1013,2984,11,108,83,396,295,213,96,119,129,64];
  const E = [651.28,196.18,17.75,46.01,123.83,14.2,42.47,1.98,135.78,51.94,79.41,1231.59,153.93,229.58,113.06,115.08,12.96,7.91,19,87,256,74];
  const L = [745.28,370.18,169.25,249.01,276.83,144.8,173.47,182.98,201.22,151.06,1092.41,1752.41,164.93,337.58,196.06,280.92,282.04,205.09,115,206,385,138];
  const r = { sku_standard: "ITEM-A3", Channel: "Web store", overall_accuracy: "50.08", rolling_accuracy: "-33.65", trust_zone: "Critical" };
  M.forEach((m, i) => { r[m + " Sales"] = String(S[i]); r[m + " Raw Actual"] = String(S[i]); r[m + " Locked ML Forecast Lag_4"] = String(L[i]); r[m + " Locked ML Forecast Lag_4 Abs Error"] = String(E[i]); });
  // locked ahead + a partial month of Sales after activity end, never scored
  r["2026-11-30 Locked ML Forecast Lag_4"] = "1233"; r["2026-11-30 Sales"] = "28"; r["2026-11-30 Forecast"] = "1217"; r["2026-11-30 Locked ML Forecast Lag_4 Abs Error"] = "1205";
  const cfgB = C.runConfig({ series: { frequency: "M" }, data_window: { activity_end_date: "2026-11-01" }, forecast: { validation_horizon: 2 }, accuracy: { global_lag_n: 4, past_accuracy_horizon: 3 } });
  eq("runConfig reads global_lag_n / past_accuracy_horizon", [cfgB.globalLagN, cfgB.pastAccuracyHorizon, cfgB.activityEndDate], [4, 3, "2026-11-01"]);
  const acc = { lagN: cfgB.globalLagN, rollingN: cfgB.pastAccuracyHorizon, activityEnd: cfgB.activityEndDate, validationHorizon: cfgB.validationHorizon };
  const cb = C.applyAccuracyBasis([r], C.parseColumns(Object.keys(r), { accuracy: acc }), { current: true });
  eq("scores the lag-N locked column (global_lag_n = 4)", [cb.accPath, cb.lockedMeasure, C.LOCKED], ["locked", "Locked ML Forecast Lag_4", "Locked ML Forecast Lag_4"]);
  eq("window = paired Sales + locked dates on/before activity end (22 months; Nov'26 excluded)", [cb.locked.length, cb.locked[0], cb.locked[21]], [22, "2025-01-31", "2026-10-31"]);
  const rep = C.accuracyReport([r], [r], cb);
  eq("overall reproduces stored overall_accuracy 50.08", +rep.overall.toFixed(2), 50.08);
  eq("rolling = last past_accuracy_horizon (3) dates, reproduces stored -33.65", +rep.rolling.toFixed(2), -33.65);
  eq("trust zone from rolling", C.trustZoneOf(rep.rolling), "Critical");
  eq("row reconciliation passes", C.reconcileRowAccuracy([r], cb).mismatched.length, 0);
  eq("forecast of record labelled by the basis", C.forecastOfRecord(r, "2026-10-31").source, "Locked Lag-4");
  // original Locked ML Forecast wins when it has positive mass
  const r2 = { ...r }; M.forEach((m) => (r2[m + " Locked ML Forecast"] = "100"));
  const c2 = C.applyAccuracyBasis([r2], C.parseColumns(Object.keys(r2), { accuracy: acc }));
  eq("original Locked ML Forecast first when it has positive mass", c2.lockedMeasure, "Locked ML Forecast");
  const r3 = { ...r }; M.forEach((m) => (r3[m + " Locked ML Forecast"] = "0"));
  eq("…and is skipped when all zero → lag-N", C.applyAccuracyBasis([r3], C.parseColumns(Object.keys(r3), { accuracy: acc })).lockedMeasure, "Locked ML Forecast Lag_4");
  // validation fallback: no locked mass → latest validation_horizon Sales dates; ML Forecast there → path validation
  const r4 = { ...r }; M.forEach((m) => (r4[m + " Locked ML Forecast Lag_4"] = "0")); r4["2026-09-30 ML Forecast"] = "100"; r4["2026-10-31 ML Forecast"] = "100";
  const c4 = C.applyAccuracyBasis([r4], C.parseColumns(Object.keys(r4), { accuracy: acc }));
  eq("fallback: validation window = latest validation_horizon (2) Sales dates", [c4.accPath, c4.lockedMeasure, c4.locked], ["validation", "ML Forecast", ["2026-09-30", "2026-10-31"]]);
  const rep4 = C.accuracyReport([r4], [r4], c4);
  eq("fallback: rolling = overall (one window)", [rep4.rolling, rep4.overall].map((v) => +v.toFixed(2)), [+(100 * (1 - (29 + 36) / 193)).toFixed(2), +(100 * (1 - (29 + 36) / 193)).toFixed(2)]);
  // stored fallback: no forecast columns in the window (weekly a sample run) → stored overall_accuracy × Sales
  const W = ["2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"], w1 = { overall_accuracy: "15.79", rolling_accuracy: "15.79", trust_zone: "Critical" }, w2 = { overall_accuracy: "80", rolling_accuracy: "80", trust_zone: "Highly Trusted" };
  ["2026-09-27", "2026-10-04", ...W].forEach((d) => { w1[d + " Sales"] = "10"; w1[d + " Raw Actual"] = "10"; w2[d + " Sales"] = "30"; w2[d + " Raw Actual"] = "30"; });
  w1["2026-11-08 Forecast"] = "1"; w1["2026-11-08 Sales"] = "0"; w1["2026-11-08 ML Forecast"] = "5";
  const accW = { activityEnd: "2026-11-02", validationHorizon: 4, lagN: 4, rollingN: 3 };
  const cw = C.applyAccuracyBasis([w1, w2], C.parseColumns(Object.keys(w1), { accuracy: accW }));
  eq("weekly fallback with no forecast in the window → stored accuracy over the last 4 weeks", [cw.accPath, cw.locked], ["stored", W]);
  const rw = C.accuracyReport([w1, w2], [w1, w2], cw);
  eq("stored fallback: error = (1 − acc) × Σ Sales, WAPE across ts_ids", +rw.overall.toFixed(2), +(100 * (1 - (0.8421 * 40 + 0.2 * 120) / 160)).toFixed(2));
  eq("stored fallback: bias unavailable, rolling = overall", [rw.bias, +rw.rolling.toFixed(4) === +rw.overall.toFixed(4)], [null, true]);
  eq("stored fallback: one ts_id reproduces its stored accuracy", +C.accuracyReport([w1], [w1], cw).overall.toFixed(2), 15.79);
  C.resetAccuracyBasis();
}


console.log("\n§13 comparing runs: frequency, roll-up, lag, consistency");
{
  eq("frequency from config wins", C.runFrequency("01012026_SKU_Channel_weekly", "month"), "month");
  eq("frequency hints from labels", ["01012026_SKU_Channel_Monthly", "01012026_SKU_Channel_weekly", "X_Daily", "ITEM_Customer_US"].map((l) => C.runFrequency(l)), ["month", "week", "day", null]);
  eq("coarsest grain", [C.coarsestGrain(["week", "month"]), C.coarsestGrain(["day", "week"]), C.coarsestGrain([null])], ["month", "week", "month"]);
  eq("week-ending dates roll up to their month", ["2026-10-25", "2026-11-01", "2026-11-29"].map((d) => C.rollupPeriod(d, "month")), ["2026-10-31", "2026-11-30", "2026-11-30"]);
  eq("days roll up to the week-ending Sunday", ["2026-11-02", "2026-11-08"].map((d) => C.rollupPeriod(d, "week")), ["2026-11-08", "2026-11-08"]);
  eq("weekly series summed into months", [...C.rollupSeries([["2026-11-08", 10], ["2026-11-15", 5], ["2026-12-06", 3], ["2026-12-13", null]], "month")], [["2026-11-30", 15], ["2026-12-31", 3]]);
  eq("lag in months from a run's as-of date", [C.lagBetween("2026-11-02", "2026-11-30", "month"), C.lagBetween("2026-11-02", "2027-02-28", "month"), C.lagBetween("2026-11-02", "2026-10-31", "month")], [0, 3, -1]);
  eq("lag in weeks", C.lagBetween("2026-11-04", "2026-11-22", "week"), 2);
  const runs = [{ values: new Map([["p1", 100], ["p2", 50]]) }, { values: new Map([["p1", 120]]) }, { values: new Map([["p1", 80], ["p2", 50]]) }];
  const fc = C.forecastConsistency(runs, ["p1", "p2", "p3"]);
  eq("consistency: spread % across runs", [fc[0].n, fc[0].spreadPct, +fc[0].cov.toFixed(2)], [3, 40, 16.33]);
  eq("consistency: identical forecasts → 0 spread; one run → none", [fc[1].spreadPct, fc[2].spreadPct], [0, null]);
}


console.log("\n§11 inventory at its own level");
{
  C.setTsIdColumns(["sku_standard", "Channel"], ["sku_standard", "Channel"]);
  const doiCols = ["sku_standard", "Channel", "Fulfillment Node", "Stock_On_Hand", "ts_id"];
  const m = C.aliasMap("DOI Details", doiCols, C.tsIdColumns());
  eq("Sample DOI: item = sku_standard, location = Channel (2nd ts_id), not Fulfillment Node", [m.component_sku, m.Warehouse], ["sku_standard", "Channel"]);
  eq("Stock Transfer: To = Channel", C.aliasMap("Stock Transfer", ["sku_standard", "Channel", "From_Facility"], C.tsIdColumns()).Warehouse, "Channel");
  eq("Acme DOI keeps Warehouse", C.aliasMap("DOI Details", ["component_sku", "Warehouse", "Fulfillment Node"], ["New_Item", "Customer ID"]).Warehouse, "Warehouse");
  eq("no location column → none (item-level inventory)", C.aliasMap("DOI Details", ["component_sku", "Fulfillment Node"], ["New_Item"]).Warehouse, undefined);
  C.setTsIdColumns(null);
  const rows = [
    { component_sku: "A", Warehouse: "Web store", Stock_On_Hand: "100", Forecast_Per_Day: "5", Stock_Risk_Level: "Stable", soh_value: "10", Current_OOS_Date: "2027-02-01", lead_time: "30" },
    { component_sku: "A", Warehouse: "Marketplace", Stock_On_Hand: "20", Forecast_Per_Day: "5", Stock_Risk_Level: "CriticalStock", soh_value: "2", Current_OOS_Date: "2026-12-01", lead_time: "60" },
    { component_sku: "B", Warehouse: "Web store", Stock_On_Hand: "7", Forecast_Per_Day: "0", Stock_Risk_Level: "ExcessStock" },
  ];
  const it = C.inventoryByItem(rows), a = it.find((x) => x.component_sku === "A");
  eq("item roll-up: SOH summed, worst risk, earliest OOS, longest lead time", [a.Stock_On_Hand, a.Stock_Risk_Level, a.Current_OOS_Date, a.lead_time, a._locations], ["120", "CriticalStock", "2026-12-01", "60", 2]);
  eq("totals equal at both levels", C.inventoryTotals(it, "2026-11-09").soh, C.inventoryTotals(rows, "2026-11-09").soh);
  const sp = [
    { component_sku: "A", Warehouse: "Web store", Variable: "End Inventory", "2026-11-30": "10" }, { component_sku: "A", Warehouse: "Marketplace", Variable: "End Inventory", "2026-11-30": "5" },
    { component_sku: "A", Warehouse: "Marketplace", Variable: "Days On Inventory", "2026-11-30": "40" },
  ];
  const pi = C.pivotSupplyPlanByItem(sp).get("A");
  eq("supply plan by item: summed, day ratios left out", [pi.vars["End Inventory"]["2026-11-30"], pi.locations, pi.vars["Days On Inventory"]], [15, 2, undefined]);
}


console.log("\n§perf caching and paging helpers");
{
  eq("stamp from updatedAt ms / ISO updated_at / none", [C.cacheStamp({ updatedAt: 1794267685899 }), C.cacheStamp({ updated_at: "2026-11-09T23:41:25.899000Z" }), C.cacheStamp({ createdAt: 5 })], [1794267685899, Date.parse("2026-11-09T23:41:25.899Z"), null]);
  const rows = [{ a: "1", b: "x" }, { a: "2", c: "y" }];
  const pk = C.packRows(rows);
  eq("pack: shared column list", pk.cols, ["a", "b", "c"]);
  eq("pack → unpack round-trips (missing stays missing)", C.unpackRows(pk), rows);
  eq("page plan", [C.pagePlan(1718, 500), C.pagePlan(0, 500), C.pagePlan(null, 500)], [[1, 2, 3, 4], [1], null]);
}


console.log("\n§perf large runs: projection, compaction, budget");
{
  const cols = ["sku_standard", "Channel", "2026-11-30 Forecast", "2026-11-30 P20", "2026-11-30 P10", "2026-11-30 P50", "2026-11-30 RL Time Forecast",
    "2026-10-31 Locked ML Forecast Lag_4 Abs Error", "2026-10-31 Consensus Forecast Abs Error", "2026-10-31 Deviation Locked Lag_4", "2026-10-31 Bias", "2026-10-31 Accuracy", "overall_accuracy", "2026-10-31 Budget", "2026-11-30 Lower Bound", "2026-11-30 Graph Reviewed Forecast"];
  eq("projection keeps what the tabs read", C.projectColumns(cols), ["sku_standard", "Channel", "2026-11-30 Forecast", "2026-11-30 P10", "2026-11-30 P50", "2026-10-31 Locked ML Forecast Lag_4 Abs Error", "overall_accuracy", "2026-10-31 Budget", "2026-11-30 Graph Reviewed Forecast"]);
  const r = C.compactRow({ sku_standard: "A1", "2026-11-30 Forecast": "12.5", "2026-11-30 P20": "3", "2026-10-31 Bias": "1", "2026-11-30 P90": "nan", overall_accuracy: "50.1" });
  eq("compact row: numbers, dropped columns, dims untouched", r, { sku_standard: "A1", "2026-11-30 Forecast": 12.5, "2026-11-30 P90": null, overall_accuracy: "50.1" });
  eq("val() reads compacted numbers", C.val(r, "2026-11-30", "Forecast"), 12.5);
  eq("budget from device memory", [C.cellBudget(8), C.cellBudget(undefined), C.cellBudget(64)], [48e6, 24e6, 96e6]);
}


console.log("\n§11 DOI roll-up = the inventory report's top-node rule");
{
  const R = (w, soh, doi, dc) => ({ component_sku: "MI-1", Warehouse: w, Stock_On_Hand: String(soh), "Days on Inventory": String(doi), DOI_Current_Stock: String(dc), sales_last7days: "7", sales_last30days: "30", Stock_Risk_Level: "Stable" });
  // second node below 70% of the largest → the largest node's DOI
  eq("one dominant node", C.doiTopNodes([R("Dallas_SH", 1000, 50, 40), R("Dallas_FBA", 600, 200, 180)], "Days on Inventory"), { value: 50, nodesUsed: 1 });
  // second node at ≥ 70% → average of the top two
  eq("two comparable nodes", C.doiTopNodes([R("Dallas_SH", 1000, 50, 40), R("Dallas_FBA", 800, 70, 60), R("Dallas_CS", 10, 999, 999)], "Days on Inventory"), { value: 60, nodesUsed: 2 });
  eq("single node", C.doiTopNodes([R("Dallas", 5, 12, 11)], "DOI_Current_Stock"), { value: 11, nodesUsed: 1 });
  eq("exactly 70% counts as comparable", C.doiTopNodes([R("A", 100, 10, 0), R("B", 70, 30, 0)], "Days on Inventory").value, 20);
  const base = C.inventoryByBase([R("WH_US_1_SH", 1000, 50, 40), R("WH_US_1_FBA", 800, 70, 60), R("FBT-US", 300, 20, 15)]);
  const dal = base.find((x) => x.Warehouse === "WH_US_1");
  eq("base warehouse roll-up: allocations summed, DOI by top nodes", [base.length, dal.Stock_On_Hand, dal["Days on Inventory"], dal.DOI_Current_Stock, dal.sales_last7days, dal._nodes], [2, "1800", "60", "50", "14", 2]);
  const sp = [{ component_sku: "MI-1", Warehouse: "Dallas", Variable: "Forecast", "2026-11-30": "100", "2026-12-31": "150", "2027-01-31": "999" }, { component_sku: "MI-1", Warehouse: "Dallas", Variable: "End Inventory", "2026-11-30": "5" }];
  eq("forecast next 30 / 60 = first / first two Supply Plan months", C.supplyForecastNext(sp).get("MI-1|Dallas"), { fc30: 100, fc60: 250 });
}


console.log("\n§4.12c Forecast Data fallback — a sample weekly run (no locked forecast), TrueGradient Accuracy Deep Dive");
{
  const fx = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample_weekly_forecast_test.json"), "utf8"));
  const dates = ["2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"];
  const keys = [...new Set(fx.map((x) => x[0] + "|" + x[1]))];
  const rows = keys.map((k) => { const [s, c] = k.split("|"); const r = { sku_standard: s, Channel: c }; for (const d of dates) r[d + " Sales"] = "0"; return r; });
  const fd = fx.map(([s, c, d, a, p]) => ({ sku_standard: s, Channel: c, created_date: d, split: "test", actual: a, pred: p }));
  const res = C.applyForecastData(rows, fd, ["sku_standard", "Channel"], "created_date", dates);
  eq("all 2,850 test rows joined to 718 series", [res.matched, res.unmatched, rows.length], [2850, 0, 718]);
  const cols = C.parseColumns(Object.keys(rows[0]));
  cols.validationHorizon = 4; cols.closedSales = dates;
  C.applyAccuracyBasis(rows, cols, { forecastData: res });
  eq("basis = forecast data, window = the 4 validation weeks, rolling = overall", [cols.accPath, cols.lockedMeasure, cols.locked, cols.rollingN], ["forecastData", C.VALID, dates, 4]);
  const rep = C.accuracyReport(rows, rows, cols, { measure: C.VALID });
  eq("overall = TrueGradient 3.58%", +rep.overall.toFixed(2), 3.58);
  eq("weekly = TrueGradient 5.58 / −9.43 / 1.54 / 15.04", rep.months.map((m) => +m.accuracy.toFixed(2)), [5.58, -9.43, 1.54, 15.04]);
  C.fdSeriesAccuracy(rows, dates);
  const z = {}; for (const r of rows) z[r._fdZone] = (z[r._fdZone] || 0) + 1;
  eq("trust zones = TrueGradient 27 / 23 / 36 / 81 / 26 / 525", ["Highly Trusted", "Trusted", "Review", "Planner Review", "Low Trust", "Critical"].map((k) => z[k] || 0), [27, 23, 36, 81, 26, 525]);
  eq("80.00 exactly is Trusted, 20.00 exactly is Low Trust", [C.trustZoneFD(80), C.trustZoneFD(80.01), C.trustZoneFD(20), C.trustZoneFD(19.99)], ["Trusted", "Highly Trusted", "Low Trust", "Critical"]);
}


console.log("\n§8 inventory-capped pacing target");
{
  const m = "2026-11-30";
  const rows = [
    { sku: "A", ch: "Web store", [m + " Forecast"]: "100", [m + " Sales"]: "30" },   // 30 sold + 20 on hand = 50 < 100 → capped at 50
    { sku: "B", ch: "Web store", [m + " Forecast"]: "80", [m + " Sales"]: "10" },    // 10 + 500 → forecast 80
    { sku: "C", ch: "Marketplace", [m + " Forecast"]: "60", [m + " Sales"]: "0" },      // no inventory record → forecast 60
  ];
  const index = new Map([["A|Web store", { onHand: 20, inTransit: 40 }], ["B|Web store", { onHand: 500, inTransit: 0 }]]);
  const keyRow = (r) => r.sku + "|" + r.ch;
  const t = C.constrainedTarget(rows, m, { index, keyRow, mode: "onhand" });
  eq("target = Σ min(forecast, sold + on hand); unmatched keep forecast", [t.target, t.forecast, t.capped, t.matched, t.groups, t.inventory], [190, 240, 1, 2, 3, 560]);
  const t2 = C.constrainedTarget(rows, m, { index, keyRow, mode: "transit" });
  eq("with in transit A has 90 → target 90", t2.target, 230);
  const t3 = C.constrainedTarget(rows, m, { index: new Map([["A", { onHand: 10 }]]), keyRow: (r) => r.sku, mode: "onhand" });
  eq("item-level join", [t3.target, t3.capped], [40 + 80 + 60, 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
