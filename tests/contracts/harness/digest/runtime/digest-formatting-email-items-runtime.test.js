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

// deep mode should not masquerade source summary as why-it-matters copy
const noWimHtml = emailItemsRuntime.renderDigestItemHtml({
  tag: "AI",
  headline: "Some headline",
  summary: "A short summary that describes the article.",
  wim: null,
  wim_brief: "A tighter strategic fallback punchline.",
  source: "example.com",
  url: "https://example.com/article",
}, 0, { depth: "headline_plus_why" });
assert.ok(noWimHtml.includes("strategic fallback punchline"), "email item should fall back to wim_brief in deep mode");
assert.ok(!noWimHtml.includes("A short summary"), "email item should not show source summary in deep mode when wim is absent");
assert.ok(!noWimHtml.includes("Why it matters."), "email item should not show wim when it is null");

const noWriteupHtml = emailItemsRuntime.renderDigestItemHtml({
  tag: "HEALTHCARE",
  headline: "Blank deep cards should not ship",
  summary: "A source summary should render when scheduled writeups are missing so users still get context under the headline.",
  wim: null,
  wim_brief: null,
  source: "modernhealthcare.com",
  url: "https://example.com/healthcare",
}, 0, { depth: "headline_plus_why" });
assert.ok(noWriteupHtml.includes("A source summary should render"), "email item should fall back to summary in deep mode when no writeup fields are available");
assert.ok(noWriteupHtml.includes("For healthcare operators"), "email item should add a strategic lens in deep mode when no writeup fields are available");

const duplicateFallbackHtml = emailItemsRuntime.renderDigestItemHtml({
  tag: "LIFE SCIENCES",
  headline: "Frequently requested or proactively posted drug-specific and other records",
  summary: "Frequently requested or proactively posted drug-specific and other records",
  wim: null,
  wim_brief: null,
  source: "fda.gov",
  url: "https://example.com/fda",
}, 0, { depth: "headline_plus_why" });
assert.ok(duplicateFallbackHtml.includes("For life sciences teams"), "email item should use a strategic lens when summary duplicates the headline");
