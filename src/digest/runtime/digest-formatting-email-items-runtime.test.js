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
  wim: "The retailer remains focused on what it calls &ldquo;stringent&rdquo; inventory practices.",
  source: "supplychaindive.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 7.8,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_oneliner" });

assert.ok(html.includes("“stringent”"), "email item body should decode named HTML entities");
assert.ok(!html.includes("&ldquo;"), "email item body should not leak raw named HTML entities");

const deepHtml = runtime.renderDigestItemHtml({
  tag: "TECHNOLOGY",
  headline: "AI budgets tighten around proof of ROI",
  wim: "Retail AI budgets are shifting from pilots to measurable productivity gains, which changes vendor qualification standards. Buyers now have more leverage to cut pilots that do not show labor or conversion gains before the next planning cycle.",
  source: "modernretail.co",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 8.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(deepHtml.includes("measurable productivity gains"), "deep emails should render the why-it-matters block");
assert.ok(!deepHtml.includes("analysis-copy"), "email renderer should not output archive-only markup");

const noFallbackHtml = runtime.renderDigestItemHtml({
  tag: "HEALTHCARE",
  headline: "Fallback summaries should not render in v2",
  summary: "This summary should not appear as a fallback body in v2.",
  wim: null,
  source: "modernhealthcare.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 8.0,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(!noFallbackHtml.includes("This summary should not appear"), "deep emails should not fall back to source summary text in v2");
assert.ok(!noFallbackHtml.includes("For healthcare operators"), "deep emails should not add a generic sector lens fallback in v2");

const noLegacySectionsHtml = runtime.renderDigestItemHtml({
  tag: "LIFE SCIENCES",
  headline: "Why It Matters v2 removes legacy sections",
  wim: "A strong story-specific interpretation should render as one block only.",
  implications: "This should not render.",
  watch_next: "This should not render either.",
  source: "fiercebiotech.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 7.9,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(noLegacySectionsHtml.includes("one block only"), "deep emails should keep the validated WIM body");
assert.ok(!noLegacySectionsHtml.includes("This should not render"), "deep emails should not render legacy implications/watch_next rows");

console.log("email item rendering follows Why It Matters v2 ✓");
