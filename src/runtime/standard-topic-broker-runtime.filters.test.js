"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createStandardTopicBrokerRuntime } = require("./standard-topic-broker-runtime");

function buildRss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${items.map((item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.url}</link>
      <pubDate>${item.pubDate}</pubDate>
      <description>${item.description}</description>
    </item>
  `).join("")}</channel></rss>`;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-broker-filters-"));
  const configPath = path.join(tmpDir, "standard-topic-broker-sources.json");
  const bundledPath = path.join(tmpDir, "bundled-standard-topic-broker-sources.json");

  const config = {
    version: 2,
    lanes: {
      publisher_feed: { enabled: true },
      official: { enabled: false },
      perplexity_discovery: { enabled: false },
    },
    topics: {
      HEALTHCARE: { enabled: true, lanes: { publisher_feed: true, official: false } },
      TECHNOLOGY: { enabled: true, lanes: { publisher_feed: true, official: false } },
    },
    families: {},
    sources: [
      {
        id: "healthcare_modern_healthcare",
        enabled: true,
        tier: 1,
        lane: "publisher_feed",
        topic_tags: ["HEALTHCARE"],
        family: "healthcare_specialist",
        source_kind: "trade_specialist",
        source_family: "specialist",
        domains: ["modernhealthcare.com"],
        endpoint: "https://modern.example/feed",
        parser: "rss",
        content_kind: "article",
        url_exclude_patterns: ["/content-studio/"],
      },
      {
        id: "technology_the_verge",
        enabled: true,
        tier: 2,
        lane: "publisher_feed",
        topic_tags: ["TECHNOLOGY"],
        family: "technology_reported",
        source_kind: "reported_media",
        source_family: "reported",
        domains: ["theverge.com"],
        endpoint: "https://verge.example/feed",
        parser: "rss",
        content_kind: "article",
        title_exclude_patterns: ["spring sale", "readers are buying"],
      },
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(bundledPath, JSON.stringify(config, null, 2));

  const responses = new Map([
    ["https://modern.example/feed", buildRss([
      {
        title: "Hospital system expands outpatient footprint",
        url: "https://www.modernhealthcare.com/providers/outpatient-expansion",
        pubDate: "Mon, 30 Mar 2026 09:00:00 GMT",
        description: "Real hospital strategy story.",
      },
      {
        title: "4 cloud data practices every healthcare organization should be using",
        url: "https://www.modernhealthcare.com/content-studio/white-paper/mh-4-cloud-data-practices-healthcare-organizations/",
        pubDate: "Mon, 30 Mar 2026 09:05:00 GMT",
        description: "Sponsored white paper.",
      },
    ])],
    ["https://verge.example/feed", buildRss([
      {
        title: "Here’s what Verge readers are buying during Amazon’s Big Spring Sale",
        url: "https://www.theverge.com/gadgets/902473/most-popular-reader-picks-amazon-big-spring-sale-2026-deals",
        pubDate: "Mon, 30 Mar 2026 08:30:00 GMT",
        description: "Deals roundup.",
      },
      {
        title: "New enterprise AI controls arrive for cloud teams",
        url: "https://www.theverge.com/tech/enterprise-ai-controls",
        pubDate: "Mon, 30 Mar 2026 08:45:00 GMT",
        description: "Legitimate technology story.",
      },
    ])],
  ]);

  const runtime = createStandardTopicBrokerRuntime({
    standardTopicBrokerSourcesPath: configPath,
    bundledStandardTopicBrokerSourcesPath: bundledPath,
    fetchEndpoint: async (url) => ({
      ok: true,
      status: 200,
      contentType: "application/rss+xml",
      url,
      bodyText: responses.get(url) || "",
    }),
  });

  const result = await runtime.fetchBrokerCandidates({
    topicStates: [
      { topic: { tag: "HEALTHCARE" } },
      { topic: { tag: "TECHNOLOGY" } },
    ],
    retrievedAt: "2026-03-30T12:00:00.000Z",
    maxAgeHours: 48,
  });

  const healthcareUrls = (result.topicItems.HEALTHCARE || []).map((entry) => entry.url);
  const technologyUrls = (result.topicItems.TECHNOLOGY || []).map((entry) => entry.url);
  assert.deepStrictEqual(
    healthcareUrls,
    ["https://www.modernhealthcare.com/providers/outpatient-expansion"],
    "url exclusion patterns should drop Modern Healthcare content studio entries"
  );
  assert.deepStrictEqual(
    technologyUrls,
    ["https://www.theverge.com/tech/enterprise-ai-controls"],
    "title exclusion patterns should drop Verge sale/deals roundup entries"
  );

  const bySource = new Map(result.diagnostics.source_diagnostics.map((entry) => [entry.id, entry]));
  assert.strictEqual(Number(bySource.get("healthcare_modern_healthcare")?.validation_drop_count || 0), 1, "content studio URL should count as a validation drop");
  assert.strictEqual(Number(bySource.get("technology_the_verge")?.validation_drop_count || 0), 1, "Verge sale title should count as a validation drop");

  console.log("standard topic broker applies source-level title and url exclusions ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
