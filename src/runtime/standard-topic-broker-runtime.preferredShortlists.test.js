"use strict";

const assert = require("assert");
const {
  buildBrokerPreferredDomainShortlistFromConfig,
  buildBrokerPreferredSourceFamilyShortlistsFromConfig,
  sanitizeBrokerConfig,
} = require("./standard-topic-broker-runtime");

const config = sanitizeBrokerConfig({
  version: 2,
  lanes: {
    publisher_feed: { enabled: true },
    official: { enabled: true },
    perplexity_discovery: { enabled: false },
  },
  topics: {
    TECHNOLOGY: { enabled: true, lanes: { publisher_feed: true, official: true } },
    "FINANCIAL SERVICES": { enabled: true, lanes: { publisher_feed: true, official: true } },
    INDUSTRIALS: { enabled: true, lanes: { publisher_feed: true, official: false } },
  },
  sources: [
    {
      id: "techcrunch_feed",
      lane: "publisher_feed",
      topic_tags: ["TECHNOLOGY"],
      source_kind: "reported_media",
      source_family: "reported",
      domains: ["techcrunch.com"],
      endpoint: "https://techcrunch.com/feed/",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "wired_feed",
      lane: "publisher_feed",
      topic_tags: ["TECHNOLOGY"],
      source_kind: "reported_media",
      source_family: "reported",
      domains: ["wired.com"],
      endpoint: "https://wired.com/feed/",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "sec_press",
      lane: "official",
      topic_tags: ["TECHNOLOGY"],
      source_kind: "primary_official",
      source_family: "official",
      domains: ["sec.gov"],
      endpoint: "https://www.sec.gov/news/pressreleases.rss",
      parser: "rss",
      content_kind: "official_document",
    },
    {
      id: "american_banker_feed",
      lane: "publisher_feed",
      topic_tags: ["FINANCIAL SERVICES"],
      source_kind: "reported_media",
      source_family: "reported",
      domains: ["americanbanker.com"],
      endpoint: "https://www.americanbanker.com/feed",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "federal_reserve_feed",
      lane: "official",
      topic_tags: ["FINANCIAL SERVICES"],
      source_kind: "primary_official",
      source_family: "official",
      domains: ["federalreserve.gov"],
      endpoint: "https://www.federalreserve.gov/feeds/press_all.xml",
      parser: "rss",
      content_kind: "official_document",
    },
    {
      id: "industryweek_feed",
      lane: "publisher_feed",
      topic_tags: ["INDUSTRIALS"],
      source_kind: "reported_media",
      source_family: "reported",
      domains: ["industryweek.com"],
      endpoint: "https://www.industryweek.com/rss.xml",
      parser: "rss",
      content_kind: "article",
    },
    {
      id: "osha_feed",
      lane: "official",
      topic_tags: ["INDUSTRIALS"],
      source_kind: "primary_official",
      source_family: "official",
      domains: ["osha.gov"],
      endpoint: "https://www.osha.gov/news/newsreleases.rss",
      parser: "rss",
      content_kind: "official_document",
    },
  ],
});

{
  const shortlist = buildBrokerPreferredDomainShortlistFromConfig(config, { topicTag: "TECHNOLOGY" });
  assert.deepStrictEqual(
    shortlist.domains,
    ["techcrunch.com", "wired.com", "sec.gov"],
    "technology should use broker publisher feeds first, then official domains"
  );
  assert.strictEqual(shortlist.official_friendly, false);
  assert.strictEqual(shortlist.source_of_truth, "standard_topic_broker");
  console.log("broker preferred domain shortlist uses standard-topic broker for technology ✓");
}

{
  const shortlist = buildBrokerPreferredDomainShortlistFromConfig(config, { topicTag: "FINANCIAL SERVICES" });
  assert.deepStrictEqual(
    shortlist.domains,
    ["federalreserve.gov", "americanbanker.com"],
    "financial services should prefer official domains first"
  );
  assert.strictEqual(shortlist.official_friendly, true);
  console.log("broker preferred domain shortlist honors official-friendly standard topics ✓");
}

{
  const familyShortlists = buildBrokerPreferredSourceFamilyShortlistsFromConfig(config, { topicTag: "INDUSTRIALS" });
  assert.deepStrictEqual(familyShortlists.reported_domains, ["industryweek.com"]);
  assert.deepStrictEqual(familyShortlists.official_domains, [], "disabled official lane should not leak into active shortlists");
  assert.strictEqual(familyShortlists.source_of_truth, "standard_topic_broker");
  console.log("broker family shortlists respect topic lane toggles ✓");
}

{
  const customShortlist = buildBrokerPreferredDomainShortlistFromConfig(config, { topicTag: "CUSTOM_WIDGETS" });
  assert.strictEqual(customShortlist, null, "custom/non-MVP topics should fall back to the legacy registry path");
  console.log("broker preferred domain shortlist falls back for non-MVP topics ✓");
}

console.log("standard-topic broker preferred shortlists ✓");
