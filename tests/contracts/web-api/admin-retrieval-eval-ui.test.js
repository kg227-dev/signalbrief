"use strict";

const path = require("path");
const fs = require("fs");

const PAGE_REL = "web/admin-retrieval-eval.html";
const PAGE_PATH = path.join(process.cwd(), PAGE_REL);
const pageSource = fs.readFileSync(PAGE_PATH, "utf8");

const requiredPageSnippets = [
  "Retrieval Eval",
  "Perplexity Sources",
  "Final Source Picks",
  'id="sourceScenarioPicker"',
  'id="sourcePersonaPicker"',
  'id="perplexitySourceSummary"',
  'id="perplexitySources"',
  'id="finalSourceSummary"',
  'id="finalSourcePicks"',
  "function buildSourceInventoryRows(scenario)",
  "function renderSourceTransparency(run)",
  "function syncSourceInspectControls(run)",
  "Scenario final pool",
  "/api/admin/retrieval-eval/run",
];

for (const snippet of requiredPageSnippets) {
  if (!pageSource.includes(snippet)) {
    throw new Error(`admin retrieval eval page is missing required snippet: ${snippet}`);
  }
}

process.stdout.write("[admin-retrieval-eval-ui] all assertions passed\n");
