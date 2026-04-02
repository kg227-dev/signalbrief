"use strict";

const assert = require("assert");
const { createDigestEmailItemsRuntime } = require("./digest-formatting-email-items-runtime");

const runtime = createDigestEmailItemsRuntime({
  BASE_URL: "https://example.com",
  topicVisual() {
    return {
      icon: "●",
      chipText: "#111111",
      chipBg: "#EEEEEE",
    };
  },
  scoreColor() {
    return { solid: "#000000" };
  },
  escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
});

const html = runtime.renderDigestItemHtml({
  tag: "CONSUMER & RETAIL",
  headline: "Gaps feels confident about inventory levels, tariff mitigation",
  summary: "The retailer remains focused on what it calls &ldquo;stringent&rdquo; inventory practices.",
  source: "supplychaindive.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 7.8,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_oneliner" });

assert.ok(html.includes("“stringent”"), "email item body should decode named HTML entities");
assert.ok(!html.includes("&ldquo;"), "email item body should not leak raw named HTML entities");

const deepHtml = runtime.renderDigestItemHtml({
  tag: "TECHNOLOGY",
  headline: "Long summary should keep its ending",
  summary: "This summary is intentionally long enough to exercise the fallback rendering path without hitting the old 200 character cutoff. It should keep the tail end of the sentence intact instead of chopping it off midway through a word. Deep mode should keep this last clause visible, even though it pushes well past the old short cutoff and into the longer fallback range.",
  wim_brief: "Deep readers should still get a strategic fallback punchline when the full writeup is unavailable.",
  source: "techcrunch.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 8.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(deepHtml.includes("strategic fallback punchline"), "deep emails should prefer wim_brief over raw summary fallback");
assert.ok(!deepHtml.includes("old short cutoff"), "deep emails should not fall back to raw summary text");

console.log("email item rendering decodes HTML entities ✓");
