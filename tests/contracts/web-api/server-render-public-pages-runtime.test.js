"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-render-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { renderPublicDigestPage } = require(TARGET_PATH);

const html = renderPublicDigestPage({
  dateKey: "2026-03-13",
  dateLabel: "Friday, March 13, 2026",
  quickScan: "One&nbsp;&middot;&nbsp;Two &amp;middot; &amp;nbsp;Three",
  items: [
    {
      headline: "One",
      tag: "TECHNOLOGY",
      summary: "Top item",
      wim: "<strong>Why this matters.</strong> Keep watching this shift.",
      source: "example.com",
      url: "https://example.com/one",
      relevanceScore: 7.6,
    },
    {
      headline: "Two",
      tag: "ENERGY",
      summary: "Second item",
      wim: "Second why it matters.",
      source: "example.org",
      url: "https://example.org/two",
      relevance_score: 4.2,
    },
  ],
});

const publicHtml = renderPublicDigestPage({
  dateKey: "2026-03-13",
  dateLabel: "Friday, March 13, 2026",
  quickScan: "One · Two",
  items: [],
  baseUrl: "https://getsignalbrief.com/",
});

assert.ok(html.includes('class="scan-heading"'), "expected quick scan heading to render");
assert.ok(html.includes('class="scan-list"'), "expected quick scan list to render");
assert.ok(html.includes(">One<"), "expected first quick scan point to render");
assert.ok(html.includes(">Two<"), "expected second quick scan point to render");
assert.ok(html.includes(">Three<"), "expected third quick scan point to render");
assert.ok(!html.includes("&amp;nbsp;"), "expected normalized quick scan not to include escaped nbsp entity");
assert.ok(!html.includes("&amp;middot;"), "expected normalized quick scan not to include escaped middot entity");
assert.ok(html.includes('class="score-pill score-pill-compact"'), "expected quick scan score pill to render");
assert.ok(html.includes(">7.6<"), "expected current relevanceScore to render");
assert.ok(html.includes(">4.2<"), "expected legacy relevance_score to render");
assert.ok(html.includes('class="item-meta-left"'), "expected item metadata layout to include score badge region");
assert.ok(html.includes('<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">'), "expected public digest page to allow indexing");
assert.ok(html.includes('<link rel="canonical" href="http://localhost:3003/digest/2026-03-13">'), "expected canonical digest URL");
assert.ok(html.includes('"@type": "CollectionPage"'), "expected structured data block");
assert.ok(html.includes("SignalBrief Public Digest"), "expected public digest kicker");
assert.ok(html.includes("Get your own brief"), "expected signup CTA");
assert.ok(html.includes("Forward this brief"), "expected share CTA");
assert.ok(html.includes("Link copied"), "expected copy-link status message");
assert.ok(html.includes("Top item"), "expected item summary to render");
assert.ok(html.includes("Why it matters"), "expected why-it-matters label to render");
assert.ok(html.includes("Why this matters. Keep watching this shift."), "expected sanitized why-it-matters text to render");
assert.ok(publicHtml.includes('<link rel="canonical" href="https://getsignalbrief.com/digest/2026-03-13">'), "expected public page to canonicalize to the public digest URL");
