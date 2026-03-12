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
    fetchTopicNews: async (topic) => {
      fetchCalls.push(topic);
      if (topic.isCustom) {
        return { apiCalls: 2, items: [{ headline: "custom", tag: topic.tag }] };
      }
      return { apiCalls: 1, items: [{ headline: "standard", tag: topic.tag }] };
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
  assert.strictEqual(fetched.standardFetchCallsPlanned, 1);
  assert.strictEqual(fetched.standardFetchCalls, 1);
  assert.strictEqual(fetched.customFetchCalls, 2);
  assert.deepStrictEqual(
    fetchCalls.map((topic) => topic.tag),
    ["AI×TECH", "GLP 1"]
  );
  assert.strictEqual(fetched.tagPriority["ai×tech"], 1);
  assert.strictEqual(fetched.tagPriority.custom_glp_1, 1);
  assert.strictEqual(Array.isArray(fetched.allItems), true);
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
})();
