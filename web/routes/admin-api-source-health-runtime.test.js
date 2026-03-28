"use strict";

const assert = require("assert");
const {
  aggregateSourceHealth,
  classifyLane,
} = require("./admin-api-source-health-runtime");

// classifyLane
{
  assert.strictEqual(classifyLane("rss"), "rss");
  assert.strictEqual(classifyLane("publisher_feed"), "rss");
  assert.strictEqual(classifyLane("official"), "official");
  assert.strictEqual(classifyLane("regulatory"), "official");
  assert.strictEqual(classifyLane("perplexity_discovery"), "discovery");
  assert.strictEqual(classifyLane("discovery"), "discovery");
  assert.strictEqual(classifyLane(""), "unknown");
  assert.strictEqual(classifyLane(null), "unknown");
  console.log("classifyLane ✓");
}

// Fallback candidate aggregation still works when broker telemetry is absent.
{
  const auditDocs = [
    {
      date_et: "2026-03-23",
      topics: {
        TECHNOLOGY: {
          candidates: [
            { lane: "rss", source: "techcrunch.com", selected: true },
            { lane: "rss", source: "wired.com", selected: true },
            { lane: "perplexity_discovery", source: "openai.com", selected: false },
          ],
        },
        HEALTHCARE: {
          candidates: [
            { lane: "official", source: "fda.gov", selected: true },
          ],
        },
      },
    },
    {
      date_et: "2026-03-24",
      topics: {
        TECHNOLOGY: {
          candidates: [
            { lane: "rss", source: "techcrunch.com", selected: true },
          ],
        },
        HEALTHCARE: {
          candidates: [],
        },
      },
    },
  ];

  const result = aggregateSourceHealth(auditDocs);
  const tech = result.topics.TECHNOLOGY;
  const health = result.topics.HEALTHCARE;
  assert(tech, "TECHNOLOGY topic exists");
  assert.strictEqual(tech.lane_totals.rss, 3);
  assert.strictEqual(tech.lane_totals.discovery, 1);
  assert.strictEqual(tech.miss_days, 0);
  assert(tech.source_domains.includes("techcrunch.com"));
  assert.strictEqual(health.lane_totals.official, 1);
  assert.strictEqual(health.miss_days, 1);
  assert.strictEqual(result.warnings.length, 0);
  console.log("aggregateSourceHealth fallback candidate path ✓");
}

// Broker telemetry drives per-source health and topic miss/provider warnings.
{
  const auditDocs = [
    {
      date_et: "2026-03-24",
      fetch: {
        topic_diagnostics: [
          { tag: "TECHNOLOGY", coverage_status: "covered" },
          { tag: "HEALTHCARE", coverage_status: "provider_limited_zero" },
        ],
        standard_topic_broker: {
          enabled: true,
          source_fetch_count: 2,
          source_success_count: 1,
          source_failure_count: 1,
          source_diagnostics: [
            {
              id: "techcrunch_feed",
              lane: "publisher_feed",
              topic_tags: ["TECHNOLOGY"],
              endpoint: "https://techcrunch.com/feed/",
              ok: true,
              status: 200,
              parsed_count: 10,
              retained_count: 2,
              stale_count: 1,
              non_article_count: 0,
              validation_drop_count: 0,
            },
            {
              id: "fda_feed",
              lane: "official",
              topic_tags: ["HEALTHCARE"],
              endpoint: "https://www.fda.gov/news-events/press-announcements/rss.xml",
              ok: false,
              status: 503,
              parsed_count: 0,
              retained_count: 0,
              stale_count: 0,
              non_article_count: 0,
              validation_drop_count: 0,
              error: "timeout",
            },
          ],
          topic_diagnostics: [
            {
              tag: "TECHNOLOGY",
              lane_counts: { publisher_feed: 2 },
              source_ids: ["techcrunch_feed"],
              item_count: 2,
              errors: [],
            },
            {
              tag: "HEALTHCARE",
              lane_counts: {},
              source_ids: ["fda_feed"],
              item_count: 0,
              errors: [{ source_id: "fda_feed", error: "timeout" }],
            },
          ],
        },
      },
    },
    {
      date_et: "2026-03-25",
      fetch: {
        topic_diagnostics: [
          { tag: "TECHNOLOGY", coverage_status: "thin" },
          { tag: "HEALTHCARE", coverage_status: "provider_limited_zero" },
        ],
        standard_topic_broker: {
          enabled: true,
          source_fetch_count: 2,
          source_success_count: 1,
          source_failure_count: 1,
          source_diagnostics: [
            {
              id: "techcrunch_feed",
              lane: "publisher_feed",
              topic_tags: ["TECHNOLOGY"],
              endpoint: "https://techcrunch.com/feed/",
              ok: true,
              status: 200,
              parsed_count: 8,
              retained_count: 1,
              stale_count: 2,
              non_article_count: 0,
              validation_drop_count: 1,
            },
            {
              id: "fda_feed",
              lane: "official",
              topic_tags: ["HEALTHCARE"],
              endpoint: "https://www.fda.gov/news-events/press-announcements/rss.xml",
              ok: false,
              status: 503,
              parsed_count: 0,
              retained_count: 0,
              stale_count: 0,
              non_article_count: 0,
              validation_drop_count: 0,
              error: "timeout",
            },
          ],
          topic_diagnostics: [
            {
              tag: "TECHNOLOGY",
              lane_counts: { publisher_feed: 1 },
              source_ids: ["techcrunch_feed"],
              item_count: 1,
              errors: [],
            },
            {
              tag: "HEALTHCARE",
              lane_counts: {},
              source_ids: ["fda_feed"],
              item_count: 0,
              errors: [{ source_id: "fda_feed", error: "timeout" }],
            },
          ],
        },
      },
    },
    {
      date_et: "2026-03-26",
      fetch: {
        topic_diagnostics: [
          { tag: "TECHNOLOGY", coverage_status: "covered" },
          { tag: "HEALTHCARE", coverage_status: "provider_limited_zero" },
        ],
        standard_topic_broker: {
          enabled: true,
          source_fetch_count: 2,
          source_success_count: 1,
          source_failure_count: 1,
          source_diagnostics: [
            {
              id: "techcrunch_feed",
              lane: "publisher_feed",
              topic_tags: ["TECHNOLOGY"],
              endpoint: "https://techcrunch.com/feed/",
              ok: true,
              status: 200,
              parsed_count: 7,
              retained_count: 2,
              stale_count: 0,
              non_article_count: 0,
              validation_drop_count: 0,
            },
            {
              id: "fda_feed",
              lane: "official",
              topic_tags: ["HEALTHCARE"],
              endpoint: "https://www.fda.gov/news-events/press-announcements/rss.xml",
              ok: false,
              status: 503,
              parsed_count: 0,
              retained_count: 0,
              stale_count: 0,
              non_article_count: 0,
              validation_drop_count: 0,
              error: "timeout",
            },
          ],
          topic_diagnostics: [
            {
              tag: "TECHNOLOGY",
              lane_counts: { publisher_feed: 2 },
              source_ids: ["techcrunch_feed"],
              item_count: 2,
              errors: [],
            },
            {
              tag: "HEALTHCARE",
              lane_counts: {},
              source_ids: ["fda_feed"],
              item_count: 0,
              errors: [{ source_id: "fda_feed", error: "timeout" }],
            },
          ],
        },
      },
    },
  ];

  const result = aggregateSourceHealth(auditDocs);
  assert.strictEqual(result.broker_summary.source_fetch_count, 6, "broker fetch count should aggregate across days");
  assert.strictEqual(result.topics.TECHNOLOGY.lane_totals.rss, 5, "TECHNOLOGY broker rss items should aggregate");
  assert.strictEqual(result.topics.HEALTHCARE.miss_days, 3, "HEALTHCARE should show broker miss days");
  assert.strictEqual(result.topics.HEALTHCARE.no_broker_days, 3, "HEALTHCARE should show no-broker days");
  assert.strictEqual(result.topics.HEALTHCARE.provider_limited_days, 3, "HEALTHCARE should count provider-limited days");
  assert.strictEqual(result.sources.techcrunch_feed.retained_count, 5, "source retained counts should aggregate");
  assert.strictEqual(result.sources.fda_feed.failure_days, 3, "failing broker source should track failure days");
  assert.strictEqual(result.sources.fda_feed.error_days, 3, "failing broker source should track error days");
  assert(result.warnings.some((warning) => warning.topic === "HEALTHCARE" && String(warning.message).includes("rss/official")));
  assert(result.warnings.some((warning) => warning.topic === "HEALTHCARE" && String(warning.message).includes("provider-limited")));
  assert(result.source_warnings.some((warning) => warning.source_id === "fda_feed"));
  console.log("aggregateSourceHealth broker telemetry path ✓");
}

console.log("All source-health tests passed ✓");
