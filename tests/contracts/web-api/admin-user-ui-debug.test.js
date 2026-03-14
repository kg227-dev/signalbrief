"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/admin-user.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  'id="lastDigestMeta"',
  "latest_digest_record",
  "archive_digest_count",
  "function buildLastDigestPanel(user)",
  "storyline_id",
  "score_breakdown",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`admin user debug UI is missing required snippet: ${snippet}`);
  }
}
