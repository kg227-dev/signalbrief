"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "Digest quality</th>",
  "Digest</th>",
  "How to read this",
  "Digest quality is a 0-100 score for the whole brief, not a match percentage.",
  "why this brief was strong or weak",
  "85+ = strong brief",
  "Weak brief.",
  "function renderRunDigestQuality(run)",
  "function renderRunDigestLink(run)",
  "function renderRunDebugPanel(run)",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`admin runs table is missing required snippet: ${snippet}`);
  }
}
