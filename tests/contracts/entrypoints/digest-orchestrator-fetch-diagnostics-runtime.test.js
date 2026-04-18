"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-diagnostics-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildFetchDiagnostics,
  countScheduledCalls,
  countStatusCode,
  enforceDiscoveryCandidateShare,
  resolveDiscoveryCandidateCapCount,
  resolveMaxDiscoveryCandidateShare,
  sortRetryStates,
  sortTrustedSourceRetryStates,
  summarizeProviderDiagnostics,
} = runtime;
const {
  buildTopicState,
  mergeBrokerItemsIntoState,
  mergeUniqueItemsIntoState,
} = require(path.join(process.cwd(), "src/entrypoints/digest-orchestrator-fetch-state-runtime.js"));

assert.strictEqual(resolveMaxDiscoveryCandidateShare({}), 0.2);
assert.strictEqual(resolveMaxDiscoveryCandidateShare({ maxDiscoveryCandidateShare: 0.35 }), 0.35);
assert.strictEqual(resolveDiscoveryCandidateCapCount(8, 0.2), 2);
assert.strictEqual(resolveDiscoveryCandidateCapCount(0, 0.2), 0);

function identityAnnotate(items) {
  return Array.isArray(items) ? items : [];
}

function buildState(tag, priority, originalIndex) {
  return buildTopicState(
    { tag, queries: ["query a", "query b"] },
    { domains: ["preferred.example.com"], topic_keys: [String(tag || "").toLowerCase()], official_friendly: false },
    {
      reported_domains: ["reported.example.com"],
      official_domains: ["official.example.com"],
      global_reported_domains: ["reported.example.com"],
      global_official_domains: ["official.example.com"],
    },
    priority,
    originalIndex
  );
}

{
  const state = buildState("TECHNOLOGY", 1, 0);
  mergeBrokerItemsIntoState(
    state,
    Array.from({ length: 8 }, (_, index) => ({
      url: `https://broker.example.com/${index + 1}`,
      headline: `Broker ${index + 1}`,
      source_domain: "broker.example.com",
      retrieval_origin: "broker_publisher_feed",
      retrieval_source_family: "reported",
      broker_source_id: "broker-feed",
    })),
    (url) => String(url || "").toLowerCase(),
    () => true,
    identityAnnotate
  );
  mergeUniqueItemsIntoState(
    state,
    Array.from({ length: 5 }, (_, index) => ({
      url: `https://discovery.example.com/${index + 1}`,
      headline: `Discovery ${index + 1}`,
      source_domain: "discovery.example.com",
      published_date: `2026-04-08T0${index}:00:00.000Z`,
      source_authority: 0.9 - (index * 0.1),
    })),
    (url) => String(url || "").toLowerCase(),
    () => true
  );

  const logs = [];
  const result = enforceDiscoveryCandidateShare([state], {
    maxDiscoveryCandidateShare: 0.2,
    scoring: {},
  }, (message) => logs.push(message));

  assert.strictEqual(result.broker_candidate_count, 8);
  assert.strictEqual(result.discovery_candidate_count_before, 5);
  assert.strictEqual(result.discovery_candidate_count_after, 2);
  assert.strictEqual(result.discovery_candidate_capped_count, 3);
  assert.strictEqual(result.discovery_candidate_cap_count, 2);
  assert.strictEqual(state.items.length, 10);
  assert.strictEqual(state.discoveryCappedItemCount, 3);
  assert.ok(logs.some((line) => line.includes("Discovery supplement cap retained 2/5")));
}

{
  const lowCoverage = buildState("ENERGY", 1, 2);
  lowCoverage.totalCallsScheduled = 2;
  lowCoverage.provider.failed_calls = 1;
  lowCoverage.provider.transport_errors = 0;
  lowCoverage.provider.successful_calls = 1;
  lowCoverage.provider.status_counts = { 429: 1 };

  const higherCoverage = buildState("FINANCIAL SERVICES", 1, 1);
  higherCoverage.totalCallsScheduled = 1;
  mergeUniqueItemsIntoState(
    higherCoverage,
    [{ url: "https://story.example.com/1", headline: "One usable", source_domain: "story.example.com" }],
    (url) => String(url || "").toLowerCase(),
    () => true
  );

  const sorted = sortRetryStates([higherCoverage, lowCoverage], () => true);
  assert.deepStrictEqual(sorted.map((state) => state.topic.tag), ["ENERGY", "FINANCIAL SERVICES"]);
}

{
  const reviewHeavy = buildState("HEALTHCARE", 2, 0);
  reviewHeavy.totalCallsScheduled = 1;
  mergeUniqueItemsIntoState(
    reviewHeavy,
    [
      { headline: "Review heavy", source_policy: "review", source_tier: "blog" },
      { headline: "Another review heavy", source_policy: "review", source_tier: "weak" },
    ],
    () => "",
    () => true
  );

  const trusted = buildState("TECHNOLOGY", 2, 1);
  trusted.totalCallsScheduled = 1;
  mergeUniqueItemsIntoState(
    trusted,
    [
      { headline: "Trusted source", source_policy: "preferred", source_tier: "strong" },
      { headline: "Trusted source 2", source_policy: "allowed", source_tier: "standard" },
    ],
    () => "",
    () => true
  );

  const sorted = sortTrustedSourceRetryStates([trusted, reviewHeavy], identityAnnotate, () => true);
  assert.deepStrictEqual(sorted.map((state) => state.topic.tag), ["HEALTHCARE", "TECHNOLOGY"]);
}

{
  const state = buildState("TECHNOLOGY", 1, 0);
  state.totalCallsScheduled = 3;
  state.preferredCallsMade = 1;
  state.broadCallsMade = 2;
  state.trustedFamilyCallsMade = 1;
  state.trustedOfficialCallsMade = 1;
  state.preferredPassItemCount = 1;
  state.broadPassItemCount = 1;
  state.broadFallbackUsed = true;
  state.preferredSearchResultHitCount = 2;
  state.preferredSearchResultDomains = ["preferred.example.com"];
  state.searchResultDomains = ["preferred.example.com", "reported.example.com"];
  state.provider.degraded = true;
  state.provider.failed_calls = 1;
  state.provider.transport_errors = 1;
  state.provider.successful_calls = 2;
  state.provider.status_counts = { 429: 1, 500: 1 };
  state.provider.last_error = "provider degraded";
  state.zeroYieldRetryCount = 1;
  state.retryBlockReason = "topic_fit";
  state.nextPreferredQueryIndex = 1;
  state.nextBroadQueryIndex = 1;
  mergeBrokerItemsIntoState(
    state,
    [{
      url: "https://official.example.com/notice",
      headline: "Official notice",
      source_domain: "official.example.com",
      retrieval_origin: "broker_official",
      retrieval_source_family: "official",
      broker_source_id: "official-feed",
    }],
    (url) => String(url || "").toLowerCase(),
    () => true,
    identityAnnotate
  );
  mergeUniqueItemsIntoState(
    state,
    [{
      url: "https://preferred.example.com/story",
      headline: "Preferred story",
      source_domain: "preferred.example.com",
      retrieval_origin: "preferred",
      retrieval_source_family: "reported",
    }],
    (url) => String(url || "").toLowerCase(),
    () => true
  );
  state.preferredDomains = ["preferred.example.com"];

  const providerSummary = summarizeProviderDiagnostics([state]);
  assert.deepStrictEqual(providerSummary, {
    topics: 1,
    degraded_topics: 1,
    failed_calls: 1,
    transport_errors: 1,
    successful_calls: 2,
    status_counts: { 429: 1, 500: 1 },
  });
  assert.strictEqual(countScheduledCalls([state]), 3);
  assert.strictEqual(countStatusCode(state, 429), 1);

  const diagnostics = buildFetchDiagnostics(
    [state],
    {
      soft_calls: 6,
      hard_calls: 8,
      calls_used: 3,
      exhausted: true,
      stop_reason: "hard_cap_reached",
      rate_limit_cooldown_ms: 1200,
    },
    4,
    {
      enabled: true,
      config_source: "bundled",
      active_path: "/tmp/broker.json",
      active_topic_tags: ["TECHNOLOGY"],
      lane_counts: { publisher_feed: 0, official: 1 },
      source_fetch_count: 1,
      source_success_count: 1,
      source_failure_count: 0,
      source_diagnostics: [{ id: "official-feed", lane: "official" }],
      topic_diagnostics: {
        TECHNOLOGY: { tag: "TECHNOLOGY", item_count: 1 },
      },
    }
  );

  assert.strictEqual(diagnostics.preferred_candidate_count, 1);
  assert.strictEqual(diagnostics.broker_candidate_count, 1);
  assert.strictEqual(diagnostics.discovery_candidate_count, 1);
  assert.strictEqual(diagnostics.broad_fallback_topics_used, 1);
  assert.strictEqual(diagnostics.provider_429_count, 1);
  assert.strictEqual(diagnostics.max_concurrent_fetches, 4);
  assert.strictEqual(diagnostics.standard_topic_broker.enabled, true);
  assert.deepStrictEqual(diagnostics.standard_topic_broker.topic_diagnostics, [{ tag: "TECHNOLOGY", item_count: 1 }]);
  assert.strictEqual(diagnostics.topic_diagnostics.length, 1);
  assert.strictEqual(diagnostics.topic_diagnostics[0].coverage_status, "provider_limited_retrieval_failure");
  assert.strictEqual(diagnostics.topic_diagnostics[0].broker_item_count, 1);
}

process.stdout.write("[digest-orchestrator-fetch-diagnostics-runtime] all assertions passed\n");
