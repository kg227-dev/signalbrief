"use strict";

const path = require("path");
const fs = require("fs");

const PAGE_REL = "web/admin-source-registry.html";
const PAGE_PATH = path.join(process.cwd(), PAGE_REL);
const pageSource = fs.readFileSync(PAGE_PATH, "utf8");

const requiredPageSnippets = [
  "Source Governance",
  "Source governance (all tracked history)",
  "Preferred source config",
  "Curation queues",
  "Runtime file wins when present; bundled seed is the fallback.",
  'id="preferredSourcesPanelBody"',
  'id="curationQueuesPanelBody"',
  'id="sourceRegistryInspector"',
  'id="sourceRegistrySuggestionsHeaderRow"',
  'id="sourceRegistrySuggestionsBody"',
  "function buildGovernanceRows(overview)",
  "function renderPreferredSourcesConfig(overview)",
  "function renderCurationQueues(overview)",
  "function renderSourceRegistrySuggestions(overview)",
  "function renderSourceRegistryInspector(detail, overview)",
  "function toggleSuggestionsSort(key)",
  "async function toggleSourceAudit(domain)",
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
