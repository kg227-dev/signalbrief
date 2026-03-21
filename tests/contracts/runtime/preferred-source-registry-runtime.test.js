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
assert.deepStrictEqual(registry.topics["ai tech"].reported, ["theinformation.com", "semianalysis.com"]);

const shortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "AI×TECH",
  dueUserTopics: ["TECHNOLOGY", "custom_agentic_ai"],
  queryText: "enterprise ai agents funding last 48 hours",
  maxDomains: 6,
});
assert.deepStrictEqual(
  shortlist.domains.slice(0, 5),
  ["theinformation.com", "semianalysis.com", "news.example.com", "reuters.com", "wsj.com"]
);

const officialShortlist = buildPreferredDomainShortlist(registry, {
  topicTag: "POLICY×REGULATORY",
  dueUserTopics: ["POLICY×REGULATORY"],
  queryText: "sec proposed disclosure rule guidance",
  maxDomains: 5,
});
assert.deepStrictEqual(
  officialShortlist.domains.slice(0, 3),
  ["federalregister.gov", "sec.gov", "reuters.com"]
);

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
assert.strictEqual(fallbackSnapshot.source_mode, "bundled_fallback");
assert.strictEqual(fallbackSnapshot.used_fallback, true);
assert.strictEqual(fallbackSnapshot.active_path, bundledPreferredSourcesPath);
assert.deepStrictEqual(fallbackSnapshot.registry.global.reported, ["axios.com"]);

process.stdout.write("[preferred-source-registry-runtime] all assertions passed\n");
