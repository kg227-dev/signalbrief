"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  createDigestOrchestratorFetchRuntime,
  resolveTopicsToFetch,
  resolveDiscoveryCandidateCapCount,
  resolveMaxDiscoveryCandidateShare,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  assert.strictEqual(resolveMaxDiscoveryCandidateShare({}), 0.2);
  assert.strictEqual(resolveMaxDiscoveryCandidateShare({ maxDiscoveryCandidateShare: 0.35 }), 0.35);
  assert.strictEqual(resolveDiscoveryCandidateCapCount(8, 0.2), 2);
  assert.strictEqual(resolveDiscoveryCandidateCapCount(0, 0.2), 0);

  const focusedTopics = resolveTopicsToFetch({
    configTopics: [
      { tag: "HEALTHCARE", queries: ["a", "b"] },
      { tag: "LIFE SCIENCES", queries: ["c", "d"] },
      { tag: "TECHNOLOGY", queries: ["e", "f"] },
      { tag: "FINANCIAL SERVICES", queries: ["g", "h"] },
      { tag: "ENERGY", queries: ["i", "j"] },
      { tag: "CONSUMER & RETAIL", queries: ["k", "l"] },
      { tag: "INDUSTRIALS", queries: ["m", "n"] },
    ],
    dueUsers: [
      { topics: ["HEALTHCARE", "FINANCIAL SERVICES"] },
      { topics: ["LIFE SCIENCES", "HEALTHCARE"] },
      { topics: ["TECHNOLOGY", "INDUSTRIALS"] },
      { topics: ["ENERGY", "CONSUMER & RETAIL"] },
    ],
    runMode: "standard_core",
    log: () => {},
  });
  assert.deepStrictEqual(
    focusedTopics.map((topic) => topic.tag),
    ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "FINANCIAL SERVICES", "ENERGY"]
  );

  const fetchCalls = [];
  const shortlistCalls = [];
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "TECHNOLOGY", queries: ["a"] },
        { tag: "FINANCIAL SERVICES", queries: ["b"] },
      ],
      digest: {
        itemCount: 5,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      fetchCalls.push({ topic, opts });
      return {
        apiCalls: 1,
        items: [
          { headline: `${topic.tag} one`, tag: topic.tag, source: topic.tag === "TECHNOLOGY" ? "theinformation.com" : "wsj.com" },
          { headline: `${topic.tag} two`, tag: topic.tag, source: "reuters.com" },
        ],
        diagnostics: {
          provider: "perplexity",
          preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
          preferred_fallback_triggered: false,
          preferred_pass_item_count: 2,
          broad_pass_item_count: 0,
          search_result_domains: topic.tag === "TECHNOLOGY" ? ["theinformation.com", "reuters.com"] : ["wsj.com", "reuters.com"],
          preferred_search_result_domains: topic.tag === "TECHNOLOGY" ? ["theinformation.com"] : ["wsj.com"],
          preferred_search_result_hit_count: 1,
          preferred_search_results_without_preferred_item: false,
        },
      };
    },
    buildPreferredDomainShortlist: ({ topicTag, dueUserTopics }) => {
      shortlistCalls.push({ topicTag, dueUserTopics });
      if (String(topicTag).toUpperCase() === "TECHNOLOGY") {
        return { domains: ["theinformation.com", "reuters.com"], topic_keys: ["technology"], official_friendly: false };
      }
      return { domains: ["wsj.com"], topic_keys: ["financial services"], official_friendly: false };
    },
    emitDigestIncident: async () => false,
  });

  const fetched = await fetchRuntime.orchestrateFetch({
    dueUsers: [
      { topics: ["TECHNOLOGY", "FINANCIAL SERVICES"] },
    ],
    runMode: "scheduled",
  });

  assert.strictEqual(fetched.selectionTarget, 5);
  assert.strictEqual(fetched.standardFetchCallsPlanned, 2);
  assert.strictEqual(fetched.standardFetchCalls, 2);
  assert.deepStrictEqual(
    fetchCalls.map(({ topic }) => topic.tag),
    ["TECHNOLOGY", "FINANCIAL SERVICES"]
  );
  assert.deepStrictEqual(
    fetchCalls[0].opts.retrievalPlan.preferred_domains,
    ["theinformation.com", "reuters.com"]
  );
  assert.deepStrictEqual(
    fetchCalls[1].opts.retrievalPlan.preferred_domains,
    ["wsj.com"]
  );
  assert.strictEqual(shortlistCalls.length, 2);
  assert.strictEqual(fetched.tagPriority.technology, 1);
  assert.strictEqual(fetched.fetchDiagnostics.search_budget_calls_used, 2);
  assert.strictEqual(fetched.fetchDiagnostics.standard_topic_broker.enabled, false);

  const brokerRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "HEALTHCARE", queries: ["a"] },
      ],
      digest: {
        itemCount: 5,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async () => ({
      apiCalls: 1,
      items: [],
      diagnostics: {
        provider: "perplexity",
        successful_calls: 1,
        failed_calls: 0,
        transport_errors: 0,
        status_counts: {},
      },
    }),
    annotateFetchedItems: (items) => Array.isArray(items) ? items.map((item) => ({ ...item, annotated: true })) : [],
    standardTopicBrokerRuntime: {
      fetchBrokerCandidates: async () => ({
        topicItems: {
          HEALTHCARE: [{
            headline: "FDA approves rare disease therapy",
            url: "https://www.fda.gov/news-events/press-announcements/fda-approves-rare-disease-therapy",
            canonical_url: "https://www.fda.gov/news-events/press-announcements/fda-approves-rare-disease-therapy",
            published_date: "2026-03-22T14:00:00.000Z",
            tag: "HEALTHCARE",
            source: "fda.gov",
            source_domain: "fda.gov",
            source_policy: "preferred",
            source_authority: 0.9,
            source_type: "primary_official",
            source_tier: "strong",
            content_kind: "official_document",
            retrieval_origin: "broker_official",
            broker_source_id: "fda_healthcare",
          }],
        },
        diagnostics: {
          enabled: true,
          config_source: "bundled",
          active_path: "/tmp/broker.json",
          active_topic_tags: ["HEALTHCARE"],
          lane_counts: { publisher_feed: 0, official: 1 },
          source_fetch_count: 1,
          source_success_count: 1,
          source_failure_count: 0,
          source_diagnostics: [{ id: "fda_healthcare", lane: "official", retained_count: 1 }],
          topic_diagnostics: {
            HEALTHCARE: {
              tag: "HEALTHCARE",
              lane_counts: { publisher_feed: 0, official: 1 },
              source_counts: { fda_healthcare: 1 },
              source_ids: ["fda_healthcare"],
              item_count: 1,
              article_item_count: 0,
              official_document_count: 1,
              errors: [],
            },
          },
        },
      }),
    },
    emitDigestIncident: async () => {},
  });

  const brokered = await brokerRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["HEALTHCARE"] }],
    runMode: "standard_phase1",
  });
  assert.strictEqual(brokered.allItems.length, 1);
  assert.strictEqual(brokered.allItems[0].retrieval_origin, "broker_official");
  assert.strictEqual(brokered.fetchDiagnostics.standard_topic_broker.enabled, true);
  assert.strictEqual(brokered.fetchDiagnostics.retrieval_origin_counts.broker_official, 1);

  const budgetedFetchCalls = [];
  const budgetRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "TECHNOLOGY", queries: ["a1", "a2"] },
        { tag: "FINANCIAL SERVICES", queries: ["b1", "b2"] },
        { tag: "ENERGY", queries: ["c1", "c2"] },
        { tag: "HEALTHCARE", queries: ["d1", "d2"] },
      ],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 2,
            hard_calls: 3,
          },
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => {
      budgetedFetchCalls.push(topic.tag);
      return {
        apiCalls: 1,
        items: [{ headline: `${topic.tag} only item`, tag: topic.tag }],
        diagnostics: {
          provider: "perplexity",
          successful_calls: 1,
          failed_calls: 0,
          transport_errors: 0,
          status_counts: {},
        },
      };
    },
    emitDigestIncident: async () => {},
  });

  const budgetedResult = await budgetRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["TECHNOLOGY", "FINANCIAL SERVICES"] }],
    runMode: "scheduled",
  });
  assert.strictEqual(budgetedResult.standardFetchCallsPlanned, 3);
  assert.strictEqual(budgetedResult.standardFetchCalls, 3);
  assert.deepStrictEqual(budgetedFetchCalls, ["TECHNOLOGY", "FINANCIAL SERVICES", "ENERGY"]);
  assert.strictEqual(budgetedResult.fetchDiagnostics.search_budget_calls_used, 3);
  assert.strictEqual(budgetedResult.fetchDiagnostics.search_budget_exhausted, true);
  assert.strictEqual(budgetedResult.fetchDiagnostics.budget_stop_reason, "hard_cap_reached");

  const discoveryCapRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "TECHNOLOGY", queries: ["a"] },
      ],
      digest: {
        itemCount: 5,
        maxDiscoveryCandidateShare: 0.2,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => ({
      apiCalls: 1,
      items: [
        { headline: `${topic.tag} discovery 1`, url: "https://discovery.example.com/1", tag: topic.tag, source: "discovery.example.com", source_domain: "discovery.example.com", published_date: "2026-03-27T10:00:00.000Z", source_tier: 2, source_authority: 0.7 },
        { headline: `${topic.tag} discovery 2`, url: "https://discovery.example.com/2", tag: topic.tag, source: "discovery.example.com", source_domain: "discovery.example.com", published_date: "2026-03-27T09:00:00.000Z", source_tier: 2, source_authority: 0.65 },
        { headline: `${topic.tag} discovery 3`, url: "https://discovery.example.com/3", tag: topic.tag, source: "discovery.example.com", source_domain: "discovery.example.com", published_date: "2026-03-27T08:00:00.000Z", source_tier: 2, source_authority: 0.6 },
        { headline: `${topic.tag} discovery 4`, url: "https://discovery.example.com/4", tag: topic.tag, source: "discovery.example.com", source_domain: "discovery.example.com", published_date: "2026-03-27T07:00:00.000Z", source_tier: 3, source_authority: 0.5 },
        { headline: `${topic.tag} discovery 5`, url: "https://discovery.example.com/5", tag: topic.tag, source: "discovery.example.com", source_domain: "discovery.example.com", published_date: "2026-03-27T06:00:00.000Z", source_tier: 3, source_authority: 0.4 },
      ],
      diagnostics: {
        provider: "perplexity",
        successful_calls: 1,
        failed_calls: 0,
        transport_errors: 0,
        status_counts: {},
      },
    }),
    standardTopicBrokerRuntime: {
      fetchBrokerCandidates: async () => ({
        topicItems: {
          TECHNOLOGY: Array.from({ length: 8 }, (_, index) => ({
            headline: `Technology feed ${index + 1}`,
            url: `https://feed.example.com/${index + 1}`,
            canonical_url: `https://feed.example.com/${index + 1}`,
            published_date: `2026-03-27T0${Math.min(index, 9)}:00:00.000Z`,
            tag: "TECHNOLOGY",
            source: "feed.example.com",
            source_domain: "feed.example.com",
            source_policy: "preferred",
            source_authority: 0.9,
            source_type: "reported_media",
            source_tier: 1,
            content_kind: "article",
            retrieval_origin: "broker_publisher_feed",
            broker_source_id: "tech_feed",
          })),
        },
        diagnostics: {
          enabled: true,
          config_source: "bundled",
          active_path: "/tmp/broker.json",
          active_topic_tags: ["TECHNOLOGY"],
          lane_counts: { publisher_feed: 8, official: 0 },
          source_fetch_count: 1,
          source_success_count: 1,
          source_failure_count: 0,
          source_diagnostics: [{ id: "tech_feed", lane: "publisher_feed", retained_count: 8 }],
          topic_diagnostics: {
            TECHNOLOGY: {
              tag: "TECHNOLOGY",
              lane_counts: { publisher_feed: 8, official: 0 },
              source_counts: { tech_feed: 8 },
              source_ids: ["tech_feed"],
              item_count: 8,
              article_item_count: 8,
              official_document_count: 0,
              errors: [],
            },
          },
        },
      }),
    },
    emitDigestIncident: async () => {},
  });

  const discoveryCapped = await discoveryCapRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["TECHNOLOGY"] }],
    runMode: "scheduled",
  });
  assert.strictEqual(discoveryCapped.allItems.length, 10);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.broker_candidate_count, 8);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.discovery_candidate_count, 2);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.discovery_candidate_capped_count, 3);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.discovery_candidate_cap_count, 2);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.discovery_candidate_share_pct, 20);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.max_discovery_candidate_share_pct, 20);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.topic_diagnostics[0].discovery_capped_count, 3);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.topic_diagnostics[0].discovery_item_count, 2);
  assert.strictEqual(discoveryCapped.fetchDiagnostics.topic_diagnostics[0].discovery_candidate_share_pct, 20);
})();
