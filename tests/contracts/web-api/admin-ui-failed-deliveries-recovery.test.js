"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  "const scheduledDigestDate = String(row.user && row.user.last_scheduled_digest || \"\").trim();",
  "const deliveredCount = Number(row.user && row.user.last_scheduled_digest_item_count || 0);",
  "return !(scheduledDigestDate && scheduledDigestDate === String(row.dateKey || \"\").trim() && deliveredCount > 0);",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`admin failed delivery recovery logic is missing required snippet: ${snippet}`);
  }
}

process.stdout.write("[admin-ui-failed-deliveries-recovery] source assertions passed\n");
