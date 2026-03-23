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

const registryRuntime = createPreferredSourceRegistryRuntime({ preferredSourcesPath, bundledPreferredSourcesPath });
const registry = registryRuntime.loadPreferredSourceRegistry();

assert.deepStrictEqual(registry.global.reported, ["reuters.com", "wsj.com"]);
assert.ok(registry.topics["ai tech"].reported.includes("theinformation.com"));
assert.ok(registry.topics["ai tech"].reported.includes("semianalysis.com"));
assert.ok(registry.topics["ai tech"].reported.includes("techcrunch.com"));
assert.ok(registry.topics.talent.reported.includes("shrm.org"));
assert.ok(registry.topics["financial services"].official.includes("federalreserve.gov"));

const shortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "AI×TECH",
  dueUserTopics: ["TECHNOLOGY", "custom_agentic_ai"],
  queryText: "enterprise ai agents funding last 48 hours",
  maxDomains: 6,
});
assert.ok(shortlist.domains.includes("theinformation.com"));
assert.ok(shortlist.domains.includes("semianalysis.com"));
assert.ok(shortlist.domains.includes("techcrunch.com"));
assert.ok(shortlist.domains.includes("theverge.com"));

const officialShortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "POLICY×REGULATORY",
  dueUserTopics: ["POLICY×REGULATORY"],
  queryText: "sec proposed disclosure rule guidance",
  maxDomains: 5,
});
assert.ok(officialShortlist.domains.includes("federalregister.gov"));
assert.ok(officialShortlist.domains.includes("regulations.gov"));
assert.ok(officialShortlist.domains.includes("govinfo.gov"));

const familyShortlists = buildPreferredSourceFamilyShortlists(registry, {
  topicTag: "AI×TECH",
  dueUserTopics: ["TECHNOLOGY", "AI×TECH"],
  queryText: "enterprise ai agents funding last 48 hours",
  maxDomains: 6,
});
assert.ok(familyShortlists.reported_domains.includes("theinformation.com"));
assert.ok(familyShortlists.reported_domains.includes("semianalysis.com"));
assert.ok(familyShortlists.reported_domains.includes("techcrunch.com"));
assert.ok(familyShortlists.reported_domains.includes("theverge.com"));
assert.ok(familyShortlists.official_domains.includes("sec.gov"));

const policyFamilyShortlists = buildPreferredSourceFamilyShortlists(registry, {
  topicTag: "POLICY×REGULATORY",
  dueUserTopics: ["POLICY×REGULATORY"],
  queryText: "sec proposed disclosure rule guidance",
  maxDomains: 5,
});
assert.ok(policyFamilyShortlists.official_domains.includes("federalregister.gov"));
assert.ok(policyFamilyShortlists.official_domains.includes("regulations.gov"));
assert.ok(policyFamilyShortlists.reported_domains.includes("govexec.com"));
assert.ok(policyFamilyShortlists.reported_domains.includes("federalnewsnetwork.com"));

const talentFamilyShortlists = buildPreferredSourceFamilyShortlists(registry, {
  topicTag: "TALENT",
  dueUserTopics: ["TALENT"],
  queryText: "labor market hiring layoffs workforce regulation",
  maxDomains: 6,
});
assert.ok(talentFamilyShortlists.reported_domains.includes("shrm.org"));
assert.ok(talentFamilyShortlists.official_domains.includes("bls.gov"));

const inheritedMatch = matchPreferredSourceDomain(registry, "alerts.news.example.com", "TECHNOLOGY");
assert.strictEqual(inheritedMatch.match, "topic_reported");
assert.strictEqual(inheritedMatch.matched_domain, "news.example.com");

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
assert.ok(fallbackSnapshot.registry.topics.healthcare.reported.includes("statnews.com"));

process.stdout.write("[preferred-source-registry-runtime] all assertions passed\n");
