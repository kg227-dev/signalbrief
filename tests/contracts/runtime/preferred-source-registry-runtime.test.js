"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/preferred-source-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createPreferredSourceRegistryRuntime,
  buildPreferredDomainShortlist,
  buildPreferredSourceFamilyShortlists,
  matchPreferredSourceDomain,
} = runtime;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-preferred-source-registry-"));
const preferredSourcesPath = path.join(tempDir, "preferred-sources.json");
const bundledPreferredSourcesPath = path.join(tempDir, "bundled-preferred-sources.json");
const standardTopicBrokerSourcesPath = path.join(tempDir, "standard-topic-broker-sources.json");
const bundledStandardTopicBrokerSourcesPath = path.join(tempDir, "bundled-standard-topic-broker-sources.json");

fs.writeFileSync(preferredSourcesPath, JSON.stringify({
  version: 1,
  global: {
    reported: ["Reuters.com", "reuters.com", "wsj.com"],
    official: ["sec.gov"],
  },
  topics: {
    "AI Technology": {
      reported: ["theinformation.com", "THEINFORMATION.COM", "semianalysis.com"],
      official: [],
    },
    technology: {
      reported: ["news.example.com"],
      official: [],
    },
    "Policy & Regulatory": {
      reported: [],
      official: ["federalregister.gov"],
    },
  },
  publishers: {
    global: {
      reported: [],
      official: [],
    },
    topics: {
      technology: {
        reported: ["youtube:@InsideBoardroom", "youtube:@insideboardroom"],
        official: [],
      },
    },
  },
  aliases: {
    "ai technology": "ai tech",
    "policy & regulatory": "policy regulatory",
  },
}, null, 2));
fs.writeFileSync(bundledPreferredSourcesPath, JSON.stringify({
  version: 1,
  global: {
    reported: ["axios.com"],
    official: ["sec.gov"],
  },
  topics: {},
  aliases: {},
}, null, 2));
fs.writeFileSync(standardTopicBrokerSourcesPath, JSON.stringify({
  version: 2,
  lanes: {
    publisher_feed: { enabled: true },
    official: { enabled: true },
    perplexity_discovery: { enabled: false },
  },
  topics: {
    HEALTHCARE: { enabled: true, lanes: { publisher_feed: true, official: true } },
    TECHNOLOGY: { enabled: true, lanes: { publisher_feed: true, official: true } },
    "FINANCIAL SERVICES": { enabled: true, lanes: { publisher_feed: true, official: true } },
  },
  sources: [
    {
      id: "healthcare_modern",
      enabled: true,
      lane: "publisher_feed",
      topic_tags: ["HEALTHCARE"],
      source_kind: "trade_specialist",
      domains: ["modernhealthcare.com"],
      endpoint: "https://www.modernhealthcare.com/rss",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "healthcare_cms",
      enabled: true,
      lane: "official",
      topic_tags: ["HEALTHCARE"],
      source_kind: "primary_official",
      domains: ["cms.gov"],
      endpoint: "https://www.cms.gov/newsroom/rss-feeds",
      parser: "rss",
      content_kind: "official_document",
    },
    {
      id: "technology_techcrunch",
      enabled: true,
      lane: "publisher_feed",
      topic_tags: ["TECHNOLOGY"],
      source_kind: "reported_media",
      domains: ["techcrunch.com"],
      endpoint: "https://techcrunch.com/feed/",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "technology_sec",
      enabled: true,
      lane: "official",
      topic_tags: ["TECHNOLOGY"],
      source_kind: "primary_official",
      domains: ["sec.gov"],
      endpoint: "https://www.sec.gov/news/pressreleases.rss",
      parser: "rss",
      content_kind: "official_document",
    },
    {
      id: "financial_american_banker",
      enabled: true,
      lane: "publisher_feed",
      topic_tags: ["FINANCIAL SERVICES"],
      source_kind: "reported_media",
      domains: ["americanbanker.com"],
      endpoint: "https://www.americanbanker.com/feed",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "financial_fed",
      enabled: true,
      lane: "official",
      topic_tags: ["FINANCIAL SERVICES"],
      source_kind: "primary_official",
      domains: ["federalreserve.gov"],
      endpoint: "https://www.federalreserve.gov/feeds/press_all.xml",
      parser: "rss",
      content_kind: "official_document",
    },
  ],
}, null, 2));
fs.writeFileSync(bundledStandardTopicBrokerSourcesPath, fs.readFileSync(standardTopicBrokerSourcesPath, "utf8"));

const registryRuntime = createPreferredSourceRegistryRuntime({
  preferredSourcesPath,
  bundledPreferredSourcesPath,
  standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath,
});
const registry = registryRuntime.loadPreferredSourceRegistry();

assert.deepStrictEqual(registry.global.reported, ["reuters.com", "wsj.com"]);
assert.ok(registry.topics["ai tech"].reported.includes("theinformation.com"));
assert.ok(registry.topics["ai tech"].reported.includes("semianalysis.com"));
assert.ok(registry.topics.technology.reported.includes("techcrunch.com"));
assert.ok(registry.topics["financial services"].official.includes("federalreserve.gov"));
assert.ok(registry.topics.healthcare.reported.includes("modernhealthcare.com"));
assert.ok(!registry.topics.healthcare.reported.includes("statnews.com"));
assert.ok(!registry.topics.talent, "legacy non-MVP built-in standard topics should not leak into the active runtime registry");
assert.strictEqual(registry.standard_topic_source?.source_of_truth, "standard_topic_broker");
assert.ok(registry.standard_topic_source?.topic_keys.includes("technology"));

const shortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "AI×TECH",
  dueUserTopics: ["TECHNOLOGY", "custom_agentic_ai"],
  queryText: "enterprise ai agents funding last 48 hours",
  maxDomains: 6,
});
assert.ok(shortlist.domains.includes("theinformation.com"));
assert.ok(shortlist.domains.includes("semianalysis.com"));
assert.ok(shortlist.domains.includes("techcrunch.com"));
assert.ok(shortlist.domains.includes("sec.gov"));

const officialShortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "POLICY×REGULATORY",
  dueUserTopics: ["POLICY×REGULATORY"],
  queryText: "sec proposed disclosure rule guidance",
  maxDomains: 5,
});
assert.ok(officialShortlist.domains.includes("federalregister.gov"));
assert.ok(officialShortlist.domains.includes("sec.gov"));

const familyShortlists = buildPreferredSourceFamilyShortlists(registry, {
  topicTag: "AI×TECH",
  dueUserTopics: ["TECHNOLOGY", "AI×TECH"],
  queryText: "enterprise ai agents funding last 48 hours",
  maxDomains: 6,
});
assert.ok(familyShortlists.reported_domains.includes("theinformation.com"));
assert.ok(familyShortlists.reported_domains.includes("semianalysis.com"));
assert.ok(familyShortlists.reported_domains.includes("techcrunch.com"));
assert.ok(familyShortlists.official_domains.includes("sec.gov"));

const policyFamilyShortlists = buildPreferredSourceFamilyShortlists(registry, {
  topicTag: "POLICY×REGULATORY",
  dueUserTopics: ["POLICY×REGULATORY"],
  queryText: "sec proposed disclosure rule guidance",
  maxDomains: 5,
});
assert.ok(policyFamilyShortlists.official_domains.includes("federalregister.gov"));
assert.ok(policyFamilyShortlists.official_domains.includes("sec.gov"));
assert.ok(policyFamilyShortlists.reported_domains.includes("reuters.com"));
assert.ok(policyFamilyShortlists.reported_domains.includes("wsj.com"));

const inheritedMatch = matchPreferredSourceDomain(registry, "alerts.techcrunch.com", "TECHNOLOGY");
assert.strictEqual(inheritedMatch.match, "topic_reported");
assert.strictEqual(inheritedMatch.matched_domain, "techcrunch.com");

const publisherMatch = matchPreferredSourceDomain(registry, "youtube.com", "TECHNOLOGY", {
  sourceIdentityKey: "youtube:@insideboardroom",
});
assert.strictEqual(publisherMatch.match, "topic_reported");
assert.strictEqual(publisherMatch.scope, "publisher");
assert.strictEqual(publisherMatch.matched_identity, "youtube:@insideboardroom");

fs.writeFileSync(preferredSourcesPath, JSON.stringify({}, null, 2));
const fallbackSnapshot = registryRuntime.inspectPreferredSourceRegistry();
assert.strictEqual(fallbackSnapshot.source_mode, "runtime");
assert.strictEqual(fallbackSnapshot.used_fallback, false);
assert.strictEqual(fallbackSnapshot.active_path, preferredSourcesPath);
assert.ok(fallbackSnapshot.registry.topics.healthcare.reported.includes("modernhealthcare.com"));
assert.strictEqual(fallbackSnapshot.standard_topic_source?.source_of_truth, "standard_topic_broker");

process.stdout.write("[preferred-source-registry-runtime] all assertions passed\n");
