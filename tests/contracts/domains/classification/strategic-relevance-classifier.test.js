"use strict";

const assert = require("assert");
const path = require("path");

const TARGET_REL = "src/domains/classification/strategic-relevance-classifier.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

const {
  CLASSIFIER_VERSION,
  buildClassificationPrompt,
  normalizeClassificationResult,
  classifySingle,
  classifyCandidates,
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

test("CLASSIFIER_VERSION: is 1.0", () => {
  assert.strictEqual(CLASSIFIER_VERSION, "1.0");
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

// ─── classifySingle + classifyCandidates (async) ─────────────────────────────

(async () => {
  async function asyncTest(label, fn) {
    try {
      await fn();
      passed++;
      process.stdout.write(`  PASS  ${label}\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`  FAIL  ${label}\n    ${err.message}\n`);
    }
  }

  const candidate = { headline: "Fed raises rates", snippet: "Details.", source_domain: "reuters.com", tag: "ECONOMY" };

  // no_api_key: call with no apiKey
  await asyncTest("classifySingle: no apiKey → _fallback_type no_api_key", async () => {
    const result = await classifySingle(candidate, { httpsPost: async () => {} });
    assert.strictEqual(result.classification, "MEDIUM");
    assert.strictEqual(result._fallback_type, "no_api_key");
  });

  // network_error: httpsPost throws
  await asyncTest("classifySingle: httpsPost throws → _fallback_type network_error", async () => {
    const result = await classifySingle(candidate, {
      apiKey: "test-key",
      httpsPost: async () => { throw new Error("connection refused"); },
    });
    assert.strictEqual(result._fallback_type, "network_error");
  });

  // network_error: HTTP 500
  await asyncTest("classifySingle: HTTP 500 → _fallback_type network_error", async () => {
    const result = await classifySingle(candidate, {
      apiKey: "test-key",
      httpsPost: async () => ({ status: 500, body: {} }),
    });
    assert.strictEqual(result._fallback_type, "network_error");
  });

  // empty_response: status 200, body.content = []
  await asyncTest("classifySingle: empty content array → _fallback_type empty_response", async () => {
    const result = await classifySingle(candidate, {
      apiKey: "test-key",
      httpsPost: async () => ({ status: 200, body: { content: [] } }),
    });
    assert.strictEqual(result._fallback_type, "empty_response");
  });

  // parse_failure: non-JSON text
  await asyncTest("classifySingle: non-JSON text → _fallback_type parse_failure", async () => {
    const result = await classifySingle(candidate, {
      apiKey: "test-key",
      httpsPost: async () => ({ status: 200, body: { content: [{ text: "not json" }] } }),
    });
    assert.strictEqual(result._fallback_type, "parse_failure");
  });

  // success: valid JSON response
  await asyncTest("classifySingle: valid response → classification HIGH, no _fallback_type", async () => {
    const result = await classifySingle(candidate, {
      apiKey: "test-key",
      httpsPost: async () => ({
        status: 200,
        body: { content: [{ text: JSON.stringify({ classification: "HIGH", reason: "Major central bank decision" }) }] },
      }),
    });
    assert.strictEqual(result.classification, "HIGH");
    assert.strictEqual(result._fallback_type, undefined);
  });

  // classifyCandidates: cache hit + model calls
  await asyncTest("classifyCandidates: cache_hits=1, model_calls=2, all candidates annotated", async () => {
    const cache = new Map();
    // Pre-populate cache for candidate 1
    const { writeEntry } = require(path.join(process.cwd(), "src/domains/classification/strategic-relevance-cache.js"));
    writeEntry(cache, "https://example.com/article1", "1.0",
      { classification: "HIGH", reason: "Cached result" },
      { source: "example.com", topic: "ECONOMY" },
      null
    );

    const candidates = [
      { url: "https://example.com/article1", headline: "Cached article", snippet: "S", source_domain: "example.com", tag: "ECONOMY" },
      { url: "https://example.com/article2", headline: "Fresh article A", snippet: "S", source_domain: "example.com", tag: "TECH" },
      { url: "https://example.com/article3", headline: "Fresh article B", snippet: "S", source_domain: "example.com", tag: "MACRO" },
    ];

    let callCount = 0;
    const mockHttpsPost = async () => {
      callCount++;
      return {
        status: 200,
        body: { content: [{ text: JSON.stringify({ classification: "MEDIUM", reason: "Moderate relevance" }) }] },
      };
    };

    const { candidates: out, diagnostics } = await classifyCandidates(candidates, {
      cache,
      config: { apiKey: "test-key" },
      httpsPost: mockHttpsPost,
    });

    assert.strictEqual(diagnostics.cache_hits, 1, "expected 1 cache hit");
    assert.strictEqual(diagnostics.model_calls, 2, "expected 2 model calls");
    assert.strictEqual(out.length, 3, "should return all 3 candidates");
    for (const c of out) {
      assert.ok(c.strategic_relevance, `candidate missing strategic_relevance: ${c.url}`);
      assert.ok(c.strategic_relevance_reason, `candidate missing strategic_relevance_reason: ${c.url}`);
      assert.ok(c.strategic_relevance_source, `candidate missing strategic_relevance_source: ${c.url}`);
      assert.strictEqual(c.strategic_relevance_version, "1.0");
      assert.strictEqual(c.strategic_relevance_applied, true);
    }
    // diagnostics shape
    assert.ok(typeof diagnostics.total_classified === "number");
    assert.ok(typeof diagnostics.fallbacks === "number");
    assert.ok(typeof diagnostics.errors === "number");
    assert.ok(typeof diagnostics.high === "number");
    assert.ok(typeof diagnostics.medium === "number");
    assert.ok(typeof diagnostics.low === "number");
    assert.ok(typeof diagnostics.elapsed_ms === "number");
    assert.strictEqual(diagnostics.classifier_version, "1.0");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────────

  process.stdout.write(`\n[strategic-relevance-classifier] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})().catch((err) => {
  process.stderr.write(`Uncaught async error: ${err.message}\n`);
  process.exitCode = 1;
});
