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
const { createDigestOrchestratorFetchRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
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
          items: [{ headline: "custom", tag: topic.tag, source: "sec.gov" }],
          diagnostics: {
            provider: "perplexity",
            preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
            preferred_fallback_triggered: false,
            preferred_pass_item_count: 1,
            broad_pass_item_count: 0,
            search_result_domains: ["sec.gov"],
            preferred_search_result_domains: ["sec.gov"],
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
    ["sec.gov"]
  );
  assert.strictEqual(shortlistCalls.length, 3);
  assert.strictEqual(fetched.tagPriority["ai×tech"], 1);
  assert.strictEqual(fetched.tagPriority.custom_glp_1, 1);
  assert.strictEqual(Array.isArray(fetched.allItems), true);
  assert.deepStrictEqual(
    fetched.fetchDiagnostics.preferred_domains_used,
    ["theinformation.com", "reuters.com", "wsj.com", "sec.gov"]
  );
  assert.strictEqual(fetched.fetchDiagnostics.preferred_fallback_triggered, false);
  assert.strictEqual(fetched.fetchDiagnostics.preferred_pass_item_count, 5);
  assert.strictEqual(fetched.fetchDiagnostics.broad_pass_item_count, 0);
  assert.deepStrictEqual(
    fetched.fetchDiagnostics.preferred_search_result_domains,
    ["theinformation.com", "wsj.com", "sec.gov"]
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
      const allowBroadFallback = opts?.retrievalPlan?.allow_broad_fallback !== false;
      if (broadOnly) {
        return {
          apiCalls: 1,
          items: [{ headline: "strategy-broad", tag: topic.tag, source: "other.com" }],
          diagnostics: { provider: "perplexity", successful_calls: 1, failed_calls: 0, transport_errors: 0, status_counts: {} },
        };
      }
      if (allowBroadFallback === false && topic.queries[0] === "q1") {
        return {
          apiCalls: 1,
          items: [{ headline: "strategy-one", tag: topic.tag, source: "wsj.com" }],
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
  assert.strictEqual(retryResult.fetchDiagnostics.zero_yield_retry_count, 1);
  assert.strictEqual(retryResult.fetchDiagnostics.broad_fallback_topics_used, 0);
  assert.strictEqual(retryResult.fetchDiagnostics.alternate_queries_used, 1);
  assert.deepStrictEqual(
    retryCalls.map((entry) => entry.retrievalPlan.broad_only === true ? "broad" : "preferred"),
    ["preferred", "preferred"]
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
})();
