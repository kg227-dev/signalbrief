"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const auditDir = path.resolve(process.cwd(), ".tmp", "audit-topic-rerun-test");
fs.rmSync(auditDir, { recursive: true, force: true });
process.env.NODE_ENV = "test";
process.env.SIGNALBRIEF_DIGEST_AUDIT_DIR = auditDir;

const targetPath = require.resolve("./digest-orchestrator-core-runtime");
delete require.cache[targetPath];
const {
  parseDigestRunArgs,
  writeDigestAuditLog,
} = require("./digest-orchestrator-core-runtime");

const parsed = parseDigestRunArgs([
  "--auditOnly",
  "--auditTopic=technology",
  "--auditDate=2026-03-27",
  "--suppressWelcome",
], {
  formatEtDateKey: () => "2026-03-27",
});
assert.strictEqual(parsed.auditTopicRerun, true);
assert.strictEqual(parsed.runMode, "admin_topic_audit_rerun");
assert.strictEqual(parsed.auditTopicTag, "TECHNOLOGY");
assert.strictEqual(parsed.auditDateKey, "2026-03-27");

writeDigestAuditLog({
  digestDateKey: "2026-03-27",
  runId: "scheduled:initial",
  runMode: "scheduled",
  selected: [
    { url: "https://example.com/tech-selected-1" },
    { url: "https://example.com/health-selected-1" },
  ],
  selectionDiagnostics: {
    candidate_pool_scored: 4,
    topic_selection_audit: [
      {
        tag: "TECHNOLOGY",
        total_candidates: 2,
        selected_count: 1,
        rejected_count: 1,
        tier_counts: { tier1: 2, tier2: 0, tier3: 0 },
        lane_breakdown: { broker_publisher_feed: 2 },
        rejection_reason_counts: { selection_not_selected: 1 },
        candidates: [
          {
            tag: "TECHNOLOGY",
            headline: "Initial technology winner",
            url: "https://example.com/tech-selected-1",
            source: "techcrunch.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.9,
            selected: true,
            selection_reason: null,
          },
          {
            tag: "TECHNOLOGY",
            headline: "Initial technology reject",
            url: "https://example.com/tech-reject-1",
            source: "wired.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.7,
            selected: false,
            selection_reason: "selection_not_selected",
          },
        ],
      },
      {
        tag: "HEALTHCARE",
        total_candidates: 2,
        selected_count: 1,
        rejected_count: 1,
        tier_counts: { tier1: 1, tier2: 1, tier3: 0 },
        lane_breakdown: { broker_official: 1, broker_publisher_feed: 1 },
        rejection_reason_counts: { selection_not_selected: 1 },
        candidates: [
          {
            tag: "HEALTHCARE",
            headline: "Initial healthcare winner",
            url: "https://example.com/health-selected-1",
            source: "cms.gov",
            source_tier: 1,
            lane: "broker_official",
            _score: 0.88,
            selected: true,
            selection_reason: null,
          },
          {
            tag: "HEALTHCARE",
            headline: "Initial healthcare reject",
            url: "https://example.com/health-reject-1",
            source: "modernhealthcare.com",
            source_tier: 2,
            lane: "broker_publisher_feed",
            _score: 0.66,
            selected: false,
            selection_reason: "selection_not_selected",
          },
        ],
      },
    ],
  },
  fetchDiagnostics: {
    broker_candidate_count: 4,
    discovery_candidate_count: 0,
    discovery_candidate_capped_count: 0,
    broker_candidate_share_pct: 100,
    discovery_candidate_share_pct: 0,
    max_discovery_candidate_share_pct: 20,
    topic_diagnostics: [
      {
        tag: "TECHNOLOGY",
        coverage_status: "covered",
        broker_item_count: 2,
        discovery_item_count: 0,
        discovery_capped_count: 0,
        discovery_candidate_share_pct: 0,
        broker_candidate_share_pct: 100,
      },
      {
        tag: "HEALTHCARE",
        coverage_status: "covered",
        broker_item_count: 2,
        discovery_item_count: 0,
        discovery_capped_count: 0,
        discovery_candidate_share_pct: 0,
        broker_candidate_share_pct: 100,
      },
    ],
    standard_topic_broker: {
      enabled: true,
      config_source: "bundled",
      active_topic_tags: ["TECHNOLOGY", "HEALTHCARE"],
      lane_counts: { publisher_feed: 3, official: 1 },
      source_fetch_count: 2,
      source_success_count: 2,
      source_failure_count: 0,
      source_diagnostics: [],
      topic_diagnostics: [
        { tag: "TECHNOLOGY", lane_counts: { publisher_feed: 2 }, source_counts: { tech_feed: 2 }, source_ids: ["tech_feed"], item_count: 2, article_item_count: 2, official_document_count: 0, errors: [] },
        { tag: "HEALTHCARE", lane_counts: { official: 1, publisher_feed: 1 }, source_counts: { cms_feed: 1, mh_feed: 1 }, source_ids: ["cms_feed", "mh_feed"], item_count: 2, article_item_count: 2, official_document_count: 1, errors: [] },
      ],
    },
  },
});

writeDigestAuditLog({
  digestDateKey: "2026-03-27",
  runId: "admin_topic_audit_rerun:tech",
  runMode: "admin_topic_audit_rerun",
  mergeTopicTag: "TECHNOLOGY",
  selected: [
    { url: "https://example.com/tech-selected-2" },
  ],
  selectionDiagnostics: {
    candidate_pool_scored: 2,
    topic_selection_audit: [
      {
        tag: "TECHNOLOGY",
        total_candidates: 2,
        selected_count: 1,
        rejected_count: 1,
        tier_counts: { tier1: 2, tier2: 0, tier3: 0 },
        lane_breakdown: { broker_publisher_feed: 1, perplexity_discovery: 1 },
        rejection_reason_counts: { selection_discovery_cap: 1 },
        candidates: [
          {
            tag: "TECHNOLOGY",
            headline: "Refreshed technology winner",
            url: "https://example.com/tech-selected-2",
            source: "theverge.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.95,
            selected: true,
            selection_reason: null,
          },
          {
            tag: "TECHNOLOGY",
            headline: "Refreshed technology reject",
            url: "https://example.com/tech-reject-2",
            source: "perplexity.ai",
            source_tier: 3,
            lane: "perplexity_discovery",
            _score: 0.5,
            selected: false,
            selection_reason: "selection_discovery_cap",
          },
        ],
      },
    ],
  },
  fetchDiagnostics: {
    broker_candidate_count: 1,
    discovery_candidate_count: 1,
    discovery_candidate_capped_count: 1,
    broker_candidate_share_pct: 50,
    discovery_candidate_share_pct: 50,
    max_discovery_candidate_share_pct: 20,
    topic_diagnostics: [
      {
        tag: "TECHNOLOGY",
        coverage_status: "covered",
        broker_item_count: 1,
        discovery_item_count: 1,
        discovery_capped_count: 1,
        discovery_candidate_share_pct: 50,
        broker_candidate_share_pct: 50,
      },
    ],
    standard_topic_broker: {
      enabled: true,
      config_source: "bundled",
      active_topic_tags: ["TECHNOLOGY"],
      lane_counts: { publisher_feed: 1 },
      source_fetch_count: 1,
      source_success_count: 1,
      source_failure_count: 0,
      source_diagnostics: [],
      topic_diagnostics: [
        { tag: "TECHNOLOGY", lane_counts: { publisher_feed: 1 }, source_counts: { verge_feed: 1 }, source_ids: ["verge_feed"], item_count: 1, article_item_count: 1, official_document_count: 0, errors: [] },
      ],
    },
  },
});

const mergedDoc = JSON.parse(fs.readFileSync(path.join(auditDir, "2026-03-27.json"), "utf8"));
assert.strictEqual(mergedDoc.topics.HEALTHCARE.candidates[0].headline, "Initial healthcare winner");
assert.strictEqual(mergedDoc.topics.TECHNOLOGY.candidates[0].headline, "Refreshed technology winner");
assert.strictEqual(mergedDoc.fetch.topic_diagnostics.length, 2);
assert.strictEqual(mergedDoc.fetch.discovery_candidate_capped_count, 1);
assert.strictEqual(mergedDoc.summary.total_selected, 2);
assert.strictEqual(mergedDoc.partial_refresh.tag, "TECHNOLOGY");

console.log("topic audit rerun merges one topic back into the daily audit log ✓");
