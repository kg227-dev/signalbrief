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
          items: [{ headline: "custom", tag: topic.tag }],
          diagnostics: {
            provider: "perplexity",
            preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
            preferred_fallback_triggered: false,
            preferred_pass_item_count: 1,
            broad_pass_item_count: 0,
          },
        };
      }
      return {
        apiCalls: 1,
        items: [{ headline: "standard", tag: topic.tag }],
        diagnostics: {
          provider: "perplexity",
          preferred_domains_used: opts?.retrievalPlan?.preferred_domains || [],
          preferred_fallback_triggered: topic.tag === "STRATEGY",
          preferred_pass_item_count: 1,
          broad_pass_item_count: topic.tag === "STRATEGY" ? 1 : 0,
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
  assert.strictEqual(fetched.fetchDiagnostics.preferred_fallback_triggered, true);
  assert.strictEqual(fetched.fetchDiagnostics.preferred_pass_item_count, 3);
  assert.strictEqual(fetched.fetchDiagnostics.broad_pass_item_count, 1);
  assert.strictEqual(incidents.length, 0);

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
})();
