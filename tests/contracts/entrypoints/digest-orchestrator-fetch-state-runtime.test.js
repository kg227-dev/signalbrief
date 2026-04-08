"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-state-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  DEFAULT_RETENTION_HOURS_FOR_INVENTORY,
  buildStateCandidateInventory,
  buildTopicState,
  buildTrustedFamilyQueue,
  mergeUniqueItemsIntoState,
  mergeBrokerItemsIntoState,
  preloadBrokerInventoryIntoStates,
  persistBrokerInventory,
} = runtime;

assert.strictEqual(DEFAULT_RETENTION_HOURS_FOR_INVENTORY, 72);

{
  const queue = buildTrustedFamilyQueue(
    { official_friendly: true },
    {
      official_domains: ["fda.gov", "reuters.com"],
      reported_domains: ["wsj.com", "fda.gov"],
    }
  );
  assert.deepStrictEqual(queue, [
    { name: "official", domains: ["fda.gov", "reuters.com"], official_friendly: true },
    { name: "reported", domains: ["wsj.com"], official_friendly: false },
  ]);
}

{
  const state = buildTopicState(
    { tag: "TECHNOLOGY" },
    { domains: ["reuters.com"], topic_keys: ["technology"], official_friendly: false },
    {
      reported_domains: ["wsj.com"],
      official_domains: ["fda.gov"],
      global_reported_domains: ["wsj.com"],
      global_official_domains: ["fda.gov"],
    },
    2,
    7
  );
  assert.strictEqual(state.topic.tag, "TECHNOLOGY");
  assert.strictEqual(state.priority, 2);
  assert.strictEqual(state.originalIndex, 7);
  assert.deepStrictEqual(state.trustedFamilyQueue, [
    { name: "reported", domains: ["wsj.com"], official_friendly: false },
    { name: "official", domains: ["fda.gov"], official_friendly: true },
  ]);
  assert.strictEqual(state.conversionFunnel != null, true);
}

{
  const state = buildTopicState({ tag: "TECHNOLOGY" }, {}, {}, 0, 0);
  const merged = mergeUniqueItemsIntoState(
    state,
    [
      { url: "https://example.com/a", headline: "Alpha", source_domain: "example.com" },
      { url: "https://example.com/a", headline: "Alpha duplicate", source_domain: "example.com" },
      { headline: "Headline only", source_domain: "example.com" },
      { headline: "Headline only", source_domain: "example.com" },
    ],
    (url) => String(url || "").toLowerCase(),
    () => true
  );
  assert.strictEqual(merged.addedUniqueCount, 2);
  assert.strictEqual(merged.addedUsableCount, 2);
  assert.strictEqual(state.items.length, 2);
}

{
  const state = buildTopicState(
    { tag: "HEALTHCARE" },
    {},
    {
      official_domains: ["fda.gov"],
      reported_domains: ["wsj.com"],
      global_official_domains: ["fda.gov"],
      global_reported_domains: ["wsj.com"],
    },
    0,
    0
  );
  const merged = mergeBrokerItemsIntoState(
    state,
    [
      {
        url: "https://www.fda.gov/news/1",
        headline: "FDA approves treatment",
        source_domain: "fda.gov",
        broker_source_id: "fda",
        retrieval_origin: "broker_official",
        source_type: "primary_official",
      },
      {
        url: "https://www.wsj.com/articles/2",
        headline: "WSJ covers policy",
        source_domain: "wsj.com",
        broker_source_id: "wsj",
        retrieval_origin: "",
        source_type: "reported_media",
      },
    ],
    (url) => String(url || "").toLowerCase(),
    () => true,
    (items) => items
  );
  assert.strictEqual(merged.addedUniqueCount, 2);
  assert.strictEqual(state.brokerItemCount, 2);
  assert.strictEqual(state.brokerOfficialItemCount, 1);
  assert.strictEqual(state.brokerPublisherFeedItemCount, 1);
  assert.strictEqual(state.retrievalOriginCounts.broker_official, 1);
  assert.strictEqual(state.retrievalOriginCounts.broker_publisher_feed, 1);
  assert.strictEqual(state.retrievalSourceFamilyCounts.official, 1);
  assert.strictEqual(state.retrievalSourceFamilyCounts.reported, 1);
  assert.deepStrictEqual(state.brokerSourceIds, ["fda", "wsj"]);
}

{
  const stateA = buildTopicState({ tag: "TECHNOLOGY" }, {}, {}, 0, 0);
  const stateB = buildTopicState({ tag: "ENERGY" }, {}, {}, 0, 1);
  const loaded = preloadBrokerInventoryIntoStates(
    [stateA, stateB],
    {
      loadRecentTopicItems(tag) {
        return tag === "TECHNOLOGY"
          ? [{ url: "https://example.com/a", headline: "Alpha", source_domain: "example.com", broker_source_id: "tech", retrieval_origin: "broker_official" }]
          : [];
      },
      persistBrokerTopicItems() {
        throw new Error("unexpected persist call");
      },
    },
    {
      normalizeUrlForDedup: (url) => String(url || "").toLowerCase(),
      isFetchedItemEligible: () => true,
      annotateFetchedItems: (items) => items,
      nowMs: 1700000000000,
      maxAgeHours: 48,
    }
  );
  assert.strictEqual(loaded, 1);
  assert.strictEqual(stateA.items.length, 1);
  assert.strictEqual(stateB.items.length, 0);
}

{
  let captured = null;
  const result = persistBrokerInventory(
    {
      persistBrokerTopicItems(topicItems, opts) {
        captured = { topicItems, opts };
        return "ok";
      },
    },
    { TECHNOLOGY: [{ id: 1 }] },
    {
      nowMs: 1700000000000,
      maxAgeHours: 10,
    }
  );
  assert.strictEqual(result, "ok");
  assert.deepStrictEqual(captured.topicItems, { TECHNOLOGY: [{ id: 1 }] });
  assert.strictEqual(captured.opts.nowMs, 1700000000000);
  assert.strictEqual(captured.opts.retentionHours, DEFAULT_RETENTION_HOURS_FOR_INVENTORY);
}

{
  const inventory = buildStateCandidateInventory({
    items: [
      {
        retrieval_origin: "broker_official",
        retrieval_source_family: "official",
        broker_source_id: "fda",
      },
      {
        retrieval_origin: "broker_publisher_feed",
        retrieval_source_family: "reported",
        broker_source_id: "wsj",
      },
      {
        retrieval_origin: "preferred",
        retrieval_source_family: "specialist",
      },
    ],
  });
  assert.strictEqual(inventory.brokerItemCount, 2);
  assert.strictEqual(inventory.discoveryItemCount, 1);
  assert.deepStrictEqual(inventory.brokerSourceIds, ["fda", "wsj"]);
}

process.stdout.write("[digest-orchestrator-fetch-state-runtime] all assertions passed\n");
