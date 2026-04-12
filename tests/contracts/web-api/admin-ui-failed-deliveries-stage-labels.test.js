"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  "const blockedReason = String(run.blocked_reason || \"\").trim();",
  "? \"MISSED: ADMISSION\"",
  ": ((Array.isArray(run.per_user_failed) ? run.per_user_failed : []).length > 0 ? \"MISSED: SEND\" : \"MISSED\");",
  "Admission gate blocked the scheduled run before generation/send.",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`admin failed delivery stage labels are missing required snippet: ${snippet}`);
  }
}

process.stdout.write("[admin-ui-failed-deliveries-stage-labels] source assertions passed\n");
