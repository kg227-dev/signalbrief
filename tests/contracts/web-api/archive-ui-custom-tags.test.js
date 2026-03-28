"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/archive.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const removedSnippets = [
  "filter-pill-custom",
  "tag-pill-custom",
  "customTagKeys: new Set()",
  "function buildCustomTopicTagSet(user)",
  "function isCustomTopicTag(tag)",
  "state.customTagKeys = buildCustomTopicTagSet(userData);",
];

for (const snippet of removedSnippets) {
  if (source.includes(snippet)) {
    throw new Error(`archive UI still carries removed custom-tag snippet: ${snippet}`);
  }
}

for (const requiredSnippet of [
  'state.focusDateKey',
  'params.get("date")',
  "Focused on ${formatDateShort(state.focusDateKey)}",
]) {
  if (!source.includes(requiredSnippet)) {
    throw new Error(`archive UI is missing focused-date archive support snippet: ${requiredSnippet}`);
  }
}
