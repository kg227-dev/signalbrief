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
      source: "example.com",
      url: "https://example.com/one",
      relevanceScore: 7.6,
    },
    {
      headline: "Two",
      tag: "ENERGY",
      summary: "Second item",
      source: "example.org",
      url: "https://example.org/two",
      relevance_score: 4.2,
    },
  ],
});

const personalizedHtml = renderPublicDigestPage({
  dateKey: "2026-03-13",
  dateLabel: "Friday, March 13, 2026",
  quickScan: "One · Two",
  items: [],
  refToken: "a".repeat(64),
  baseUrl: "https://getsignalbrief.com/",
  isPersonalized: true,
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
assert.ok(html.includes('<meta name="robots" content="noindex,nofollow,noarchive">'), "expected digest preview to stay private");
assert.ok(html.includes('<link rel="canonical" href="http://localhost:3003/digest/2026-03-13">'), "expected canonical digest URL");
assert.ok(html.includes('"@type": "CollectionPage"'), "expected structured data block");
assert.ok(!html.includes("Forward this brief"), "expected share CTA to be removed from digest preview");
assert.ok(personalizedHtml.includes('<meta name="robots" content="noindex,nofollow,noarchive">'), "expected personalized digest page to be noindex");
assert.ok(personalizedHtml.includes('<link rel="canonical" href="https://getsignalbrief.com/digest/2026-03-13">'), "expected personalized page to canonicalize to the public digest URL");
assert.ok(!personalizedHtml.includes("Get your own personalized brief"), "expected legacy signup CTA to be removed from digest preview");
