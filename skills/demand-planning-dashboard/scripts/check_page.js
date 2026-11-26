#!/usr/bin/env node
// Build check for the Demand Planning artifact (runtime-and-connector.md §10).
// Usage: node scripts/check_page.js path/to/page.html
// Fails (exit 1) when the page could pull whole datasets or compute metrics in the
// browser instead of asking the tg_dp_* tools.
"use strict";
const fs = require("fs");

const ALLOWED = new Set([
  "tg_whoami", "tg_list_experiments_for_analysis", "tg_experiment_details",
  "tg_dp_context", "tg_dp_dimensions", "tg_dp_filter_options", "tg_dp_scope",
  "tg_dp_aggregate", "tg_dp_series", "tg_dp_compute", "tg_dp_period_compare",
  "tg_dp_accuracy_summary", "tg_dp_accuracy_by_period", "tg_dp_accuracy_by_group",
  "tg_dp_trust_zones", "tg_dp_table_page", "tg_dp_row_detail", "tg_dp_export_csv",
  "tg_dp_top_movers", "tg_dp_anomalies", "tg_dp_pacing", "tg_dp_needs_attention",
  "tg_dp_segmentation", "tg_dp_outlook",
  "tg_dp_inventory_health", "tg_dp_supply_plan", "tg_dp_transfers",
  "tg_dp_experiment_compare",
]);

// Names that mean a full-table read or client-side metric code.
const FORBIDDEN = [
  "tg_fetch_dataset", "tg_dataset_info", "tg_resolve_datasets",
  "fetchAllRows", "indexedDB", "cellBudget", "memTrim", "demandDims",
  "filterOptions(", "accuracySummary(", "lockedCells(", "granularReport(",
  "levelReport(", "packRows(",
];

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/check_page.js <page.html>");
    process.exit(2);
  }
  const src = fs.readFileSync(file, "utf8");
  const problems = [];

  for (const name of FORBIDDEN) {
    if (src.includes(name)) problems.push(`forbidden: ${name}`);
  }
  // Full tool names only (a bare prefix such as "tg_dp_" in a startsWith check is not a call).
  const used = new Set((src.match(/\btg_[a-z_]*[a-z]\b/g) || []).filter((n) => !n.endsWith("_")));
  for (const name of used) {
    if (name.startsWith("tg_") && !ALLOWED.has(name) && /^tg_(dp_|whoami|list_|experiment_|fetch_|dataset_|resolve_)/.test(name)) {
      problems.push(`tool not in the manifest: ${name}`);
    }
  }
  const missing = ["tg_dp_context", "tg_dp_accuracy_summary", "tg_dp_table_page"].filter((t) => !used.has(t));
  if (missing.length) problems.push(`expected tools never called: ${missing.join(", ")}`);

  if (problems.length) {
    console.error(`check_page: ${problems.length} problem(s) in ${file}`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`check_page: OK (${used.size} TrueGradient tool names, none forbidden)`);
}

main();
