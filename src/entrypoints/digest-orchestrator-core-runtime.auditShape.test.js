"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const auditDir = path.resolve(process.cwd(), ".tmp", "audit-shape-test");
fs.rmSync(auditDir, { recursive: true, force: true });
process.env.NODE_ENV = "test";
process.env.SIGNALBRIEF_DIGEST_AUDIT_DIR = auditDir;

const targetPath = require.resolve("./digest-orchestrator-core-runtime");
delete require.cache[targetPath];
const { writeDigestAuditLog } = require("./digest-orchestrator-core-runtime");

writeDigestAuditLog({
  digestDateKey: "2026-03-26",
  runId: "scheduled:test-run",
  runMode: "scheduled",
  selected: [
    { url: "https://example.com/selected-1" },
  ],
  selectionDiagnostics: {
    candidate_pool_before_dedup: 6,
    candidate_pool_after_editorial: 5,
    candidate_pool_after_archive_dedup: 5,
    candidate_pool_after_freshness: 4,
    candidate_pool_after_history: 3,
    candidate_pool_after_story_relationship: 3,
    candidate_pool_after_dedup: 3,
    candidate_pool_scored: 3,
    archive_repeat_block_count: 1,
    stale_removed_count: 1,
    history_suppressed_count: 1,
    editorial_excluded_count: 1,
    editorial_domain_suppressed_count: 0,
    editorial_pin_count: 1,
    story_relationship_continuation_removed: 1,
    story_relationship_follow_up_count: 1,
    discovery_capped_count: 0,
    selection_rejection_counts: {
      selection_not_selected: 1,
      selection_source_cap: 1,
    },
    score_top: 0.98,
    score_bottom: 0.51,
    topic_selection_audit: [
      {
        tag: "TECHNOLOGY",
        total_candidates: 3,
        selected_count: 1,
        rejected_count: 2,
        tier_counts: { tier1: 2, tier2: 1, tier3: 0 },
        lane_breakdown: { broker_publisher_feed: 2, perplexity_discovery: 1 },
        rejection_reason_counts: { selection_source_cap: 1, selection_not_selected: 1 },
        candidates: [
          {
            tag: "TECHNOLOGY",
            headline: "Winner",
            url: "https://example.com/selected-1",
            source: "techcrunch.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.98,
            _score_components: { freshness: 1, source_tier: 1, lane_bonus: 0.8, novelty: 0.8 },
            selected: true,
            selection_reason: null,
            strategic_relevance: "HIGH",
            strategic_relevance_reason: "Major regulatory shift with immediate market impact",
          },
          {
            tag: "TECHNOLOGY",
            headline: "Rejected for source cap",
            url: "https://example.com/rejected-source-cap",
            source: "techcrunch.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.8,
            _score_components: { freshness: 0.9, source_tier: 1, lane_bonus: 0.8, novelty: 0.6 },
            selected: false,
            selection_reason: "selection_source_cap",
          },
          {
            tag: "TECHNOLOGY",
            headline: "Rejected as non-winner",
            url: "https://example.com/rejected-not-selected",
            source: "openai.com",
            source_tier: 2,
            lane: "perplexity_discovery",
            _score: 0.51,
            _score_components: { freshness: 0.7, source_tier: 0.7, lane_bonus: 0.3, novelty: 0.5 },
            selected: false,
            selection_reason: "selection_not_selected",
          },
        ],
      },
    ],
  },
  fetchDiagnostics: {
    broker_candidate_count: 2,
    discovery_candidate_count: 1,
    discovery_candidate_cap_count: 1,
    discovery_candidate_capped_count: 0,
    broker_candidate_share_pct: 66.67,
    discovery_candidate_share_pct: 33.33,
    max_discovery_candidate_share_pct: 20,
    retrieval_origin_counts: {
      broker_publisher_feed: 2,
      broad: 1,
    },
    topic_diagnostics: [
      {
        tag: "TECHNOLOGY",
        coverage_status: "covered",
        broker_item_count: 2,
        discovery_item_count: 1,
        discovery_capped_count: 0,
        discovery_candidate_share_pct: 33.33,
        broker_candidate_share_pct: 66.67,
        failed_calls: 0,
        transport_errors: 0,
      },
    ],
    standard_topic_broker: {
      enabled: true,
      config_source: "bundled",
      active_topic_tags: ["TECHNOLOGY"],
      lane_counts: { publisher_feed: 2 },
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
          error: null,
        },
        {
          id: "wired_feed",
          lane: "publisher_feed",
          topic_tags: ["TECHNOLOGY"],
          endpoint: "https://wired.com/feed/",
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
          source_counts: { techcrunch_feed: 2 },
          source_ids: ["techcrunch_feed", "wired_feed"],
          item_count: 2,
          article_item_count: 2,
          official_document_count: 0,
          errors: [{ source_id: "wired_feed", error: "timeout" }],
        },
      ],
    },
  },
  enrichmentDiagnostics: {
    item_outcomes: [
      { url: "https://example.com/selected-1", enrichment_status: "success", repair_applied: false, failure_reason: null },
    ],
    writeup_failure_details: [
      {
        url: "https://example.com/rejected-not-selected",
        provider: "anthropic",
        reason: "provider_parse_failure",
        raw_preview: "{bad-json",
        raw_length: 9,
      },
    ],
  },
});

const auditDoc = JSON.parse(fs.readFileSync(path.join(auditDir, "2026-03-26.json"), "utf8"));

assert.strictEqual(auditDoc.summary.candidate_pool_after_freshness, 4);
assert.strictEqual(auditDoc.summary.selection_rejection_counts.selection_source_cap, 1);
assert.strictEqual(auditDoc.topics.TECHNOLOGY.rejection_reason_counts.selection_not_selected, 1);
assert.strictEqual(auditDoc.topics.TECHNOLOGY.candidates[1].selection_reason, "selection_source_cap");
assert.strictEqual(auditDoc.fetch.discovery_candidate_count, 1);
assert.strictEqual(auditDoc.fetch.max_discovery_candidate_share_pct, 20);
assert.strictEqual(auditDoc.fetch.retrieval_origin_counts.broad, 1);
assert.strictEqual(auditDoc.fetch.topic_diagnostics[0].discovery_candidate_share_pct, 33.33);
assert.strictEqual(auditDoc.fetch.standard_topic_broker.source_diagnostics.length, 2);
assert.strictEqual(auditDoc.fetch.standard_topic_broker.topic_diagnostics[0].errors.length, 1);
assert.strictEqual(
  auditDoc.topics.TECHNOLOGY.candidates[0].strategic_relevance_reason,
  "Major regulatory shift with immediate market impact"
);
assert.strictEqual(
  auditDoc.topics.TECHNOLOGY.candidates[0].strategic_relevance,
  "HIGH"
);
assert.strictEqual(auditDoc.enrichmentDiagnostics.writeup_failure_details[0].raw_preview, "{bad-json");

console.log("writeDigestAuditLog persists selection and broker telemetry shape ✓");
