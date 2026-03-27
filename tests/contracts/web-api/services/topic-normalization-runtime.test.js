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

// custom topics are disabled unless explicitly allowed
assert.strictEqual(
  canonicalizeTopicKey("Quantum Computing", DEFAULT_TOPICS),
  "",
  "non-standard topic should be rejected when custom topics are disabled"
);

assert.strictEqual(
  canonicalizeTopicKey("custom_blockchain", DEFAULT_TOPICS),
  "",
  "already-prefixed custom topic should be rejected when custom topics are disabled"
);

assert.strictEqual(
  canonicalizeTopicKey("Quantum Computing", DEFAULT_TOPICS, { allowCustomTopics: true }),
  "",
  "non-standard topic should still fail closed in the reduced-scope MVP"
);

assert.strictEqual(
  canonicalizeTopicKey("AI/ML & Robotics!!!", DEFAULT_TOPICS, { allowCustomTopics: true }),
  "",
  "special-character inputs should not create custom topics"
);

{
  const longTopic = "a".repeat(100);
  const result = canonicalizeTopicKey(longTopic, DEFAULT_TOPICS, { allowCustomTopics: true });
  assert.strictEqual(result, "", `long non-standard topics should be rejected even with legacy flags (max slug ${MAX_CUSTOM_SLUG_LENGTH})`);
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

// too many topics
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "Cybersecurity", "Climate & Energy", "Energy Storage"],
    {
      defaultTopics: [...DEFAULT_TOPICS, "Energy Storage"],
      minRequired: 1,
      maxTopics: 3,
    }
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("no more than 3"));
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
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "customCount"), false);
}

// custom topics rejected in reduced-scope mode
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "custom1", "custom2", "custom3", "custom4"],
    { defaultTopics: DEFAULT_TOPICS, minRequired: 1, maxTopics: 8, maxCustomKeywords: 0 }
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("supported topic"), "reduced-scope MVP should reject custom topics");
}

// non-default topics fail closed even when legacy flags are present
{
  const result = normalizeTopicsForUserInput(
    ["AI & Machine Learning", "Quantum Computing", "Blockchain"],
    { defaultTopics: DEFAULT_TOPICS, minRequired: 1, maxCustomKeywords: 3 }
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("supported topic"));
}

process.stdout.write("[topic-normalization-runtime] all assertions passed\n");
