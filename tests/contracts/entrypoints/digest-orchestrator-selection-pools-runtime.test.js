"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-selection-pools-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildTopicReserveQueue,
  getBackfillRejectionReason,
  resolveTrustedSelectionFloor,
  selectTopicItemsWithFallback,
  sortWithSourceTypePreference,
  suppressOfficialsByCluster,
} = runtime;

const nowMs = Date.parse("2026-03-27T12:00:00.000Z");

const reportedItem = {
  headline: "Reuters: Fed signals pause in rate cycle",
  storyline_key: "fed-rate-pause",
  source_type: "reported_media",
  _score: 0.82,
};
const officialItem = {
  headline: "Federal Reserve press release on monetary policy",
  storyline_key: "fed-rate-pause",
  source_type: "primary_official",
  _score: 0.88,
};
const unrelatedOfficial = {
  headline: "FDA approves new diabetes drug",
  storyline_key: "fda-diabetes",
  source_type: "primary_official",
  _score: 0.90,
};

{
  const suppressed = suppressOfficialsByCluster([reportedItem, officialItem, unrelatedOfficial]);
  const suppressedOfficialInCluster = suppressed.find((item) => item.headline === officialItem.headline);
  assert.strictEqual(suppressedOfficialInCluster?._official_suppressed_by_cluster, true);
  const unrelatedOfficialResult = suppressed.find((item) => item.headline === unrelatedOfficial.headline);
  assert.ok(!unrelatedOfficialResult?._official_suppressed_by_cluster);
}

{
  const officialHigh = { source_type: "primary_official", _score: 0.85, headline: "official high" };
  const reportedLow = { source_type: "reported_media", _score: 0.75, headline: "reported low" };
  const tradeMid = { source_type: "trade_specialist", _score: 0.80, headline: "trade mid" };
  const corporateLow = { source_type: "corporate_pr", _score: 0.70, headline: "corporate" };
  const sorted = sortWithSourceTypePreference([officialHigh, reportedLow, tradeMid, corporateLow]);
  assert.ok(sorted[0].source_type === "reported_media" || sorted[0].source_type === "trade_specialist");
  assert.strictEqual(sorted[sorted.length - 1].source_type, "corporate_pr");
  assert.ok(sorted.indexOf(officialHigh) > sorted.indexOf(reportedLow));
}

{
  assert.deepStrictEqual(resolveTrustedSelectionFloor({}, 5), {
    enabled: true,
    minTrustedItemsPerTopic: 4,
    activationStrongCandidateCount: 5,
  });
}

{
  const trustOpts = { backfillTrustFloor: true };
  assert.strictEqual(
    getBackfillRejectionReason({ source_tier: "unknown", source_type: "trade_specialist" }, [], trustOpts),
    "selection_low_trust_backfill"
  );
  assert.strictEqual(
    getBackfillRejectionReason({ source_tier: "standard", source_type: "corporate_pr" }, [], trustOpts),
    "selection_low_trust_backfill"
  );
  assert.strictEqual(
    getBackfillRejectionReason({ source_tier: "premium", source_type: "primary_official", source_domain: "fda.gov" }, [], trustOpts),
    null
  );
}

{
  const topicItems = [
    { url: "https://example.com/std1", headline: "Standard high score 1", published_date: "2026-03-27T11:55:00.000Z", source_domain: "std1.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "standard", _score: 0.99 },
    { url: "https://example.com/trusted1", headline: "Trusted lower score 1", published_date: "2026-03-27T09:00:00.000Z", source_domain: "trusted1.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", _score: 0.62 },
    { url: "https://example.com/trusted2", headline: "Trusted lower score 2", published_date: "2026-03-27T08:00:00.000Z", source_domain: "trusted2.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", _score: 0.61 },
    { url: "https://example.com/trusted3", headline: "Trusted lower score 3", published_date: "2026-03-27T07:00:00.000Z", source_domain: "trusted3.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "premium", _score: 0.60 },
    { url: "https://example.com/trusted4", headline: "Trusted lower score 4", published_date: "2026-03-27T06:00:00.000Z", source_domain: "trusted4.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", _score: 0.59 },
    { url: "https://example.com/commentary1/analysis", headline: "Commentary 1", published_date: "2026-03-27T05:00:00.000Z", source_domain: "commentary1.example.com", retrieval_origin: "discovery", source_type: "analysis_blog", originality_profile: "derived_synthesis", content_flags: ["generic_commentary"], source_tier: "standard", _score: 0.58 },
    { url: "https://example.com/commentary2/analysis", headline: "Commentary 2", published_date: "2026-03-27T04:00:00.000Z", source_domain: "commentary2.example.com", retrieval_origin: "discovery", source_type: "analysis_blog", originality_profile: "derived_synthesis", content_flags: ["generic_commentary"], source_tier: "standard", _score: 0.57 },
  ];

  const topicSelection = selectTopicItemsWithFallback({
    topicItems,
    itemsPerTopic: 7,
    maxItemsPerSourceDomain: 5,
    maxDiscoveryPerTopic: 1,
    nowMs,
    trustedSelectionFloor: {
      enabled: true,
      minTrustedItemsPerTopic: 4,
      activationStrongCandidateCount: 4,
    },
  });

  assert.strictEqual(topicSelection.selected.length, 6);
  assert.ok(topicSelection.trustedFloor.active);
  assert.ok(topicSelection.selected.filter((item) => String(item?.source_tier || "").toLowerCase() !== "standard").length >= 4);
  assert.strictEqual(
    topicSelection.rejectionReasonByItem.get(topicItems[6]),
    "selection_commentary_cap"
  );

  const reserve = buildTopicReserveQueue({
    pools: topicSelection.pools,
    selectedItems: topicSelection.selected,
  });
  assert.ok(Array.isArray(reserve.strongReserve));
  assert.ok(Array.isArray(reserve.standardReserve));
  assert.ok(reserve.allReserve.length >= reserve.strongReserve.length);
}

process.stdout.write("[digest-orchestrator-selection-pools-runtime] all assertions passed\n");
