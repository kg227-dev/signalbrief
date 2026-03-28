"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  'id="digestAuditSection"',
  'id="digestAuditDate"',
  'id="digestAuditPanel"',
  "function loadDigestAudit(",
  "function triggerTopicAuditRerun(",
  "MVP readiness (",
  "Missed-story flags",
  "Missed-story watch",
  "Rerun topic audit",
  "today-only so the system never fakes a historical backfill",
  "Inspect lane mix, selected items, and candidate rejections for any day.",
  "No digest audit file exists for that date yet.",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`admin digest audit UI is missing required snippet: ${snippet}`);
  }
}
