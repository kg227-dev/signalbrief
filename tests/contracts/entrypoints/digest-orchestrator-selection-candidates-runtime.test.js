"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-selection-candidates-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  canonicalizeCandidateTopicTags,
  classifySourceTypeClass,
  prepareSelectionCandidates,
  toSelectionAuditCandidate,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  assert.strictEqual(classifySourceTypeClass("reported_media"), "reported");
  assert.strictEqual(classifySourceTypeClass("primary_official"), "official");
  assert.strictEqual(classifySourceTypeClass("corporate_pr"), "corporate");
  assert.strictEqual(classifySourceTypeClass("analysis_blog"), "commentary");
  assert.strictEqual(classifySourceTypeClass("aggregator_republisher"), "aggregator");
  assert.strictEqual(classifySourceTypeClass(""), "unclassified");

  const original = {
    tag: "TECHNOLOGY",
    headline: "Hospital software merger expands provider network",
    url: "https://topic-fit.example.com/1",
  };
  const reassigned = canonicalizeCandidateTopicTags([original], {
    configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
    assignCanonicalTopic: () => "HEALTHCARE",
    scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 10 : 2),
  });
  assert.strictEqual(reassigned.bestFitTopicReassignedCount, 1);
  assert.strictEqual(reassigned.items[0].tag, "HEALTHCARE");
  assert.strictEqual(reassigned.items[0].original_tag, "TECHNOLOGY");

  const scopeBlocked = canonicalizeCandidateTopicTags([{
    tag: "TECHNOLOGY",
    headline: "STAT on AI payments rollout",
    url: "https://scope.example.com/1",
    source_domain: "statnews.com",
  }], {
    configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }, { tag: "FINANCIAL SERVICES" }],
    assignCanonicalTopic: () => "FINANCIAL SERVICES",
    scoreBestFitTopicTag: (tag) => (tag === "FINANCIAL SERVICES" ? 9 : 1),
  });
  assert.strictEqual(scopeBlocked.bestFitTopicReassignedCount, 0);
  assert.strictEqual(scopeBlocked.items[0].tag, "TECHNOLOGY");

  const prepared = prepareSelectionCandidates([
    {
      tag: "TECHNOLOGY",
      headline: "AI startup signs hospital deal",
      url: "https://story.example.com/1",
    },
    {
      tag: "TECHNOLOGY",
      headline: "AI startup signs hospital deal update",
      url: "https://story.example.com/1?dup=1",
    },
  ], {
    configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
    buildStorylineCandidates: (items) => [items[0]],
    annotateEditorialSignals: (items) => items.map((item, index) => ({
      ...item,
      storyline_key: `story-${index + 1}`,
      entity_keys: ["hospital"],
    })),
    assignCanonicalTopic: () => "HEALTHCARE",
    scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 8 : 1),
  });
  assert.strictEqual(prepared.items.length, 1);
  assert.strictEqual(prepared.storylineClusterRemovedCount, 1);
  assert.strictEqual(prepared.bestFitTopicReassignedCount, 1);
  assert.strictEqual(prepared.items[0].tag, "HEALTHCARE");
  assert.strictEqual(prepared.items[0].storyline_key, "story-1");

  const audited = toSelectionAuditCandidate({
    tag: "healthcare",
    headline: "Hospital earnings beat",
    url: "https://audit.example.com/1",
    source_domain: "audit.example.com",
    source_type: "analysis_blog",
    source_authority: "91",
    retrieval_origin: "broker",
    _score: 7.25,
    content_flags: ["commercial_partnership"],
    strategic_relevance_reason: "Long reason that still needs truncation but should stay intact for audit output",
  }, {
    freshness_hours: 3.14159,
    selected: true,
  });
  assert.strictEqual(audited.tag, "HEALTHCARE");
  assert.strictEqual(audited.source_type_class, "commentary");
  assert.strictEqual(audited.source_authority, 91);
  assert.strictEqual(audited.lane, "broker");
  assert.strictEqual(audited.freshness_hours, 3.14159);
  assert.strictEqual(audited.selected, true);
  assert.deepStrictEqual(audited.content_flags, ["commercial_partnership"]);
})();
