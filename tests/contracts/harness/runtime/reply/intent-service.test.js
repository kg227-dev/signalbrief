"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/intent-service.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const service = require(TARGET_PATH);
assertModuleExports(() => service, TARGET_REL);

const { normalizeIntentPayload, normalizeIntentItems, parseCommandIntent, buildIntentPrompt } = service;

// ── helpers ───────────────────────────────────────────────────────────────────

function base(overrides = {}) {
  return { action: "unknown", items: [], topic: null, source: null, question: null, email: null, code: null, ...overrides };
}

// ── normalizeIntentItems ──────────────────────────────────────────────────────

assert.deepStrictEqual(normalizeIntentItems([1, 2, 3]), [1, 2, 3], "array of numbers");
assert.deepStrictEqual(normalizeIntentItems("1,2,3"), [1, 2, 3], "comma-separated string");
assert.deepStrictEqual(normalizeIntentItems("1 4 6"), [1, 4, 6], "space-separated string");
assert.deepStrictEqual(normalizeIntentItems(5), [5], "single number scalar");
assert.deepStrictEqual(normalizeIntentItems(null), [], "null → empty");
assert.deepStrictEqual(normalizeIntentItems([]), [], "empty array");
assert.deepStrictEqual(normalizeIntentItems([1, 1, 2]), [1, 2], "deduplicates");
assert.deepStrictEqual(normalizeIntentItems([0, -1, 51]), [], "out-of-range values rejected");
assert.deepStrictEqual(normalizeIntentItems([1, 50]), [1, 50], "boundary values accepted");

// ── normalizeIntentPayload — save ─────────────────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "save", items: [3] }),
  base({ action: "save", items: [3] }),
  "save with items"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "save", items: "1,4,6" }),
  base({ action: "save", items: [1, 4, 6] }),
  "save with string items"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "save", items: [] }),
  base({ action: "save", items: [] }),
  "save with empty items still valid"
);

// ── normalizeIntentPayload — topic_more / topic_less / topic_add ──────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "topic_more", topic: "AI" }),
  base({ action: "topic_more", topic: "AI" }),
  "topic_more with valid topic"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "topic_less", topic: "  healthcare  " }),
  base({ action: "topic_less", topic: "healthcare" }),
  "topic_less trims whitespace"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "topic_add", topic: "GLP-1" }),
  base({ action: "topic_add", topic: "GLP-1" }),
  "topic_add with hyphenated topic"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "topic_more", topic: null }),
  base({ action: "unknown" }),
  "topic_more with null topic → unknown"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "topic_less", topic: "" }),
  base({ action: "unknown" }),
  "topic_less with empty topic → unknown"
);

// ── normalizeIntentPayload — source_block ─────────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: "benzinga.com" }),
  base({ action: "source_block", source: "benzinga.com" }),
  "source_block with bare domain"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: "https://www.reuters.com/article/x" }),
  base({ action: "source_block", source: "reuters.com" }),
  "source_block strips protocol + www + path"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: "www.wsj.com/news/article" }),
  base({ action: "source_block", source: "wsj.com" }),
  "source_block strips www + path"
);
// item-number passthrough: "3" is a valid numeric source reference
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: "3" }),
  base({ action: "source_block", source: "3" }),
  "source_block with numeric item reference passes through as-is"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: null }),
  base({ action: "unknown" }),
  "source_block with null source → unknown"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", source: "" }),
  base({ action: "unknown" }),
  "source_block with empty source → unknown"
);
// domain field fallback
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_block", domain: "benzinga.com" }),
  base({ action: "source_block", source: "benzinga.com" }),
  "source_block reads domain field if source absent"
);

// ── normalizeIntentPayload — source_trust ─────────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_trust", source: "wsj.com" }),
  base({ action: "source_trust", source: "wsj.com" }),
  "source_trust with bare domain"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_trust", source: "2" }),
  base({ action: "source_trust", source: "2" }),
  "source_trust with numeric item reference passes through"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_trust", source: null }),
  base({ action: "unknown" }),
  "source_trust with null source → unknown"
);

// ── normalizeIntentPayload — source_unblock ───────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_unblock", source: "benzinga.com" }),
  base({ action: "source_unblock", source: "benzinga.com" }),
  "source_unblock with bare domain"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_unblock", source: "4" }),
  base({ action: "source_unblock", source: "4" }),
  "source_unblock with numeric item reference passes through"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "source_unblock", source: "" }),
  base({ action: "unknown" }),
  "source_unblock with empty source → unknown"
);

// ── normalizeIntentPayload — question ─────────────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "question", question: "what does 340B mean?" }),
  base({ action: "question", question: "what does 340B mean?" }),
  "question with text"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "question", question: null }, { fallbackQuestion: "fallback text" }),
  base({ action: "question", question: "fallback text" }),
  "question falls back to opts.fallbackQuestion"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "question", question: null }),
  base({ action: "unknown" }),
  "question with null and no fallback → unknown"
);

// ── normalizeIntentPayload — start / verify_link ──────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "start", email: "user@example.com" }),
  base({ action: "start", email: "user@example.com" }),
  "start with email"
);
assert.deepStrictEqual(
  normalizeIntentPayload({ action: "verify_link", code: "ABC123" }),
  base({ action: "verify_link", code: "ABC123" }),
  "verify_link with code"
);

// ── normalizeIntentPayload — passthrough actions ──────────────────────────────

for (const action of ["settings", "bookmarks", "topics", "help"]) {
  assert.deepStrictEqual(
    normalizeIntentPayload({ action }),
    base({ action }),
    `${action} passes through unchanged`
  );
}

// ── normalizeIntentPayload — unknown / invalid ────────────────────────────────

assert.deepStrictEqual(
  normalizeIntentPayload({ action: "bogus_action" }),
  base({ action: "unknown" }),
  "unrecognized action → unknown"
);
assert.deepStrictEqual(
  normalizeIntentPayload(null),
  base({ action: "unknown" }),
  "null payload → unknown"
);
assert.deepStrictEqual(
  normalizeIntentPayload({}),
  base({ action: "unknown" }),
  "empty payload → unknown"
);

// ── parseCommandIntent — slash commands ───────────────────────────────────────

assert.deepStrictEqual(
  parseCommandIntent("/digest"),
  base({ action: "digest" }),
  "/digest command"
);
assert.deepStrictEqual(
  parseCommandIntent("/settings"),
  base({ action: "settings" }),
  "/settings command"
);
assert.deepStrictEqual(
  parseCommandIntent("/bookmarks"),
  base({ action: "bookmarks" }),
  "/bookmarks command"
);
assert.deepStrictEqual(
  parseCommandIntent("/topics"),
  base({ action: "topics" }),
  "/topics command"
);
assert.deepStrictEqual(
  parseCommandIntent("/help"),
  base({ action: "help" }),
  "/help command"
);
assert.deepStrictEqual(
  parseCommandIntent("/start user@example.com"),
  base({ action: "start", email: "user@example.com" }),
  "/start with email"
);
assert.deepStrictEqual(
  parseCommandIntent("/verify ABC123"),
  base({ action: "verify_link", code: "ABC123" }),
  "/verify with code"
);

// ── parseCommandIntent — /block ───────────────────────────────────────────────

assert.deepStrictEqual(
  parseCommandIntent("/block benzinga.com"),
  base({ action: "source_block", source: "benzinga.com" }),
  "/block with domain"
);
assert.deepStrictEqual(
  parseCommandIntent("/block\tbenzinga.com"),
  base({ action: "source_block", source: "benzinga.com" }),
  "/block with tab separator"
);
assert.deepStrictEqual(
  parseCommandIntent("/block 3"),
  base({ action: "source_block", source: "3" }),
  "/block with item number passes through as '3'"
);

// ── parseCommandIntent — /trust ───────────────────────────────────────────────

assert.deepStrictEqual(
  parseCommandIntent("/trust wsj.com"),
  base({ action: "source_trust", source: "wsj.com" }),
  "/trust with domain"
);
assert.deepStrictEqual(
  parseCommandIntent("/trust 2"),
  base({ action: "source_trust", source: "2" }),
  "/trust with item number passes through as '2'"
);

// ── parseCommandIntent — /unblock ─────────────────────────────────────────────

assert.deepStrictEqual(
  parseCommandIntent("/unblock benzinga.com"),
  base({ action: "source_unblock", source: "benzinga.com" }),
  "/unblock with domain"
);
assert.deepStrictEqual(
  parseCommandIntent("/unblock 4"),
  base({ action: "source_unblock", source: "4" }),
  "/unblock with item number passes through as '4'"
);

// ── parseCommandIntent — non-slash messages return null ───────────────────────

assert.strictEqual(parseCommandIntent("block benzinga.com"), null, "natural language → null (routes to NLU)");
assert.strictEqual(parseCommandIntent("save 3"), null, "plain save → null");
assert.strictEqual(parseCommandIntent(""), null, "empty string → null");
assert.strictEqual(parseCommandIntent(null), null, "null → null");

// ── buildIntentPrompt — structure checks ──────────────────────────────────────

const prompt = buildIntentPrompt("block 3");
assert.ok(typeof prompt === "string" && prompt.length > 100, "buildIntentPrompt returns non-empty string");
assert.ok(prompt.includes("source_block"), "prompt includes source_block action");
assert.ok(prompt.includes("source_trust"), "prompt includes source_trust action");
assert.ok(prompt.includes("source_unblock"), "prompt includes source_unblock action");
assert.ok(prompt.includes('"block 3"'), "prompt includes item-number block example");
assert.ok(prompt.includes('"trust 2"'), "prompt includes item-number trust example");
assert.ok(prompt.includes('"unblock 4"'), "prompt includes item-number unblock example");
assert.ok(prompt.includes("source=\"3\"") || prompt.includes('source":"3"'), "prompt shows numeric source passthrough");
assert.ok(prompt.includes("block 3"), "user message appears in prompt");
