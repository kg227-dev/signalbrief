"use strict";
const assert = require("assert");
const {
  assignCanonicalTopic,
  chooseBestFitTopicTag,
  scoreBestFitTopicTag,
} = require("./standard-topic-broker-topic-fit-runtime");

{
  assert.strictEqual(assignCanonicalTopic(["TECHNOLOGY"]), "TECHNOLOGY", "single tag");
  console.log("✓ assignCanonicalTopic single tag");
}
{
  assert.strictEqual(assignCanonicalTopic(["HEALTHCARE", "LIFE SCIENCES"]), "HEALTHCARE", "multi → first");
  console.log("✓ assignCanonicalTopic multi tag → first");
}
{
  assert.strictEqual(assignCanonicalTopic([]), null, "empty → null");
  console.log("✓ assignCanonicalTopic empty → null");
}
{
  assert.strictEqual(assignCanonicalTopic(null), null, "null → null");
  console.log("✓ assignCanonicalTopic null → null");
}
{
  const text = "Hospital payer reimbursement care delivery";
  assert.ok(scoreBestFitTopicTag("HEALTHCARE", text) > scoreBestFitTopicTag("TECHNOLOGY", text));
  assert.strictEqual(chooseBestFitTopicTag(["HEALTHCARE", "TECHNOLOGY"], { headline: text }), "HEALTHCARE");
  console.log("✓ chooseBestFitTopicTag prefers stronger match");
}
console.log("All assignCanonicalTopic tests passed ✓");
