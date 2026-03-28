"use strict";

const assert = require("assert");
const {
  DELIVERY_POLICY,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  deriveInternalThinnessLabel,
  isRetryEligibleFailureClass,
  selectTopicBuckets,
} = require("./digest-mvp-delivery-runtime");

assert.strictEqual(DELIVERY_POLICY.target_item_count, 5, "MVP delivery contract stays fixed at 5");
assert.strictEqual(isRetryEligibleFailureClass("transient"), true, "transient failures stay retry-eligible");
assert.strictEqual(isRetryEligibleFailureClass("retrieval_thin"), false, "thin retrieval is not retry-eligible");
assert.strictEqual(computeRetryDelayMinutes("transient", 30), 10, "transient retries stay short");
assert.strictEqual(classifyRetryFailureClass({ diagnostics: { provider_429_count: 1 } }), "transient", "provider limits stay transient");
assert.strictEqual(classifyRetryFailureClass({ availableCandidateCount: 0, diagnostics: {} }), "retrieval_thin", "zero candidates classify as retrieval thin");
assert.strictEqual(deriveInternalThinnessLabel({ availableCandidateCount: 3, highConfidenceAvailableCount: 3 }), "healthy_thin_internal", "healthy thinness preserved");
assert.strictEqual(deriveInternalThinnessLabel({ availableCandidateCount: 1, highConfidenceAvailableCount: 0 }), "product_underdelivery", "underdelivery still flagged");

const buckets = selectTopicBuckets([
  { tag: "TECHNOLOGY", relevanceScore: 8, url: "a" },
  { tag: "TECHNOLOGY", relevanceScore: 7, url: "b" },
  { tag: "HEALTHCARE", relevanceScore: 9, url: "c" },
], ["TECHNOLOGY", "HEALTHCARE"], 5);
assert.strictEqual(buckets.TECHNOLOGY.length, 2, "technology bucket keeps tagged items");
assert.strictEqual(buckets.HEALTHCARE.length, 1, "healthcare bucket keeps tagged items");

console.log("digest-mvp-delivery-runtime ✓");
