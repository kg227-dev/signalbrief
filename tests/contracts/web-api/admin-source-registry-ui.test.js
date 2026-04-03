"use strict";

const path = require("path");
const fs = require("fs");

const PAGE_REL = "web/admin-source-registry.html";
const PAGE_PATH = path.join(process.cwd(), PAGE_REL);
const pageSource = fs.readFileSync(PAGE_PATH, "utf8");

const requiredPageSnippets = [
  "Source Governance",
  "Source governance (all tracked history)",
  "Broker source inventory",
  "Curation queues",
  "Source-of-truth status",
  "Shared preferred-source diagnostics are now derived from broker config",
  "Standard-topic source of truth: broker config",
  "MVP topic controls",
  "Broker source controls",
  'id="preferredSourcesPanelBody"',
  'id="curationQueuesPanelBody"',
  'id="sourceOfTruthPanelBody"',
  'id="sourceRegistryInspector"',
  'id="sourceRegistrySuggestionsHeaderRow"',
  'id="sourceRegistrySuggestionsBody"',
  'id="sourceRegistryScopeInput"',
  "function buildGovernanceRows(overview)",
  "function renderPreferredSourcesConfig(overview)",
  "function renderSourceOfTruthSummary(overview)",
  "Preferred-source compatibility view (broker-derived)",
  "async function toggleBrokerTopicEnabled(topicTag, nextEnabled)",
  "async function saveBrokerSourceTier(sourceId)",
  "function renderCurationQueues(overview)",
  "function renderSourceRegistrySuggestions(overview)",
  "function renderSourceRegistryInspector(detail, overview)",
  "function changeSourceRegistryInspectScope()",
  "function toggleSuggestionsSort(key)",
  "async function toggleSourceAudit(domain)",
  "function parseTopicFitText(rawValue)",
  "function setSourceRegistryOverviewQuery(query)",
  "async function inspectSourceRegistryDomain(domainValue, silent = false, identityKeyValue = \"\")",
  "async function saveSourceRegistryDomain()",
  "async function resetSourceRegistryDomain()",
  "/api/admin/source-registry",
];

for (const snippet of requiredPageSnippets) {
  if (!pageSource.includes(snippet)) {
    throw new Error(`admin source registry page is missing required snippet: ${snippet}`);
  }
}

const adminSource = fs.readFileSync(path.join(process.cwd(), "web/admin.html"), "utf8");
for (const snippet of ["/admin/source-registry", "function setSourceRegistryOverviewQuery(query)"]) {
  if (!adminSource.includes(snippet)) {
    throw new Error(`admin page nav is missing required snippet: ${snippet}`);
  }
}
