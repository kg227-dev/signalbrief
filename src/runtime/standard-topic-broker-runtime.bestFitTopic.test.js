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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-broker-topic-fit-"));
  const configPath = path.join(tmpDir, "standard-topic-broker-sources.json");
  const bundledPath = path.join(tmpDir, "bundled-standard-topic-broker-sources.json");

  const config = {
    version: 2,
    lanes: {
      publisher_feed: { enabled: true },
      official: { enabled: true },
      perplexity_discovery: { enabled: false },
    },
    topics: {
      HEALTHCARE: { enabled: true, lanes: { publisher_feed: true, official: true } },
      "LIFE SCIENCES": { enabled: true, lanes: { publisher_feed: true, official: true } },
      "FINANCIAL SERVICES": { enabled: true, lanes: { publisher_feed: true, official: true } },
      TECHNOLOGY: { enabled: true, lanes: { publisher_feed: true, official: true } },
      "CONSUMER & RETAIL": { enabled: true, lanes: { publisher_feed: true, official: true } },
      ENERGY: { enabled: true, lanes: { publisher_feed: true, official: true } },
    },
    families: {},
    sources: [
      {
        id: "healthcare_stat",
        enabled: true,
        tier: 1,
        lane: "publisher_feed",
        topic_tags: ["HEALTHCARE", "LIFE SCIENCES"],
        family: "healthcare_specialist",
        source_kind: "reported_media",
        source_family: "specialist",
        domains: ["statnews.com"],
        endpoint: "https://statnews.example/feed",
        parser: "rss",
        content_kind: "article",
      },
      {
        id: "policy_ftc_press",
        enabled: true,
        tier: 1,
        lane: "official",
        topic_tags: ["FINANCIAL SERVICES", "TECHNOLOGY", "CONSUMER & RETAIL"],
        family: "cross_sector_official",
        source_kind: "primary_official",
        source_family: "official",
        domains: ["ftc.gov"],
        endpoint: "https://ftc.example/feed",
        parser: "rss",
        content_kind: "official_document",
      },
      {
        id: "policy_federal_register",
        enabled: true,
        tier: 1,
        lane: "official",
        topic_tags: ["FINANCIAL SERVICES", "HEALTHCARE", "ENERGY"],
        family: "cross_sector_official",
        source_kind: "primary_official",
        source_family: "official",
        domains: ["federalregister.gov"],
        endpoint: "https://federalregister.example/feed",
        parser: "rss",
        content_kind: "official_document",
      },
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(bundledPath, JSON.stringify(config, null, 2));

  const responses = new Map([
    ["https://statnews.example/feed", buildRss([
      {
        title: "Biotech startup begins phase 3 oncology trial",
        url: "https://statnews.com/biotech-trial",
        pubDate: "Tue, 25 Mar 2026 09:00:00 GMT",
        description: "Drug developer says a therapy filing could follow after the clinical trial reads out.",
      },
      {
        title: "Hospital system expands Medicare Advantage network",
        url: "https://statnews.com/medicare-network",
        pubDate: "Tue, 25 Mar 2026 10:00:00 GMT",
        description: "Provider and payer groups are reworking reimbursement and care delivery operations.",
      },
    ])],
    ["https://ftc.example/feed", buildRss([
      {
        title: "FTC sues retailer over deceptive pricing and loyalty program practices",
        url: "https://ftc.gov/news/retailer-pricing",
        pubDate: "Tue, 25 Mar 2026 08:30:00 GMT",
        description: "The complaint says shoppers were misled during online checkout flows.",
      },
    ])],
    ["https://federalregister.example/feed", buildRss([
      {
        title: "Agency publishes annual reporting notice",
        url: "https://federalregister.gov/documents/annual-reporting-notice",
        pubDate: "Tue, 25 Mar 2026 07:30:00 GMT",
        description: "The notice opens a short comment period next month.",
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

  const { topicItems } = await runtime.fetchBrokerCandidates({
    topicStates: [
      { topic: { tag: "HEALTHCARE" } },
      { topic: { tag: "LIFE SCIENCES" } },
      { topic: { tag: "FINANCIAL SERVICES" } },
      { topic: { tag: "TECHNOLOGY" } },
      { topic: { tag: "CONSUMER & RETAIL" } },
      { topic: { tag: "ENERGY" } },
    ],
    retrievedAt: "2026-03-25T12:00:00.000Z",
    maxAgeHours: 48,
  });

  const urlToTag = new Map();
  for (const [tag, items] of Object.entries(topicItems)) {
    for (const item of items) {
      assert.ok(!urlToTag.has(item.url), `broker item ${item.url} should appear in exactly one topic bucket`);
      urlToTag.set(item.url, tag);
    }
  }

  assert.strictEqual(urlToTag.get("https://statnews.com/biotech-trial"), "LIFE SCIENCES", "biotech clinical news should route to life sciences only");
  assert.strictEqual(urlToTag.get("https://statnews.com/medicare-network"), "HEALTHCARE", "hospital and payer news should route to healthcare only");
  assert.strictEqual(urlToTag.get("https://ftc.gov/news/retailer-pricing"), "CONSUMER & RETAIL", "retailer enforcement should route to consumer and retail only");
  assert.strictEqual(urlToTag.get("https://federalregister.gov/documents/annual-reporting-notice"), "FINANCIAL SERVICES", "ambiguous cross-sector notices should fall back to the first configured topic");
  assert.strictEqual(urlToTag.size, 4, "cross-tagged broker items should not be duplicated across topics");

  console.log("standard topic broker assigns each story to one best-fit topic ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
