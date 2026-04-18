"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertModuleExports,
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  'require("./digest-orchestrator-fetch-diagnostics-runtime")',
  'function resolveFetchConcurrency',
  'function buildPreferredInvocation',
  'function buildBroadInvocation',
  'function buildTrustedFamilyInvocation',
]);

const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  uniqueValues,
  toBoundedInt,
  markBudgetStop,
  canReceiveAdditionalRetry,
  shouldPreferBroadFallbackRetry,
  needsStandardTrustedSourcePass,
  buildPreferredInvocation,
  buildBroadInvocation,
  buildTrustedFamilyInvocation,
  resolveBatchConcurrency,
} = runtime;

assert.deepStrictEqual(uniqueValues([" a ", "a", "", "b"]), ["a", "b"]);
assert.strictEqual(toBoundedInt("9.8", 1, { min: 2, max: 8 }), 8);
assert.strictEqual(toBoundedInt("foo", 7), 7);

const budget = {};
markBudgetStop(budget, "hard_cap");
assert.deepStrictEqual(budget, { stop_reason: "hard_cap", exhausted: true });

const baseState = {
  items: [{ id: 1 }],
  topic: { queries: ["q1", "q2"] },
  conversionFunnel: {
    provider_url_shape_counts: { article_url: 1, listing_page: 0, tag_page: 0, search_page: 0, homepage: 0 },
    stale_item_count: 0,
    search_evidence_retained_count: 1,
  },
  provider: { status_counts: {}, failed_calls: 0, transport_errors: 0 },
  preferredCallsMade: 1,
  nextBroadQueryIndex: 0,
  zeroYieldRetryStreak: 0,
  retryBlockReason: null,
};

assert.strictEqual(canReceiveAdditionalRetry(baseState, () => true), true);
assert.strictEqual(shouldPreferBroadFallbackRetry(baseState, () => true), true);
assert.strictEqual(
  needsStandardTrustedSourcePass({
    ...baseState,
    trustedFamilyQueue: [{ name: "reported", domains: ["example.com"], official_friendly: false }],
    nextTrustedFamilyIndex: 0,
  }, () => ({ review_heavy: false }), () => true),
  true
);

assert.deepStrictEqual(
  buildPreferredInvocation({
    topic: { queries: ["alpha", "beta"] },
    preferredDomains: ["a.com"],
    reportedDomains: ["b.com"],
    officialDomains: ["c.com"],
    officialFriendly: true,
    topicKeys: ["technology"],
  }, 1),
  {
    phase: "preferred",
    queryIndex: 1,
    countsAsRetry: false,
    broadFallback: false,
    topic: { queries: ["beta"] },
    opts: {
      maxAgeHours: 48,
      retrievalPlan: {
        preferred_domains: ["a.com"],
        reported_domains: ["b.com"],
        official_domains: ["c.com"],
        thin_item_threshold: 2,
        thin_topic_expansion: false,
        official_friendly: true,
        topic_keys: ["technology"],
        allow_broad_fallback: false,
      },
    },
  }
);

assert.deepStrictEqual(
  buildBroadInvocation({
    topic: { queries: ["alpha"] },
    preferredDomains: ["a.com"],
    reportedDomains: ["b.com"],
    officialDomains: ["c.com"],
    officialFriendly: false,
    topicKeys: ["technology"],
  }, 0, { countsAsRetry: true, broadFallback: true, maxAgeHours: 12 }),
  {
    phase: "broad",
    queryIndex: 0,
    countsAsRetry: true,
    broadFallback: true,
    topic: { queries: ["alpha"] },
    opts: {
      maxAgeHours: 12,
      retrievalPlan: {
        preferred_domains: ["a.com"],
        reported_domains: ["b.com"],
        official_domains: ["c.com"],
        thin_item_threshold: 2,
        thin_topic_expansion: false,
        official_friendly: false,
        topic_keys: ["technology"],
        broad_only: true,
      },
    },
  }
);

assert.deepStrictEqual(
  buildTrustedFamilyInvocation({
    topic: { queries: ["alpha"] },
    trustedFamilyQueue: [{ name: "reported", domains: ["r.com"], official_friendly: true }],
    nextTrustedFamilyIndex: 0,
    reportedDomains: ["b.com"],
    officialDomains: ["c.com"],
    topicKeys: ["technology"],
  }, { countsAsRetry: true, maxAgeHours: 24 }),
  {
    phase: "trusted",
    queryIndex: 0,
    countsAsRetry: true,
    broadFallback: false,
    trustedFamilyName: "reported",
    topic: { queries: ["alpha"] },
    opts: {
      maxAgeHours: 24,
      retrievalPlan: {
        preferred_domains: ["r.com"],
        reported_domains: ["b.com"],
        official_domains: ["c.com"],
        thin_item_threshold: 1,
        thin_topic_expansion: false,
        official_friendly: true,
        topic_keys: ["technology"],
        allow_broad_fallback: false,
        trusted_source_second_pass: true,
        trusted_source_family: "reported",
      },
    },
  }
);

assert.strictEqual(resolveBatchConcurrency("standard:phase1", 12, { rate_limit_backoff_level: 0 }, 5), 3);
assert.strictEqual(resolveBatchConcurrency("custom:topic", 2, { rate_limit_backoff_level: 2 }, 6), 1);

console.log("digest-orchestrator-fetch-policy-runtime all assertions passed");
