"use strict";

const assert = require("assert");
const path = require("path");

const TARGET_REL = "src/domains/classification/strategic-relevance-classifier.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

const {
  CLASSIFIER_VERSION,
  buildClassificationPrompt,
  normalizeClassificationResult,
  runConcurrent,
} = require(TARGET_PATH);

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${label}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${label}\n    ${err.message}\n`);
  }
}

// ─── CLASSIFIER_VERSION ───────────────────────────────────────────────────────

test("CLASSIFIER_VERSION: is a non-empty string", () => {
  assert.strictEqual(typeof CLASSIFIER_VERSION, "string");
  assert.ok(CLASSIFIER_VERSION.length > 0, "CLASSIFIER_VERSION must not be empty");
});

// ─── normalizeClassificationResult ───────────────────────────────────────────

test("normalizeClassificationResult: returns HIGH for valid HIGH input", () => {
  const result = normalizeClassificationResult({ classification: "HIGH", reason: "Strong geopolitical signal" });
  assert.strictEqual(result.classification, "HIGH");
});

test("normalizeClassificationResult: returns MEDIUM for valid MEDIUM input", () => {
  const result = normalizeClassificationResult({ classification: "MEDIUM", reason: "Some relevance" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult: returns LOW for valid LOW input", () => {
  const result = normalizeClassificationResult({ classification: "LOW", reason: "Not relevant" });
  assert.strictEqual(result.classification, "LOW");
});

test("normalizeClassificationResult: handles case-insensitive HIGH", () => {
  const result = normalizeClassificationResult({ classification: "high", reason: "reason" });
  assert.strictEqual(result.classification, "HIGH");
});

test("normalizeClassificationResult: handles case-insensitive medium", () => {
  const result = normalizeClassificationResult({ classification: "medium", reason: "reason" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult: handles case-insensitive low", () => {
  const result = normalizeClassificationResult({ classification: "Low", reason: "reason" });
  assert.strictEqual(result.classification, "LOW");
});

test("normalizeClassificationResult: unrecognized label defaults to MEDIUM", () => {
  const result = normalizeClassificationResult({ classification: "VERY_HIGH", reason: "reason" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult: null input returns fallback", () => {
  const result = normalizeClassificationResult(null);
  assert.strictEqual(result.classification, "MEDIUM");
  assert.ok(typeof result.reason === "string");
});

test("normalizeClassificationResult: non-object (string) returns fallback", () => {
  const result = normalizeClassificationResult("HIGH");
  assert.strictEqual(result.classification, "MEDIUM");
  assert.ok(typeof result.reason === "string");
});

test("normalizeClassificationResult: non-object (number) returns fallback", () => {
  const result = normalizeClassificationResult(42);
  assert.strictEqual(result.classification, "MEDIUM");
  assert.ok(typeof result.reason === "string");
});

test("normalizeClassificationResult: truncates reason to 15 words", () => {
  const longReason = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen";
  const result = normalizeClassificationResult({ classification: "HIGH", reason: longReason });
  const wordCount = result.reason.trim().split(/\s+/).length;
  assert.ok(wordCount <= 15, `reason must be truncated to 15 words, got ${wordCount}`);
});

test("normalizeClassificationResult: reason with exactly 15 words is not truncated further", () => {
  const fifteenWords = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
  const result = normalizeClassificationResult({ classification: "HIGH", reason: fifteenWords });
  const wordCount = result.reason.trim().split(/\s+/).length;
  assert.strictEqual(wordCount, 15);
});

test("normalizeClassificationResult: missing reason gets default", () => {
  const result = normalizeClassificationResult({ classification: "HIGH" });
  assert.strictEqual(typeof result.reason, "string");
  assert.ok(result.reason.length > 0, "should have a default reason");
});

test("normalizeClassificationResult: never throws on bad input", () => {
  assert.doesNotThrow(() => normalizeClassificationResult(undefined));
  assert.doesNotThrow(() => normalizeClassificationResult(null));
  assert.doesNotThrow(() => normalizeClassificationResult([]));
  assert.doesNotThrow(() => normalizeClassificationResult({}));
  assert.doesNotThrow(() => normalizeClassificationResult({ classification: null, reason: null }));
});

// ─── buildClassificationPrompt ───────────────────────────────────────────────

test("buildClassificationPrompt: returns object with system and user strings", () => {
  const candidate = {
    headline: "Fed raises rates by 75bps",
    snippet: "The Federal Reserve raised interest rates.",
    source_domain: "reuters.com",
    tag: "ECONOMY",
  };
  const prompt = buildClassificationPrompt(candidate);
  assert.strictEqual(typeof prompt, "object");
  assert.strictEqual(typeof prompt.system, "string");
  assert.strictEqual(typeof prompt.user, "string");
  assert.ok(prompt.system.length > 0, "system prompt must not be empty");
  assert.ok(prompt.user.length > 0, "user message must not be empty");
});

test("buildClassificationPrompt: system prompt includes HIGH label", () => {
  const prompt = buildClassificationPrompt({ headline: "Test" });
  assert.ok(prompt.system.includes("HIGH"), "system prompt must mention HIGH");
});

test("buildClassificationPrompt: system prompt includes MEDIUM label", () => {
  const prompt = buildClassificationPrompt({ headline: "Test" });
  assert.ok(prompt.system.includes("MEDIUM"), "system prompt must mention MEDIUM");
});

test("buildClassificationPrompt: system prompt includes LOW label", () => {
  const prompt = buildClassificationPrompt({ headline: "Test" });
  assert.ok(prompt.system.includes("LOW"), "system prompt must mention LOW");
});

test("buildClassificationPrompt: user message includes headline", () => {
  const candidate = { headline: "Central bank cuts rates dramatically" };
  const prompt = buildClassificationPrompt(candidate);
  assert.ok(prompt.user.includes("Central bank cuts rates dramatically"), "user message must include headline");
});

test("buildClassificationPrompt: user message includes source_domain", () => {
  const candidate = { headline: "Test", source_domain: "bloomberg.com" };
  const prompt = buildClassificationPrompt(candidate);
  assert.ok(prompt.user.includes("bloomberg.com"), "user message must include source_domain");
});

test("buildClassificationPrompt: user message includes topic/tag", () => {
  const candidate = { headline: "Test", tag: "FINANCE" };
  const prompt = buildClassificationPrompt(candidate);
  assert.ok(prompt.user.includes("FINANCE"), "user message must include topic/tag");
});

test("buildClassificationPrompt: missing snippet produces 'Not available'", () => {
  const candidate = { headline: "Test article", source_domain: "ft.com", tag: "FINANCE" };
  const prompt = buildClassificationPrompt(candidate);
  assert.ok(prompt.user.includes("Not available"), "missing snippet should be 'Not available'");
});

test("buildClassificationPrompt: handles all empty/missing fields gracefully", () => {
  assert.doesNotThrow(() => {
    const prompt = buildClassificationPrompt({});
    assert.strictEqual(typeof prompt.system, "string");
    assert.strictEqual(typeof prompt.user, "string");
  });
});

test("buildClassificationPrompt: empty headline falls back to default", () => {
  const prompt = buildClassificationPrompt({});
  // Should not throw and should produce non-empty user message
  assert.ok(prompt.user.length > 0);
});

// ─── runConcurrent ────────────────────────────────────────────────────────────

test("runConcurrent: processes all items", async () => {
  const items = [1, 2, 3, 4, 5];
  const results = [];
  await runConcurrent(items, async (item) => {
    results.push(item * 2);
  }, 3);
  assert.strictEqual(results.length, 5);
  const sorted = [...results].sort((a, b) => a - b);
  assert.deepStrictEqual(sorted, [2, 4, 6, 8, 10]);
});

test("runConcurrent: handles empty array without throwing", async () => {
  await assert.doesNotReject(async () => {
    await runConcurrent([], async () => {}, 4);
  });
});

test("runConcurrent: processes items with concurrency=1 in order", async () => {
  const items = [1, 2, 3];
  const results = [];
  await runConcurrent(items, async (item) => {
    results.push(item);
  }, 1);
  assert.deepStrictEqual(results, [1, 2, 3]);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\n[strategic-relevance-classifier] ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
