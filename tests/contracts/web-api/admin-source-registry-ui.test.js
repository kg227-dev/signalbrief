"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const requiredSnippets = [
  "Source registry",
  'id="sourceRegistryInspector"',
  'id="sourceRegistrySuggestionsBody"',
  'id="sourceRegistryOverridesBody"',
  "function renderSourceRegistrySuggestions(overview)",
  "function renderSourceRegistryOverrides(overview)",
  "function renderSourceRegistryInspector(detail, overview)",
  "async function inspectSourceRegistryDomain(domainValue, silent = false)",
  "async function saveSourceRegistryDomain()",
  "async function resetSourceRegistryDomain()",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`admin source registry UI is missing required snippet: ${snippet}`);
  }
}
