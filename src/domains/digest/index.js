"use strict";

/**
 * @module src/domains/digest
 * Canonical digest domain aggregation surface for entrypoints and web runtime wiring.
 * Import this barrel for digest-domain functionality; the topic domain stays lazy-loaded here to avoid circular imports.
 */
const digestPipeline = require("../../digest/application/digest-pipeline-seam-runtime");
const digestPolicy = require("../../digest/domain/digest-policy-domain-runtime");
const repeatDedup = require("../../digest/domain/repeat-dedup-domain-runtime");
const repeatHistory = require("../../digest/domain/repeat-history-domain-runtime");
const selection = require("../../digest/domain/selection-domain-runtime");
const source = require("../../digest/domain/source-domain-runtime");
const storyline = require("../../digest/domain/storyline-domain-runtime");
const formatting = require("../../digest/runtime/digest-formatting-runtime");
const dataRuntime = require("../../digest/runtime/digest-data-runtime");
const archiveRuntime = require("../../digest/runtime/digest-archive-runtime");
const deliveryRecordRuntime = require("../../digest/runtime/digest-delivery-record-runtime");
const quality = require("../../runtime/quality-score");
const topicNormalization = require("../../runtime/topic-normalization-runtime");
const depthRuntime = require("../../runtime/digest-depth-runtime");

function loadTopicDomain() {
  return require("../../digest/domain/topic-domain-runtime");
}

const digest = {
  ...digestPipeline,
  ...digestPolicy,
  ...repeatDedup,
  ...repeatHistory,
  ...selection,
  ...source,
  ...storyline,
  ...formatting,
  ...dataRuntime,
  ...archiveRuntime,
  ...deliveryRecordRuntime,
  ...quality,
  ...topicNormalization,
  ...depthRuntime,
  digestPipeline,
  digestPolicy,
  repeatDedup,
  repeatHistory,
  selection,
  source,
  storyline,
  formatting,
  dataRuntime,
  archiveRuntime,
  deliveryRecordRuntime,
  quality,
};

Object.defineProperty(digest, "topic", {
  enumerable: true,
  get: () => loadTopicDomain(),
});

for (const exportName of [
  "CUSTOM_KEYWORD_ALIASES",
  "CUSTOM_TOPIC_ALIASES",
  "CUSTOM_TOPIC_METADATA",
  "RELATED_TOPIC_GROUPS",
  "buildCustomTopicQueries",
  "computeTopicMatch",
  "computeTopicSignals",
  "customKeywordMatches",
  "filterItemsByTopics",
  "getCustomTopicMetadata",
  "reserveCustomKeywordSlot",
  "applyTopicRelevanceScores",
  "matchWeightToTag",
  "normalizeCustomKeyword",
  "splitUserTopics",
  "itemMatchesPersonaTopic",
]) {
  Object.defineProperty(digest, exportName, {
    enumerable: true,
    get: () => loadTopicDomain()[exportName],
  });
}

module.exports = digest;
