"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/topic-normalization-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { canonicalizeTopicKey, normalizeTopicsForUserInput, MAX_CUSTOM_SLUG_LENGTH } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const DEFAULT_TOPICS = ["AI & Machine Learning", "Cybersecurity", "Climate & Energy"];

// --------------- canonicalizeTopicKey ---------------

assert.strictEqual(canonicalizeTopicKey("", DEFAULT_TOPICS), "", "empty input returns empty");
assert.strictEqual(canonicalizeTopicKey(null, DEFAULT_TOPICS), "", "null input returns empty");

// standard topic matching (case-insensitive)
assert.strictEqual(
  canonicalizeTopicKey("ai & machine learning", DEFAULT_TOPICS),
  "AI & Machine Learning",
  "should match standard topic case-insensitively"
);

assert.strictEqual(
  canonicalizeTopicKey("CYBERSECURITY", DEFAULT_TOPICS),
  "Cybersecurity",
  "should match standard topic in all caps"
);

// custom topic slugification
assert.strictEqual(
  canonicalizeTopicKey("Quantum Computing", DEFAULT_TOPICS),
  "custom_quantum_computing",
  "non-standard topic should become custom slug"
);

assert.strictEqual(
  canonicalizeTopicKey("custom_blockchain", DEFAULT_TOPICS),
  "custom_blockchain",
  "already-prefixed custom topic should normalize cleanly"
);

// special characters stripped
assert.strictEqual(
  canonicalizeTopicKey("AI/ML & Robotics!!!", DEFAULT_TOPICS),
  "custom_ai_ml_robotics",
  "special chars should be stripped and replaced with underscores"
);

// slug length capped
{
  const longTopic = "a".repeat(100);
  const result = canonicalizeTopicKey(longTopic, DEFAULT_TOPICS);
  assert.ok(result.startsWith("custom_"), "long topic should get custom_ prefix");
  const slugPart = result.replace(/^custom_/, "");
  assert.ok(slugPart.length <= MAX_CUSTOM_SLUG_LENGTH, `slug should be capped at ${MAX_CUSTOM_SLUG_LENGTH} chars`);
}

// --------------- normalizeTopicsForUserInput ---------------

// not an array
{
  const result = normalizeTopicsForUserInput("not-array");
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("array"));
}

// empty string in array
{
  const result = normalizeTopicsForUserInput(["AI & Machine Learning", ""], { defaultTopics: DEFAULT_TOPICS });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("non-empty"));
}

// too few topics
{
  const result = normalizeTopicsForUserInput(["AI & Machine Learning"], {
    defaultTopics: DEFAULT_TOPICS,
    minRequired: 2,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("at least 2"));
}

// valid input with dedup
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "ai & machine learning", "Cybersecurity"],
    { defaultTopics: DEFAULT_TOPICS, minRequired: 2 }
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.topics.length, 2, "duplicate should be deduped");
  assert.deepStrictEqual(result.topics, ["AI & Machine Learning", "Cybersecurity"]);
  assert.strictEqual(result.customCount, 0);
}

// custom keyword limit
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "custom1", "custom2", "custom3", "custom4"],
    { defaultTopics: DEFAULT_TOPICS, minRequired: 1, maxCustomKeywords: 3 }
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("up to 3"), "should enforce custom keyword limit");
}

// valid with custom keywords within limit
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "Quantum Computing", "Blockchain"],
    { defaultTopics: DEFAULT_TOPICS, minRequired: 1, maxCustomKeywords: 3 }
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.topics.length, 3);
  assert.strictEqual(result.customCount, 2, "2 non-default topics should count as custom");
}

process.stdout.write("[topic-normalization-runtime] all assertions passed\n");
