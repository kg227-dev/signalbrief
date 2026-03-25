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

// aggregateSourceHealth: basic 2-day scenario
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
          candidates: [], // zero items — should trigger miss
        },
      },
    },
  ];

  const result = aggregateSourceHealth(auditDocs);

  // TECHNOLOGY: 3 rss total, 0 official, 1 discovery, 0 miss days
  const tech = result.topics["TECHNOLOGY"];
  assert(tech, "TECHNOLOGY topic exists");
  assert.strictEqual(tech.lane_totals.rss, 3, `rss total: expected 3, got ${tech.lane_totals.rss}`);
  assert.strictEqual(tech.lane_totals.discovery, 1, "discovery total");
  assert.strictEqual(tech.miss_days, 0, "TECHNOLOGY: 0 miss days");
  assert(tech.source_domains.includes("techcrunch.com"), "techcrunch in domains");

  // HEALTHCARE: 1 official total, 1 miss day (empty candidates on day 2)
  const health = result.topics["HEALTHCARE"];
  assert.strictEqual(health.lane_totals.official, 1, "HEALTHCARE official total");
  assert.strictEqual(health.miss_days, 1, `HEALTHCARE: 1 miss day, got ${health.miss_days}`);

  // Warnings: HEALTHCARE had 1/2 miss days but threshold is 3 of 7 — no warning yet
  assert.strictEqual(result.warnings.length, 0, "no warnings below threshold");

  console.log("aggregateSourceHealth basic ✓");
}

// aggregateSourceHealth: warning when topic misses >= 3 of 7 days
{
  const missDays = Array.from({ length: 4 }, (_, i) => ({
    date_et: `2026-03-${20 + i}`,
    topics: { ENERGY: { candidates: [] } },
  }));
  const result = aggregateSourceHealth(missDays);
  const warn = result.warnings.find((w) => w.topic === "ENERGY");
  assert(warn, "ENERGY should have a warning");
  assert(warn.message.includes("miss"), `warning message: ${warn.message}`);
  console.log("aggregateSourceHealth warning ✓");
}

console.log("All source-health tests passed ✓");
