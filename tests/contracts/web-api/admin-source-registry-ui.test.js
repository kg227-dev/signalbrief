"use strict";

const path = require("path");
const fs = require("fs");

const PAGE_REL = "web/admin-source-registry.html";
const PAGE_PATH = path.join(process.cwd(), PAGE_REL);
const pageSource = fs.readFileSync(PAGE_PATH, "utf8");

const requiredPageSnippets = [
  "Source Governance",
  "Suggested source review (all tracked history)",
  'id="sourceRegistryInspector"',
  'id="sourceRegistrySuggestionsBody"',
  'id="sourceRegistryOverridesBody"',
  "function renderSourceRegistrySuggestions(overview)",
  "function renderSourceRegistryOverrides(overview)",
  "function renderSourceRegistryInspector(detail, overview)",
  "function parseTopicFitText(rawValue)",
  "function setSourceRegistryOverviewQuery(query)",
  "async function inspectSourceRegistryDomain(domainValue, silent = false)",
  "async function saveSourceRegistryDomain()",
  "async function resetSourceRegistryDomain()",
  "/api/admin/source-registry",
  "/admin/sandbox",
];

for (const snippet of requiredPageSnippets) {
  if (!pageSource.includes(snippet)) {
    throw new Error(`admin source registry page is missing required snippet: ${snippet}`);
  }
}

const adminSource = fs.readFileSync(path.join(process.cwd(), "web/admin.html"), "utf8");
for (const snippet of ["/admin/sandbox", "/admin/source-registry", "function setSourceRegistryOverviewQuery(query)"]) {
  if (!adminSource.includes(snippet)) {
    throw new Error(`admin page nav is missing required snippet: ${snippet}`);
  }
}
