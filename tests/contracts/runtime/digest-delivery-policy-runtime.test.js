"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/digest-delivery-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const TOPIC_DOMAIN_PATH = require.resolve(path.join(process.cwd(), "src/digest/domain/topic-domain-runtime.js"));
const STORYLINE_DOMAIN_PATH = require.resolve(path.join(process.cwd(), "src/digest/domain/storyline-domain-runtime.js"));
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, TOPIC_DOMAIN_PATH),
  false,
  "active delivery policy import should not eagerly load legacy topic-domain runtime"
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, STORYLINE_DOMAIN_PATH),
  false,
  "active delivery policy import should not eagerly load storyline-domain runtime"
);

const {
  DELIVERY_POLICY,
  classifyDeliveryConfidence,
  countRecentLowerConfidenceAssist,
  selectDeliveryItems,
} = runtime;

function buildItem(overrides = {}) {
  return {
    tag: "STRATEGY",
    headline: "Trusted item",
    summary: "Strong fit.",
    published_date: "2026-03-22T10:00:00.000Z",
    topicMatch: 9,
    relevanceScore: 7.4,
    strategic_value: 0.8,
    routine_item_score: 0.1,
    source_policy: "preferred",
    source_type: "reported_media",
    source_authority: 0.9,
    why_shown: ["topic_match"],
    ...overrides,
  };
}

(() => {
  const nowIso = "2026-03-22T12:00:00.000Z";
  const high = buildItem();
  const lower = buildItem({
    headline: "Lower confidence item",
    source_policy: "limited",
    source_authority: 0.5,
  });
  const classifiedHigh = classifyDeliveryConfidence(high, { nowIso, customKeywords: [] });
  const classifiedLower = classifyDeliveryConfidence(lower, { nowIso, customKeywords: [] });
  assert.strictEqual(classifiedHigh.high_confidence, true);
  assert.strictEqual(classifiedLower.high_confidence, false);
  assert.strictEqual(classifiedLower.lower_confidence_eligible, true);
})();

(() => {
  const nowIso = "2026-03-22T12:00:00.000Z";
  const items = [
    buildItem({ headline: "A" }),
    buildItem({ headline: "B" }),
    buildItem({ headline: "C" }),
    buildItem({ headline: "D" }),
    buildItem({ headline: "E", source_policy: "limited", source_authority: 0.5 }),
  ];
  const firstPass = selectDeliveryItems(items, {
    attemptCount: 1,
    nowIso,
    customKeywords: [],
    lowerConfidenceAssistCount: 0,
  });
  assert.strictEqual(firstPass.delivery_eligible, true);
  assert.strictEqual(firstPass.high_confidence_count, 4);
  assert.strictEqual(firstPass.lower_confidence_count, 1);
})();

(() => {
  const nowIso = "2026-03-22T12:00:00.000Z";
  const items = [
    buildItem({ headline: "A" }),
    buildItem({ headline: "B" }),
    buildItem({ headline: "C" }),
    buildItem({ headline: "D", source_policy: "limited", source_authority: 0.5 }),
    buildItem({ headline: "E", source_policy: "limited", source_authority: 0.5 }),
  ];
  const firstPass = selectDeliveryItems(items, {
    attemptCount: 1,
    nowIso,
    customKeywords: [],
    lowerConfidenceAssistCount: 0,
  });
  const retryPass = selectDeliveryItems(items, {
    attemptCount: 2,
    nowIso,
    customKeywords: [],
    lowerConfidenceAssistCount: 0,
  });
  assert.strictEqual(firstPass.delivery_eligible, false);
  assert.strictEqual(retryPass.delivery_eligible, true);
  assert.strictEqual(retryPass.high_confidence_count, 3);
  assert.strictEqual(retryPass.lower_confidence_count, 2);
})();

(() => {
  const nowIso = "2026-03-22T12:00:00.000Z";
  const items = [
    buildItem({ headline: "A", why_shown: ["custom_keyword"] }),
    buildItem({ headline: "B", why_shown: ["custom_keyword"] }),
    buildItem({ headline: "C", why_shown: ["custom_keyword"] }),
    buildItem({ headline: "D", why_shown: ["custom_keyword"] }),
    buildItem({
      headline: "E",
      why_shown: ["custom_keyword"],
      source_policy: "limited",
      source_authority: 0.5,
    }),
  ];
  const strict = selectDeliveryItems(items, {
    attemptCount: 1,
    nowIso,
    customKeywords: ["rate cuts"],
    lowerConfidenceAssistCount: 0,
  });
  assert.strictEqual(strict.delivery_eligible, false);
  assert.strictEqual(strict.lower_confidence_available_count, 0, "trusted-only topics must not allow lower-confidence backfill");
})();

(() => {
  const count = countRecentLowerConfidenceAssist([
    { delivery_outcome: "delivered_with_lower_confidence", sent_at: "2026-03-21T12:00:00.000Z" },
    { delivery_outcome: "delivered_full_confidence", sent_at: "2026-03-20T12:00:00.000Z" },
    { delivery_outcome: "delivered_with_lower_confidence", sent_at: "2026-03-10T12:00:00.000Z" },
  ], "2026-03-22T12:00:00.000Z");
  assert.strictEqual(count, 1);
  assert.strictEqual(DELIVERY_POLICY.target_item_count, 5);
})();

process.stdout.write("[digest-delivery-policy-runtime] all assertions passed\n");
