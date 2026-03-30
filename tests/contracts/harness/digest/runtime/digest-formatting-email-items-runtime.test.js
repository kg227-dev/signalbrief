"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-formatting-email-items-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createDigestEmailItemsRuntime } = runtime;

const emailItemsRuntime = createDigestEmailItemsRuntime({
  BASE_URL: "https://getsignalbrief.com",
  topicVisual: () => ({ chipText: "#111827", chipBg: "#E5E7EB", icon: "•" }),
  scoreColor: () => ({ solid: "#111827" }),
  escapeHtml: (value) => String(value || ""),
});

const html = emailItemsRuntime.renderDigestItemHtml({
  tag: "AI",
  headline: "Nvidia signs new enterprise deal",
  summary: "Summary text.",
  wim: "Why it matters.",
  source: "reuters.com",
  url: "https://www.reuters.com/example",
  relevanceScore: 7.3,
  why_shown: ["source_trusted", "tracked_topic"],
}, 0, {
  userToken: "token-123",
  digestId: "digest-456",
  depth: "headline_plus_why",
});

assert.ok(html.includes("Read more"), "email item should keep the read-more link");
assert.ok(html.includes("reuters.com"), "email item should keep source attribution");
assert.ok(html.includes("Why it matters."), "email item should render wim when present");
assert.ok(!html.includes("Summary text."), "email item should not render raw summary when wim is present");
assert.ok(!html.includes("Why included:"), "email item should not render why_shown text");
assert.ok(!html.includes("Lower confidence"), "email item should not render lower-confidence badges in the active MVP email path");

// summary fallback when wim is absent
const noWimHtml = emailItemsRuntime.renderDigestItemHtml({
  tag: "AI",
  headline: "Some headline",
  summary: "A short summary that describes the article.",
  wim: null,
  source: "example.com",
  url: "https://example.com/article",
}, 0, { depth: "headline_plus_why" });
assert.ok(noWimHtml.includes("A short summary"), "email item should show summary when wim is absent");
assert.ok(!noWimHtml.includes("Why it matters."), "email item should not show wim when it is null");
