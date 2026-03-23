"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-fetch-items-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  articleAgeTooOld,
  classifyUrlShape,
  collectUniqueItems,
  createConversionFunnel,
  hasVerifiedPublishedDate,
  parsePerplexityItems,
} = runtime;
const RECENT_PUBLISHED_DATE = new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString();
const STALE_PUBLISHED_DATE = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();

const wrappedArray = parsePerplexityItems(`Here are the results:

\`\`\`json
[
  { "headline": "Item One", "summary": "Lead", "source": "reuters.com", "url": "https://www.reuters.com/a", "published_date": "2026-03-21", "tag": "AI×TECH" }
]
\`\`\`
`);
assert.strictEqual(wrappedArray.length, 1);
assert.strictEqual(wrappedArray[0].headline, "Item One");

const wrappedObject = parsePerplexityItems(`json {"items":[{"headline":"Item Two","summary":"Lead","source":"ft.com","url":"https://www.ft.com/b","published_date":"2026-03-21","tag":"STRATEGY"}]}`);
assert.strictEqual(wrappedObject.length, 1);
assert.strictEqual(wrappedObject[0].headline, "Item Two");

assert.strictEqual(hasVerifiedPublishedDate({ published_date: RECENT_PUBLISHED_DATE }), true);
assert.strictEqual(hasVerifiedPublishedDate({ published_date: "" }), false);
assert.strictEqual(articleAgeTooOld({ published_date: "" }, 48), true);
assert.strictEqual(articleAgeTooOld({ published_date: STALE_PUBLISHED_DATE }, 48), true);
assert.strictEqual(classifyUrlShape("https://www.reuters.com/technology/story-slug"), "article_url");
assert.strictEqual(classifyUrlShape("https://www.reuters.com/"), "homepage");
assert.strictEqual(classifyUrlShape("https://www.ft.com/search?q=ai"), "search_page");
assert.strictEqual(classifyUrlShape("https://www.example.com/topic/ai"), "tag_page");
assert.strictEqual(classifyUrlShape("https://www.example.com/news"), "listing_page");

const out = [];
const diagnostics = createConversionFunnel();
collectUniqueItems([
  { headline: "Fresh", url: "https://example.com/fresh", published_date: RECENT_PUBLISHED_DATE },
  { headline: "Unknown", url: "https://example.com/unknown", published_date: "" },
  { headline: "Stale", url: "https://example.com/stale", published_date: STALE_PUBLISHED_DATE },
], new Set(), new Set(), out, (value) => value, { maxAgeHours: 48, diagnostics });
assert.strictEqual(out.length, 1);
assert.strictEqual(out[0].headline, "Fresh");
assert.strictEqual(diagnostics.missing_published_date_count, 1);
assert.strictEqual(diagnostics.stale_item_count, 1);
assert.strictEqual(diagnostics.retained_item_count, 1);

process.stdout.write("[digest-data-fetch-items-runtime] all assertions passed\n");
