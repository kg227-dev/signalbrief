"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/standard-topic-broker-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createStandardTopicBrokerRuntime,
  sanitizeBrokerConfig,
} = runtime;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-standard-broker-"));
const runtimeConfigPath = path.join(tempDir, "standard-topic-broker-sources.json");
const bundledConfigPath = path.join(tempDir, "bundled-standard-topic-broker-sources.json");

const config = {
  version: 1,
  lanes: {
    perplexity_discovery: { enabled: true },
    publisher_feed: { enabled: true },
    official: { enabled: true },
  },
  topics: {
    HEALTHCARE: {
      enabled: true,
      lanes: {
        publisher_feed: true,
        official: true,
      },
    },
  },
  families: {
    healthcare_reported: {
      lane: "publisher_feed",
      source_family: "specialist",
    },
    healthcare_official: {
      lane: "official",
      source_family: "official",
    },
  },
  sources: [
    {
      id: "stat_rss",
      enabled: true,
      lane: "publisher_feed",
      topic_tags: ["HEALTHCARE"],
      family: "healthcare_reported",
      source_kind: "reported_media",
      domains: ["statnews.com"],
      endpoint: "https://feeds.example.com/stat.xml",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "fda_index",
      enabled: true,
      lane: "official",
      topic_tags: ["HEALTHCARE"],
      family: "healthcare_official",
      source_kind: "primary_official",
      domains: ["fda.gov"],
      endpoint: "https://www.fda.gov/news-events/press-announcements",
      parser: "html_date_index",
      content_kind: "official_document",
      title_include_patterns: ["approv", "warn", "guidance", "clearance"],
    },
    {
      id: "cms_rss",
      enabled: true,
      lane: "official",
      topic_tags: ["HEALTHCARE"],
      family: "healthcare_official",
      source_kind: "primary_official",
      domains: ["cms.gov"],
      endpoint: "https://www.cms.gov/newsroom/rss-feeds",
      parser: "rss",
      content_kind: "official_document",
      title_include_patterns: ["rule", "guidance", "medicare", "medicaid", "announcement"],
    },
  ],
};

fs.writeFileSync(runtimeConfigPath, JSON.stringify(config, null, 2));
fs.writeFileSync(bundledConfigPath, JSON.stringify({ version: 1 }, null, 2));

const responses = new Map([
  ["https://feeds.example.com/stat.xml", {
    ok: true,
    status: 200,
    url: "https://feeds.example.com/stat.xml",
    bodyText: `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>STAT</title>
          <item>
            <title>FDA expands obesity drug label after cardiovascular study</title>
            <link>https://www.statnews.com/2026/03/22/obesity-drug-label-expansion/</link>
            <pubDate>Mar 22, 2026 2:30pm</pubDate>
            <description>Fresh article.</description>
          </item>
          <item>
            <title>Pharma category page</title>
            <link>https://www.statnews.com/tag/pharma/</link>
            <pubDate>Sun, 22 Mar 2026 12:00:00 GMT</pubDate>
            <description>Listing page.</description>
          </item>
          <item>
            <title>Old hospital strategy article</title>
            <link>https://www.statnews.com/2024/03/01/hospital-strategy/</link>
            <pubDate>Fri, 01 Mar 2024 12:00:00 GMT</pubDate>
            <description>Stale article.</description>
          </item>
        </channel>
      </rss>`,
  }],
  ["https://www.fda.gov/news-events/press-announcements", {
    ok: true,
    status: 200,
    url: "https://www.fda.gov/news-events/press-announcements",
    bodyText: `
      <html><body>
        <ul>
          <li><span>March 22, 2026</span><a href="/news-events/press-announcements/fda-approves-rare-disease-therapy">FDA approves rare disease therapy</a></li>
          <li><span>March 22, 2026</span><a href="/news-events/search">Search FDA News</a></li>
          <li><span>March 21, 2024</span><a href="/news-events/press-announcements/fda-clears-device">FDA clears older device</a></li>
        </ul>
      </body></html>`,
  }],
  ["https://www.cms.gov/newsroom/rss-feeds", {
    ok: true,
    status: 200,
    url: "https://www.cms.gov/newsroom/rss-feeds",
    bodyText: `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0">
        <channel>
          <title>CMS Newsroom</title>
          <item>
            <title><a href="/newsroom/press-releases/cms-final-rule-modernizes-claims-attachments">CMS Final Rule Modernizes Claims Attachments</a></title>
            <link>https://www.cms.gov/%3Ca%20href%3D%22/newsroom/press-releases/cms-final-rule-modernizes-claims-attachments%22%3ECMS%20Final%20Rule%20Modernizes%20Claims%20Attachments%3C/a%3E</link>
            <pubDate>Sat, Mar 21, 2026</pubDate>
            <description>Official CMS rule announcement.</description>
          </item>
        </channel>
      </rss>`,
  }],
]);

const brokerRuntime = createStandardTopicBrokerRuntime({
  fs,
  appRoot: process.cwd(),
  standardTopicBrokerSourcesPath: runtimeConfigPath,
  bundledStandardTopicBrokerSourcesPath: bundledConfigPath,
  fetchEndpoint: async (url) => responses.get(String(url)) || { ok: false, status: 404, url, bodyText: "" },
  log: () => {},
});

const sanitized = sanitizeBrokerConfig(config);
assert.strictEqual(sanitized.sources.length, 3);
assert.strictEqual(sanitized.topics.HEALTHCARE.enabled, true);

const snapshot = brokerRuntime.inspectStandardTopicBrokerConfig();
assert.strictEqual(snapshot.source_mode, "runtime");
assert.strictEqual(snapshot.active_path, runtimeConfigPath);

(async () => {
  const result = await brokerRuntime.fetchBrokerCandidates({
    topicStates: [{ topic: { tag: "HEALTHCARE" } }],
    retrievedAt: "2026-03-23T01:00:00.000Z",
    maxAgeHours: 48,
  });

  assert.ok(Array.isArray(result.topicItems.HEALTHCARE));
  assert.strictEqual(result.topicItems.HEALTHCARE.length, 3);
  const articleItem = result.topicItems.HEALTHCARE.find((item) => item.retrieval_origin === "broker_publisher_feed");
  const officialItems = result.topicItems.HEALTHCARE.filter((item) => item.retrieval_origin === "broker_official");
  const officialItem = officialItems.find((item) => item.source_domain === "fda.gov");
  const cmsItem = officialItems.find((item) => item.source_domain === "cms.gov");
  assert.ok(articleItem);
  assert.ok(officialItem);
  assert.ok(cmsItem);
  assert.strictEqual(articleItem.content_kind, "article");
  assert.strictEqual(officialItem.content_kind, "official_document");
  assert.strictEqual(cmsItem.url, "https://www.cms.gov/newsroom/press-releases/cms-final-rule-modernizes-claims-attachments");
  assert.strictEqual(articleItem.source_policy, "preferred");
  assert.strictEqual(officialItem.source_type, "primary_official");
  assert.strictEqual(result.diagnostics.lane_counts.publisher_feed, 1);
  assert.strictEqual(result.diagnostics.lane_counts.official, 2);
  assert.strictEqual(result.diagnostics.source_fetch_count, 3);
  assert.strictEqual(result.diagnostics.source_success_count, 3);
  const statDiag = result.diagnostics.source_diagnostics.find((row) => row.id === "stat_rss");
  const fdaDiag = result.diagnostics.source_diagnostics.find((row) => row.id === "fda_index");
  const cmsDiag = result.diagnostics.source_diagnostics.find((row) => row.id === "cms_rss");
  assert.strictEqual(statDiag.parsed_count, 3);
  assert.strictEqual(statDiag.retained_count, 1);
  assert.strictEqual(statDiag.non_article_count, 1);
  assert.strictEqual(statDiag.stale_count, 1);
  assert.ok(fdaDiag.parsed_count >= 2);
  assert.strictEqual(fdaDiag.retained_count, 1);
  assert.strictEqual(cmsDiag.parsed_count, 1);
  assert.strictEqual(cmsDiag.retained_count, 1);
  assert.strictEqual(result.diagnostics.topic_diagnostics.HEALTHCARE.item_count, 3);
  process.stdout.write("[standard-topic-broker-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
