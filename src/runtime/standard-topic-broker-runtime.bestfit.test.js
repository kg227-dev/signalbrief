"use strict";
const assert = require("assert");
const { assignCanonicalTopic } = require("./standard-topic-broker-runtime");

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
console.log("All assignCanonicalTopic tests passed ✓");
