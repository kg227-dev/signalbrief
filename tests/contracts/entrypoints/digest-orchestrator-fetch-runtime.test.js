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
const { createDigestOrchestratorFetchRuntime, resolveCustomTopicSlugs } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const uncappedCustomHeavy = resolveCustomTopicSlugs({
    dueUsers: [
      { topics: ["custom_nvidia"] },
      { topics: ["custom_glp_1"] },
      { topics: ["custom_agentic_ai"] },
      { topics: ["custom_sec_rulemaking"] },
      { topics: ["custom_cbam"] },
      { topics: ["custom_rate_cuts"] },
      { topics: ["custom_grid_infrastructure"] },
      { topics: ["custom_semicap"] },
    ],
    maxCustomFetchPerRun: null,
    log: () => {},
  });
  assert.strictEqual(uncappedCustomHeavy.length, 8);

  const fetchCalls = [];
  const shortlistCalls = [];
  const incidents = [];
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "AI×TECH", queries: ["a"] },
        { tag: "STRATEGY", queries: ["b"] },
      ],
      digest: {
        itemCount: 7,
        maxCustomFetchPerRun: 3,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      fetchCalls.push({ topic, opts });
      if (topic.isCustom) {
        return {
          apiCalls: 2,
          items: [{ headline: "custom", tag: topic.tag, source: "fda.gov" }],
          diagnostics: {
            provider: "perplexity",
            preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
            preferred_fallback_triggered: false,
            preferred_pass_item_count: 1,
            broad_pass_item_count: 0,
            search_result_domains: ["fda.gov"],
            preferred_search_result_domains: ["fda.gov"],
            preferred_search_result_hit_count: 1,
            preferred_search_results_without_preferred_item: false,
          },
        };
      }
      return {
        apiCalls: 1,
        items: [
          { headline: `${topic.tag} standard one`, tag: topic.tag, source: topic.tag === "AI×TECH" ? "theinformation.com" : "wsj.com" },
          { headline: `${topic.tag} standard two`, tag: topic.tag, source: topic.tag === "AI×TECH" ? "reuters.com" : "wsj.com" },
        ],
        diagnostics: {
          provider: "perplexity",
          preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
          preferred_fallback_triggered: false,
          preferred_pass_item_count: 2,
          broad_pass_item_count: 0,
          search_result_domains: topic.tag === "AI×TECH" ? ["theinformation.com", "reuters.com"] : ["wsj.com", "reuters.com"],
          preferred_search_result_domains: topic.tag === "AI×TECH" ? ["theinformation.com"] : ["wsj.com"],
          preferred_search_result_hit_count: 1,
          preferred_search_results_without_preferred_item: false,
        },
      };
    },
    buildPreferredDomainShortlist: ({ topicTag, dueUserTopics }) => {
      shortlistCalls.push({ topicTag, dueUserTopics });
      if (String(topicTag).toUpperCase() === "AI×TECH") {
        return { domains: ["theinformation.com", "reuters.com"], topic_keys: ["ai tech"], official_friendly: false };
      }
      if (String(topicTag).toUpperCase() === "STRATEGY") {
        return { domains: ["wsj.com"], topic_keys: ["strategy"], official_friendly: false };
      }
      if (String(topicTag).toUpperCase() === "LIFE SCIENCES") {
        return { domains: ["fda.gov", "statnews.com"], topic_keys: ["life sciences"], official_friendly: true };
      }
      return { domains: ["sec.gov"], topic_keys: [], official_friendly: true };
    },
    buildCustomTopicQueries: (keyword) => [`${keyword} query`],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async (...args) => {
      incidents.push(args);
    },
  });

  const fetched = await fetchRuntime.orchestrateFetch({
    dueUsers: [
      {
        topics: ["AI×TECH", "custom_glp_1"],
        preferences: { items_per_digest: 10 },
      },
    ],
    targetChatId: "123",
    runMode: "targeted",
  });

  assert.strictEqual(fetched.selectionTarget, 10);
  // On-demand targeted runs now fetch ALL configured topics (not just user's)
  // to prevent thin digest pools from cross-day dedup decimation.
  assert.strictEqual(fetched.standardFetchCallsPlanned, 2);
  assert.strictEqual(fetched.standardFetchCalls, 2);
  assert.strictEqual(fetched.customFetchCalls, 2);
  assert.deepStrictEqual(
    fetchCalls.map(({ topic }) => topic.tag),
    ["AI×TECH", "STRATEGY", "GLP 1"]
  );
  assert.deepStrictEqual(
    fetchCalls[0].opts.retrievalPlan.preferred_domains,
    ["theinformation.com", "reuters.com"]
  );
  assert.deepStrictEqual(
    fetchCalls[1].opts.retrievalPlan.preferred_domains,
    ["wsj.com"]
  );
  assert.deepStrictEqual(
    fetchCalls[2].opts.retrievalPlan.preferred_domains,
    ["fda.gov", "statnews.com"]
  );
  assert.strictEqual(shortlistCalls.length, 3);
  assert.strictEqual(shortlistCalls[2].topicTag, "LIFE SCIENCES");
  assert.strictEqual(shortlistCalls[2].dueUserTopics.includes("LIFE SCIENCES"), true);
  assert.strictEqual(fetched.tagPriority["ai×tech"], 1);
  assert.strictEqual(fetched.tagPriority.custom_glp_1, 1);
  assert.strictEqual(Array.isArray(fetched.allItems), true);
  assert.deepStrictEqual(
    fetched.fetchDiagnostics.preferred_domains_used,
    ["theinformation.com", "reuters.com", "wsj.com", "fda.gov", "statnews.com"]
  );
  assert.strictEqual(fetched.fetchDiagnostics.preferred_fallback_triggered, false);
  assert.strictEqual(fetched.fetchDiagnostics.preferred_pass_item_count, 5);
  assert.strictEqual(fetched.fetchDiagnostics.broad_pass_item_count, 0);
  assert.deepStrictEqual(
    fetched.fetchDiagnostics.preferred_search_result_domains,
    ["theinformation.com", "wsj.com", "fda.gov"]
  );
  assert.strictEqual(fetched.fetchDiagnostics.preferred_search_result_hit_count, 3);
  assert.strictEqual(fetched.fetchDiagnostics.preferred_search_results_without_preferred_item_count, 0);
  assert.strictEqual(fetched.fetchDiagnostics.search_budget_soft_calls, 6);
  assert.strictEqual(fetched.fetchDiagnostics.search_budget_hard_calls, 9);
  assert.strictEqual(fetched.fetchDiagnostics.search_budget_calls_used, 3);
  assert.strictEqual(fetched.fetchDiagnostics.search_budget_exhausted, false);
  assert.strictEqual(fetched.fetchDiagnostics.broad_fallback_topics_used, 0);
  assert.strictEqual(fetched.fetchDiagnostics.zero_yield_retry_count, 0);
  assert.strictEqual(fetched.fetchDiagnostics.budget_stop_reason, null);
  assert.strictEqual(incidents.length, 0);

  const budgetedFetchCalls = [];
  const budgetRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "AI×TECH", queries: ["a1", "a2"] },
        { tag: "STRATEGY", queries: ["b1", "b2"] },
        { tag: "ENERGY", queries: ["c1", "c2"] },
        { tag: "HEALTHCARE", queries: ["d1", "d2"] },
      ],
      digest: {
        itemCount: 7,
        search_budget: {
          on_demand: {
            soft_calls: 2,
            hard_calls: 3,
          },
          custom_topic_reserve_calls: 0,
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
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const budgetedResult = await budgetRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["AI×TECH", "STRATEGY"], preferences: {} }],
    targetChatId: "123",
    runMode: "targeted",
  });
  assert.strictEqual(budgetedResult.standardFetchCallsPlanned, 3);
  assert.strictEqual(budgetedResult.standardFetchCalls, 3);
  assert.deepStrictEqual(budgetedFetchCalls, ["AI×TECH", "STRATEGY", "ENERGY"]);
  assert.strictEqual(budgetedResult.fetchDiagnostics.search_budget_calls_used, 3);
  assert.strictEqual(budgetedResult.fetchDiagnostics.search_budget_exhausted, true);
  assert.strictEqual(budgetedResult.fetchDiagnostics.budget_stop_reason, "hard_cap_reached");
  assert.strictEqual(budgetedResult.fetchDiagnostics.alternate_queries_used, 0);

  const emptyIncidents = [];
  const emptyRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["b"] }],
      digest: {
        itemCount: 7,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async () => ({ apiCalls: 1, items: [] }),
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async (type) => {
      emptyIncidents.push(type);
    },
  });

  const emptyResult = await emptyRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["STRATEGY"], preferences: {} }],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.deepStrictEqual(emptyResult.allItems, []);
  assert.deepStrictEqual(emptyIncidents, ["zero-standard-results", "zero-raw-items"]);

  const degradedIncidents = [];
  const degradedRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [
        { tag: "AI×TECH", queries: ["a"] },
        { tag: "STRATEGY", queries: ["b"] },
      ],
      digest: { itemCount: 7 },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => {
      if (topic.tag === "AI×TECH") {
        return {
          apiCalls: 1,
          items: [{ headline: "AI story", tag: topic.tag }],
          diagnostics: {
            provider: "perplexity",
            degraded: false,
            failed_calls: 0,
            transport_errors: 0,
            successful_calls: 1,
            status_counts: {},
          },
        };
      }
      return {
        apiCalls: 1,
        items: [],
        diagnostics: {
          provider: "perplexity",
          degraded: true,
          failed_calls: 1,
          transport_errors: 0,
          successful_calls: 0,
          status_counts: { 503: 1 },
        },
      };
    },
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async (...args) => {
      degradedIncidents.push(args);
    },
  });

  const degradedResult = await degradedRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["AI×TECH", "STRATEGY"], preferences: {} }],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(degradedResult.allItems.length, 1);
  assert.deepStrictEqual(
    degradedIncidents.map((args) => args[0]),
    ["perplexity-partial-degradation"]
  );
  assert.strictEqual(degradedIncidents[0][2].degraded_topics, 1);
  assert.strictEqual(degradedIncidents[0][2].fetched_topics, 2);
  assert.strictEqual(degradedIncidents[0][2].failed_calls, 1);

  const retryCalls = [];
  const retryRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["q1", "q2", "q3"] }],
      digest: {
        itemCount: 7,
        search_budget: {
          scheduled: {
            soft_calls: 4,
            hard_calls: 4,
          },
          custom_topic_reserve_calls: 0,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      retryCalls.push({ tag: topic.tag, retrievalPlan: opts?.retrievalPlan || {} });
      const broadOnly = opts?.retrievalPlan?.broad_only === true;
      if (broadOnly) {
        return {
          apiCalls: 1,
          items: [{ headline: "strategy-broad", tag: topic.tag, source: "other.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      if (topic.queries[0] === "q1") {
        return {
          apiCalls: 1,
          items: [],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [{ headline: "strategy-one", tag: topic.tag, source: "wsj.com" }],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: () => ({ domains: ["wsj.com"], topic_keys: ["strategy"], official_friendly: false }),
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
    normalizeUrlForDedup: (value) => String(value || "").trim().toLowerCase(),
  });

  const retryResult = await retryRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["STRATEGY"], preferences: {} }],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(retryResult.standardFetchCalls, 2);
  assert.strictEqual(retryResult.fetchDiagnostics.zero_yield_retry_count, 0);
  assert.strictEqual(retryResult.fetchDiagnostics.broad_fallback_topics_used, 1);
  assert.strictEqual(retryResult.fetchDiagnostics.alternate_queries_used, 1);
  assert.deepStrictEqual(
    retryCalls.map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "broad"]
  );

  const deepRetryCalls = [];
  const deepRetryRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "HEALTHCARE", queries: ["q1", "q2", "q3"] }],
      digest: {
        itemCount: 7,
        search_budget: {
          scheduled: {
            soft_calls: 2,
            hard_calls: 3,
          },
          custom_topic_reserve_calls: 0,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      deepRetryCalls.push({ query: topic.queries[0], retrievalPlan: opts?.retrievalPlan || {} });
      const broadOnly = opts?.retrievalPlan?.broad_only === true;
      if (broadOnly && topic.queries[0] === "q2") {
        return {
          apiCalls: 1,
          items: [{ headline: "healthcare-recovered", tag: topic.tag, source: "reuters.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: () => ({ domains: ["fda.gov"], topic_keys: ["healthcare"], official_friendly: true }),
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const deepRetryResult = await deepRetryRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["HEALTHCARE"], preferences: {} }],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(deepRetryResult.standardFetchCalls, 3);
  assert.strictEqual(deepRetryResult.fetchDiagnostics.deep_broad_retry_topics_used, 1);
  assert.deepStrictEqual(
    deepRetryCalls.map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "broad", "broad"]
  );

  const customRetryCalls = [];
  const customRetryRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["standard-q1"] }],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 4,
            hard_calls: 4,
          },
          custom_topic_reserve_calls: 2,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      customRetryCalls.push({ tag: topic.tag, query: topic.queries[0], retrievalPlan: opts?.retrievalPlan || {} });
      if (topic.isCustom && opts?.retrievalPlan?.broad_only === true) {
        return {
          apiCalls: 1,
          items: [{ headline: `${topic.tag} recovered`, tag: topic.tag, source: "reuters.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      if (topic.isCustom) {
        return {
          apiCalls: 1,
          items: [],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [{ headline: "standard", tag: topic.tag, source: "wsj.com" }],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: ({ topicTag }) => {
      if (String(topicTag).toUpperCase() === "AI×TECH") {
        return { domains: ["theinformation.com", "reuters.com"], topic_keys: ["ai tech"], official_friendly: false };
      }
      return { domains: ["wsj.com"], topic_keys: ["strategy"], official_friendly: false };
    },
    buildCustomTopicQueries: () => ["custom-q1", "custom-q2"],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const customRetryResult = await customRetryRuntime.orchestrateFetch({
    dueUsers: [
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
    ],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(customRetryResult.customFetchCalls, 2);
  assert.strictEqual(customRetryResult.fetchDiagnostics.broad_fallback_topics_used, 1);
  assert.deepStrictEqual(
    customRetryCalls.filter((row) => row.tag === "NVIDIA").map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "broad"]
  );

  const customDeepRetryCalls = [];
  const customDeepRetryRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["standard-q1"] }],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 5,
            hard_calls: 5,
          },
          custom_topic_reserve_calls: 1,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      customDeepRetryCalls.push({ tag: topic.tag, query: topic.queries[0], retrievalPlan: opts?.retrievalPlan || {} });
      if (!topic.isCustom) {
        return {
          apiCalls: 1,
          items: [{ headline: "standard", tag: topic.tag, source: "wsj.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      if (opts?.retrievalPlan?.broad_only === true && topic.queries[0] === "custom-q4") {
        return {
          apiCalls: 1,
          items: [{ headline: "custom recovered", tag: topic.tag, source: "reuters.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: ({ topicTag }) => {
      if (String(topicTag).toUpperCase() === "AI×TECH") {
        return { domains: ["theinformation.com", "reuters.com"], topic_keys: ["ai tech"], official_friendly: false };
      }
      return { domains: ["wsj.com"], topic_keys: ["strategy"], official_friendly: false };
    },
    buildCustomTopicQueries: () => ["custom-q1", "custom-q2", "custom-q3", "custom-q4"],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const customDeepRetryResult = await customDeepRetryRuntime.orchestrateFetch({
    dueUsers: [
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
    ],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(customDeepRetryResult.customFetchCalls, 5);
  assert.strictEqual(customDeepRetryResult.fetchDiagnostics.deep_broad_retry_topics_used >= 1, true);
  assert.deepStrictEqual(
    customDeepRetryCalls.filter((row) => row.tag === "NVIDIA").map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "broad", "broad", "broad", "broad"]
  );

  const rateLimitedDeepRetryCalls = [];
  const rateLimitedDeepRetryRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "HEALTHCARE", queries: ["q1", "q2", "q3"] }],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 4,
            hard_calls: 4,
          },
          custom_topic_reserve_calls: 0,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      rateLimitedDeepRetryCalls.push({ query: topic.queries[0], retrievalPlan: opts?.retrievalPlan || {} });
      const broadAttemptCount = rateLimitedDeepRetryCalls.filter((entry) => entry.retrievalPlan.broad_only === true).length;
      if (opts?.retrievalPlan?.broad_only === true && broadAttemptCount === 1) {
        return {
          apiCalls: 1,
          items: [],
          diagnostics: { provider: "perplexity", successful_calls: 0, failed_calls: 1, transport_errors: 0, status_counts: { 429: 1 }, rate_limit_retry_after_ms: 0 },
        };
      }
      if (opts?.retrievalPlan?.broad_only === true && broadAttemptCount === 2) {
        return {
          apiCalls: 1,
          items: [{ headline: "healthcare recovered", tag: topic.tag, source: "statnews.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: () => ({ domains: ["fda.gov"], topic_keys: ["healthcare"], official_friendly: true }),
    buildCustomTopicQueries: () => [],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const rateLimitedDeepRetryResult = await rateLimitedDeepRetryRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["HEALTHCARE"], preferences: {} }],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(rateLimitedDeepRetryResult.standardFetchCalls, 3);
  assert.strictEqual(rateLimitedDeepRetryResult.allItems.length, 1);
  assert.strictEqual(rateLimitedDeepRetryResult.fetchDiagnostics.provider_429_count, 1);
  assert.strictEqual(rateLimitedDeepRetryResult.fetchDiagnostics.rate_limit_cooldown_ms > 0, true);
  assert.deepStrictEqual(
    rateLimitedDeepRetryCalls.map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "broad", "broad"]
  );

  const previousConcurrencyEnv = process.env.SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES;
  process.env.SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES = "2";
  try {
    let inFlight = 0;
    let maxInFlight = 0;
    const concurrencyRuntime = createDigestOrchestratorFetchRuntime({
      CONFIG: {
        topics: [
          { tag: "AI×TECH", queries: ["a"] },
          { tag: "STRATEGY", queries: ["b"] },
          { tag: "ENERGY", queries: ["c"] },
          { tag: "HEALTHCARE", queries: ["d"] },
        ],
        digest: { itemCount: 4 },
      },
      log: () => {},
      normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
      fetchTopicNews: async (topic) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          apiCalls: 1,
          items: [{ headline: `${topic.tag} only item`, tag: topic.tag }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      },
      buildCustomTopicQueries: () => [],
      buildCustomRescueItemsFromStandard: () => [],
      emitDigestIncident: async () => {},
    });

    const concurrencyResult = await concurrencyRuntime.orchestrateFetch({
      dueUsers: [{ topics: ["AI×TECH"], preferences: {} }],
      targetChatId: null,
      runMode: "scheduled",
    });
    assert.strictEqual(maxInFlight, 2);
    assert.strictEqual(concurrencyResult.fetchDiagnostics.max_concurrent_fetches, 2);
  } finally {
    if (previousConcurrencyEnv == null) delete process.env.SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES;
    else process.env.SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES = previousConcurrencyEnv;
  }

  const customHeavyCalls = [];
  const customHeavyRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["standard-q1", "standard-q2"] }],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 8,
            hard_calls: 8,
          },
          custom_topic_reserve_calls: 2,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => {
      customHeavyCalls.push({ tag: topic.tag, query: topic.queries[0] });
      if (topic.isCustom && String(topic.queries[0]).includes("retry")) {
        return {
          apiCalls: 1,
          items: [{ headline: `${topic.tag} recovered`, tag: topic.tag, source: "reuters.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      if (topic.isCustom) {
        return {
          apiCalls: 1,
          items: [],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [{ headline: "standard", tag: topic.tag, source: "wsj.com" }],
        diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
      };
    },
    buildPreferredDomainShortlist: () => ({ domains: [], topic_keys: [], official_friendly: false }),
    buildCustomTopicQueries: (keyword) => [`${keyword} primary`, `${keyword} retry`],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const customHeavyResult = await customHeavyRuntime.orchestrateFetch({
    dueUsers: [
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
      { topics: ["STRATEGY", "custom_glp_1"], preferences: {} },
      { topics: ["STRATEGY", "custom_agentic_ai"], preferences: {} },
      { topics: ["STRATEGY", "custom_cbam"], preferences: {} },
    ],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.deepStrictEqual(
    customHeavyCalls.map((row) => row.tag),
    ["NVIDIA", "GLP 1", "AGENTIC AI", "CBAM", "NVIDIA", "GLP 1"]
  );
  assert.strictEqual(customHeavyResult.customFetchCalls, 6);
  assert.strictEqual(customHeavyResult.fetchDiagnostics.alternate_queries_used, 2);
  assert.strictEqual(customHeavyResult.fetchDiagnostics.thin_topic_count >= 1, true);
  assert.strictEqual(
    customHeavyResult.fetchDiagnostics.topic_diagnostics.some((entry) => entry.tag === "NVIDIA"),
    true
  );

  const customHeavyDeepCalls = [];
  const customHeavyDeepRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "STRATEGY", queries: ["standard-q1"] }],
      digest: {
        itemCount: 5,
        search_budget: {
          scheduled: {
            soft_calls: 19,
            hard_calls: 19,
          },
          custom_topic_reserve_calls: 2,
        },
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic, opts) => {
      customHeavyDeepCalls.push({
        tag: topic.tag,
        query: topic.queries[0],
        retrievalPlan: opts?.retrievalPlan || {},
      });
      if (!topic.isCustom) {
        return {
          apiCalls: 1,
          items: [{ headline: "standard", tag: topic.tag, source: "wsj.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      return {
        apiCalls: 1,
        items: [],
        diagnostics: {
          provider: "perplexity",
          successful_calls: 1,
          failed_calls: 0,
          transport_errors: 0,
          status_counts: {},
          search_result_domains: ["semianalysis.com", "reuters.com"],
          preferred_search_result_domains: ["semianalysis.com"],
          preferred_search_result_hit_count: topic.tag === "SEMICAP" ? 3 : 1,
        },
      };
    },
    buildPreferredDomainShortlist: ({ topicTag }) => {
      if (String(topicTag).toUpperCase() === "AI×TECH") {
        return { domains: ["semianalysis.com", "reuters.com"], topic_keys: ["ai tech"], official_friendly: false };
      }
      return { domains: ["wsj.com"], topic_keys: ["strategy"], official_friendly: false };
    },
    buildCustomTopicQueries: (keyword) => [
      `${keyword} primary`,
      `${keyword} retry one`,
      `${keyword} retry two`,
      `${keyword} retry three`,
    ],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });

  const customHeavyDeepResult = await customHeavyDeepRuntime.orchestrateFetch({
    dueUsers: [
      { topics: ["STRATEGY", "custom_nvidia"], preferences: {} },
      { topics: ["STRATEGY", "custom_glp_1"], preferences: {} },
      { topics: ["STRATEGY", "custom_agentic_ai"], preferences: {} },
      { topics: ["STRATEGY", "custom_semicap"], preferences: {} },
    ],
    targetChatId: null,
    runMode: "scheduled",
  });
  assert.strictEqual(customHeavyDeepResult.standardFetchCalls, 1);
  assert.strictEqual(customHeavyDeepResult.customFetchCalls, 18);
  const semicapDiagnostics = customHeavyDeepResult.fetchDiagnostics.topic_diagnostics.find((entry) => entry.tag === "SEMICAP");
  assert.strictEqual(semicapDiagnostics.broad_call_count, 4);
  assert.strictEqual(semicapDiagnostics.remaining_broad_queries, 0);
})();
