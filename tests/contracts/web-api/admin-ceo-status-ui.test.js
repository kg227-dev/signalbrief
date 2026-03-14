"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "Recovery queue",
  "Latest scheduled run",
  "active_recovery_queue",
  "latest_scheduled_run_clean",
  "#failedDeliveryPanel",
  "Reviewing recovery queue.",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`CEO status UI is missing required snippet: ${snippet}`);
  }
}
