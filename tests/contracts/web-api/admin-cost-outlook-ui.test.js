"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "7-day view",
  'id="costLast7d"',
  'id="costLast7dSub"',
  'id="costNext7d"',
  'id="costNext7dSub"',
  "summary.trailing_7d_cost",
  "summary.projected_7d_cost",
  "scheduled baseline only",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`admin cost outlook UI is missing required snippet: ${snippet}`);
  }
}
