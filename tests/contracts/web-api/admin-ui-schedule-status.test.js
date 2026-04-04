"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  "const deliveredToday = isToday && String(u.last_scheduled_digest || u.last_digest || \"\") === dateKey;",
  "delivered_count: Number(u.last_scheduled_digest_item_count || u.last_digest_item_count || 0),",
  "digest_url: String(u.last_scheduled_digest_view_url || u.last_scheduled_archive_url || u.archive_url || \"\").trim(),",
  "ev.status === \"sent\" && ev.digest_url",
  ">View digest</a>",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`admin schedule status logic is missing required snippet: ${snippet}`);
  }
}

if (source.includes(">View archive</a>")) {
  throw new Error("admin schedule status should keep the working sent-state action labeled view digest");
}
