"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertModuleExports,
  assertNodeSyntaxFile,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/standard-topic-broker-fetch-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildInitialDiagnostics,
  buildNormalizedItemsForSource,
  mergeTopicDiagnostics,
  parseSourceBody,
  pickFirstDomain,
  sanitizePatternList,
} = runtime;

assert.deepStrictEqual(
  sanitizePatternList(["", "  approvals  ", null, "guidance"]),
  ["approvals", "guidance"],
  "sanitizePatternList should drop blanks and trim values"
);

assert.strictEqual(
  pickFirstDomain([" STATNEWS.COM "], ""),
  "statnews.com",
  "pickFirstDomain should normalize explicit domains"
);
assert.strictEqual(
  pickFirstDomain([], "https://www.fda.gov/news-events/press-announcements"),
  "fda.gov",
  "pickFirstDomain should fall back to the endpoint hostname"
);

const htmlEntries = parseSourceBody(
  {
    parser: "html_date_index",
    endpoint: "https://www.fda.gov/news-events/press-announcements",
  },
  {
    url: "https://www.fda.gov/news-events/press-announcements",
    bodyText: `
      <html><body>
        <ul>
          <li><span>March 22, 2026</span><a href="/news-events/press-announcements/fda-approves-rare-disease-therapy">FDA approves rare disease therapy</a></li>
          <li><span>March 22, 2026</span><a href="/news-events/search">Search FDA News</a></li>
        </ul>
      </body></html>`,
  }
);

assert.strictEqual(htmlEntries.length, 2, "parseSourceBody should parse html_date_index anchors before filtering");
assert.strictEqual(
  htmlEntries[0].url,
  "https://www.fda.gov/news-events/press-announcements/fda-approves-rare-disease-therapy"
);
assert.ok(
  String(htmlEntries[0].publishedDate || "").startsWith("2026-03-22T"),
  "parseSourceBody should normalize nearby dates to ISO"
);

const source = {
  id: "stat_rss",
  lane: "publisher_feed",
  source_family: "specialist",
  source_kind: "reported_media",
  domains: ["statnews.com"],
  endpoint: "https://feeds.example.com/stat.xml",
  topic_tags: ["HEALTHCARE"],
  tier: 1,
  content_kind: "article",
  title_exclude_patterns: ["sale"],
  url_exclude_patterns: ["/spons/"],
};

const normalized = buildNormalizedItemsForSource(
  source,
  [
    {
      title: "Hospital system expands outpatient footprint",
      url: "https://www.statnews.com/2026/03/22/outpatient-expansion/",
      publishedDate: "Mar 22, 2026 2:30pm",
      summary: "Fresh &ldquo;article&rdquo;.",
    },
    {
      title: "Sponsored sale roundup",
      url: "https://www.statnews.com/spons/sale-roundup/",
      publishedDate: "Mar 22, 2026 2:30pm",
      summary: "Drop me",
    },
    {
      title: "Hospital category page",
      url: "https://www.statnews.com/tag/hospitals/",
      publishedDate: "Mar 22, 2026 2:30pm",
      summary: "Listing page",
    },
    {
      title: "Old hospital strategy article",
      url: "https://www.statnews.com/2024/03/01/hospital-strategy/",
      publishedDate: "Mar 1, 2024 12:00pm",
      summary: "Old",
    },
  ],
  {
    assignCanonicalTopic: () => "HEALTHCARE",
    retrievedAt: "2026-03-23T01:00:00.000Z",
    maxAgeHours: 48,
  }
);

assert.strictEqual(normalized.items.length, 1, "buildNormalizedItemsForSource should retain only valid broker items");
assert.strictEqual(normalized.items[0].tag, "HEALTHCARE");
assert.strictEqual(normalized.items[0].source_domain, "statnews.com");
assert.ok(
  normalized.items[0].summary.includes("“article”"),
  "buildNormalizedItemsForSource should decode HTML entities in summaries"
);
assert.deepStrictEqual(normalized.diagnostics, {
  parsed_count: 4,
  retained_count: 1,
  stale_count: 1,
  non_article_count: 1,
  validation_drop_count: 1,
});

const diagnostics = buildInitialDiagnostics(["HEALTHCARE"]);
mergeTopicDiagnostics(diagnostics.topic_diagnostics.HEALTHCARE, source, normalized.items);
assert.strictEqual(diagnostics.topic_diagnostics.HEALTHCARE.item_count, 1);
assert.strictEqual(diagnostics.topic_diagnostics.HEALTHCARE.article_item_count, 1);
assert.deepStrictEqual(diagnostics.topic_diagnostics.HEALTHCARE.source_ids, ["stat_rss"]);

process.stdout.write("[standard-topic-broker-fetch-runtime] all assertions passed\n");
