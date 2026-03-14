"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/archive.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "filter-pill-custom",
  "tag-pill-custom",
  "customTagKeys: new Set()",
  "function buildCustomTopicTagSet(user)",
  "function isCustomTopicTag(tag)",
  "state.customTagKeys = buildCustomTopicTagSet(userData);",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`archive custom tag UI is missing required snippet: ${snippet}`);
  }
}
