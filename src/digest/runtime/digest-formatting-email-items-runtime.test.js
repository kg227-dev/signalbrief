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

const deepSummaryFallbackHtml = runtime.renderDigestItemHtml({
  tag: "HEALTHCARE",
  headline: "Fallback summaries should still render in deep mode",
  summary: "This summary should appear when both why-it-matters fields are missing so deep digests never ship blank cards.",
  wim: null,
  wim_brief: null,
  source: "modernhealthcare.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 8.0,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(deepSummaryFallbackHtml.includes("This summary should appear"), "deep emails should fall back to source summary when no why-it-matters fields are available");
assert.ok(deepSummaryFallbackHtml.includes("For healthcare operators"), "deep emails should add a strategic lens when no why-it-matters fields are available");

const duplicatedSummaryHtml = runtime.renderDigestItemHtml({
  tag: "LIFE SCIENCES",
  headline: "Frequently requested or proactively posted drug-specific and other records",
  summary: "Frequently requested or proactively posted drug-specific and other records",
  wim: null,
  wim_brief: null,
  source: "fda.gov",
  source_tier: "premium",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 6.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });

assert.ok(duplicatedSummaryHtml.includes("records or listing page"), "deep fallback should flag listing-style FDA content instead of inventing a strategic lens");
assert.ok(!duplicatedSummaryHtml.includes("For life sciences teams"), "deep fallback should not apply the normal sector lens to listing pages");

const safetyNoticeHtml = runtime.renderDigestItemHtml({
  tag: "LIFE SCIENCES",
  headline: "FDA alerts customers to voluntary recall of compounded drugs due to sterility issues",
  summary: "FDA is alerting patients and health care professionals about a voluntary recall due to a lack of sterility assurance.",
  wim: null,
  wim_brief: null,
  source: "fda.gov",
  source_tier: "premium",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 6.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });
assert.ok(safetyNoticeHtml.includes("targeted safety or enforcement notice"), "deep fallback should use a safety-notice disclaimer for recall-style official items");

const commentaryHtml = runtime.renderDigestItemHtml({
  tag: "TECHNOLOGY",
  headline: "Best Noise-Canceling Earbuds: Bose, Sony, Apple, and More",
  summary: "Everyone needs a good pair of ANC earbuds.",
  wim: null,
  wim_brief: null,
  source: "wired.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 6.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });
assert.ok(commentaryHtml.includes("commentary or feature content"), "deep fallback should flag feature-style content instead of inventing a strategic lens");

const opinionHtml = runtime.renderDigestItemHtml({
  tag: "HEALTHCARE",
  headline: "Opinion: America needs more clinics of last resort for patients who can’t get answers",
  summary: "An excerpt from a new book argues for more clinics of last resort.",
  wim: null,
  wim_brief: null,
  source: "statnews.com",
  source_tier: "strong",
  published_date: "2026-04-01T10:00:00.000Z",
  relevanceScore: 6.2,
}, 0, { digestDateKey: "2026-04-01", depth: "headline_plus_why" });
assert.ok(opinionHtml.includes("commentary or feature content"), "deep fallback should flag opinion content instead of adding a normal sector lens");

console.log("email item rendering decodes HTML entities ✓");
