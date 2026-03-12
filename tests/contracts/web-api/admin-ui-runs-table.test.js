"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "<th>Digest quality</th>",
  "<th>Digest</th>",
  "function renderRunDigestQuality(run)",
  "function renderRunDigestLink(run)",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`admin runs table is missing required snippet: ${snippet}`);
  }
}
