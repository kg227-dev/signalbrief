"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-funnel-test-"));

// Write sample audit files
const auditA = { digestDateKey: "2026-04-05", summary: {}, topics: {}, fetch: {} };
const auditB = { digestDateKey: "2026-04-03", summary: {}, topics: {}, fetch: {} };
fs.writeFileSync(path.join(tmpDir, "2026-04-05.json"), JSON.stringify(auditA));
fs.writeFileSync(path.join(tmpDir, "2026-04-03.json"), JSON.stringify(auditB));
fs.writeFileSync(path.join(tmpDir, "not-a-date.json"), "{}"); // should be ignored

const { buildDatesResponse } = require("./admin-api-funnel-runtime");

const result = buildDatesResponse(tmpDir);
assert.deepStrictEqual(result.available_dates, ["2026-04-05", "2026-04-03"]);
assert.strictEqual(result.oldest, "2026-04-03");
assert.strictEqual(result.newest, "2026-04-05");
assert.strictEqual(result.total_run_days, 2);

// Empty dir
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-funnel-empty-"));
const emptyResult = buildDatesResponse(emptyDir);
assert.deepStrictEqual(emptyResult.available_dates, []);
assert.strictEqual(emptyResult.oldest, null);
assert.strictEqual(emptyResult.newest, null);
assert.strictEqual(emptyResult.total_run_days, 0);

console.log("buildDatesResponse tests pass ✓");

const { buildSummaryFromAuditDocs } = require("./admin-api-funnel-runtime");

const sampleDoc = {
  digestDateKey: "2026-04-05",
  summary: {
    candidate_pool_before_dedup: 34,
    candidate_pool_after_editorial: 32,
    candidate_pool_after_archive_dedup: 31,
    candidate_pool_after_freshness: 22,
    candidate_pool_after_story_relationship: 18,
    candidate_pool_scored: 9,
    stale_removed_count: 9,
    editorial_excluded_count: 2,
    archive_repeat_block_count: 1,
  },
  topics: {
    TECHNOLOGY: {
      total_candidates: 34,
      selected_count: 3,
      rejection_reason_counts: { selection_not_selected: 4, selection_source_cap: 2 },
      candidates: [
        { headline: "A", url: "https://reuters.com/a", source_domain: "reuters.com",
          lane: "broker_publisher_feed", selected: true, selection_reason: null,
          _score: 0.94, _score_components: { freshness: 0.9, source_tier: 1, lane_bonus: 0.8, novelty: 0.9 } },
        { headline: "B", url: "https://reuters.com/b", source_domain: "reuters.com",
          lane: "broker_publisher_feed", selected: false, selection_reason: "selection_not_selected",
          _score: 0.5, _score_components: {} },
        { headline: "C", url: "https://techcrunch.com/c", source_domain: "techcrunch.com",
          lane: "perplexity_discovery", selected: false, selection_reason: "selection_source_cap",
          _score: 0.4, _score_components: {} },
      ],
    },
  },
  fetch: {
    broker_candidate_count: 25,
    discovery_candidate_count: 9,
    standard_topic_broker: {
      source_diagnostics: [
        { id: "reuters_feed", lane: "publisher_feed", topic_tags: ["TECHNOLOGY"],
          ok: true, parsed_count: 30, retained_count: 25, stale_count: 5, error: null },
      ],
    },
  },
};

const summary = buildSummaryFromAuditDocs([sampleDoc], { from: "2026-04-05", to: "2026-04-05" });
assert.strictEqual(summary.run_dates.length, 1);
assert.deepStrictEqual(summary.missing_dates, []);
assert.strictEqual(summary.totals.fetched, 34); // broker(25) + discovery(9)
assert.strictEqual(summary.totals.selected, 3);
assert.ok(summary.topics.length === 1);
assert.strictEqual(summary.topics[0].tag, "TECHNOLOGY");
assert.strictEqual(summary.topics[0].fetched, 34);
assert.strictEqual(summary.topics[0].selected, 3);
assert.ok(Array.isArray(summary.topics[0].top_domains));

// top_drop_domains present and has correct shape
assert.ok(Array.isArray(summary.top_drop_domains), "top_drop_domains should be an array");

// top_drop_stage should be the stage that dropped the most items
assert.ok(typeof summary.top_drop_stage === "string" || summary.top_drop_stage === null, "top_drop_stage should be string or null");

// Range view: daily_trend should not appear for single-day view
assert.strictEqual(summary.daily_trend, undefined, "daily_trend should be absent in single-day view");

// Range view test
const docDay2 = {
  digestDateKey: "2026-04-04",
  summary: { candidate_pool_before_dedup: 10, candidate_pool_scored: 5 },
  topics: {
    TECHNOLOGY: {
      total_candidates: 10,
      selected_count: 2,
      candidates: [
        { headline: "X", url: "https://example.com/x", source_domain: "example.com",
          lane: "broker_publisher_feed", selected: true, selection_reason: null, _score: 0.9, _score_components: {} },
        { headline: "Y", url: "https://example.com/y", source_domain: "example.com",
          lane: "broker_publisher_feed", selected: true, selection_reason: null, _score: 0.8, _score_components: {} },
      ],
    },
  },
  fetch: { broker_candidate_count: 10, discovery_candidate_count: 0 },
};

const rangeSummary = buildSummaryFromAuditDocs([sampleDoc, docDay2], { from: "2026-04-04", to: "2026-04-05" });
assert.strictEqual(rangeSummary.run_dates.length, 2);
assert.deepStrictEqual(rangeSummary.missing_dates, []);
assert.ok(Array.isArray(rangeSummary.daily_trend), "daily_trend should be an array in range view");
assert.strictEqual(rangeSummary.daily_trend.length, 2, "daily_trend should have one entry per run date");
assert.ok(rangeSummary.daily_trend.every(d => typeof d.date === "string" && typeof d.fetched === "number" && typeof d.selected === "number"), "daily_trend entries have correct shape");
assert.strictEqual(rangeSummary.totals.fetched, 34 + 10); // sum across both days
assert.strictEqual(rangeSummary.totals.selected, 3 + 2);

console.log("buildSummaryFromAuditDocs tests pass ✓");

const { buildTopicResponse } = require("./admin-api-funnel-runtime");

const topicAuditDoc = {
  digestDateKey: "2026-04-05",
  summary: {
    candidate_pool_before_dedup: 6,
    candidate_pool_after_editorial: 5,
    candidate_pool_after_archive_dedup: 5,
    candidate_pool_after_freshness: 4,
    candidate_pool_after_story_relationship: 3,
    candidate_pool_scored: 3,
    stale_removed_count: 1,
    archive_repeat_block_count: 0,
    editorial_excluded_count: 1,
    story_relationship_continuation_removed: 1,
  },
  topics: {
    TECHNOLOGY: {
      total_candidates: 6,
      selected_count: 1,
      rejected_count: 2,
      rejection_reason_counts: { selection_not_selected: 1, selection_source_cap: 1 },
      candidates: [
        { headline: "Winner", url: "https://techcrunch.com/winner",
          source_domain: "techcrunch.com", lane: "broker_publisher_feed",
          _score: 0.98, _score_components: { freshness: 1, source_tier: 1, lane_bonus: 0.8, novelty: 0.8 },
          selected: true, selection_reason: null,
          strategic_relevance: "HIGH", strategic_relevance_reason: "Major shift",
          published_at: "2026-04-05T08:00:00Z" },
        { headline: "Rejected-cap", url: "https://techcrunch.com/cap",
          source_domain: "techcrunch.com", lane: "broker_publisher_feed",
          _score: 0.8, _score_components: { freshness: 0.9, source_tier: 1, lane_bonus: 0.8, novelty: 0.6 },
          selected: false, selection_reason: "selection_source_cap",
          strategic_relevance: "HIGH", strategic_relevance_reason: "Relevant",
          published_at: "2026-04-05T07:00:00Z" },
        { headline: "Rejected-not-selected", url: "https://openai.com/blog/x",
          source_domain: "openai.com", lane: "perplexity_discovery",
          _score: 0.51, _score_components: { freshness: 0.7, source_tier: 0.7, lane_bonus: 0.3, novelty: 0.5 },
          selected: false, selection_reason: "selection_not_selected",
          strategic_relevance: "MEDIUM", strategic_relevance_reason: "Somewhat relevant",
          published_at: "2026-04-04T12:00:00Z" },
      ],
    },
  },
  fetch: {
    broker_candidate_count: 4, discovery_candidate_count: 2,
    topic_diagnostics: [{ tag: "TECHNOLOGY", broker_item_count: 4, discovery_item_count: 2 }],
    standard_topic_broker: { source_diagnostics: [] },
  },
};

const topicResp = buildTopicResponse(topicAuditDoc, "TECHNOLOGY");
assert.ok(topicResp, "should return a response");
assert.strictEqual(topicResp.topic, "TECHNOLOGY");
assert.strictEqual(topicResp.stages.length, 9);
// Stage order matches STAGES enum
assert.strictEqual(topicResp.stages[0].stage, "fetch");
assert.strictEqual(topicResp.stages[8].stage, "enrichment");
// Fetch is pass-through: dropped=0
assert.strictEqual(topicResp.stages[0].dropped, 0);
// final_selection is instrumented (has candidates)
const finalStage = topicResp.stages.find((s) => s.stage === "final_selection");
assert.ok(finalStage.instrumented, "final_selection should be instrumented");
assert.ok(finalStage.items.length > 0, "final_selection should have items");
// selected item uses correct lane normalization
const selectedItem = finalStage.items.find((i) => i.status === "selected");
assert.ok(selectedItem, "should have a selected item");
assert.strictEqual(selectedItem.lane, "broker", "lane should be normalized from broker_publisher_feed");
assert.strictEqual(selectedItem.domain, "techcrunch.com");
// stage consistency check: stages[n].out === stages[n+1].in (or integrity_warning present)
for (let i = 0; i < topicResp.stages.length - 1; i++) {
  const curr = topicResp.stages[i];
  const next = topicResp.stages[i + 1];
  if (curr.out !== next.in) {
    assert.ok(topicResp.integrity_warning, `Expected integrity_warning for mismatch at ${curr.stage} → ${next.stage}`);
  }
}
// source_domains table present
assert.ok(Array.isArray(topicResp.source_domains));
assert.ok(topicResp.source_domains.length > 0);

// null topic returns null
assert.strictEqual(buildTopicResponse(topicAuditDoc, "NONEXISTENT"), null);

console.log("buildTopicResponse tests pass ✓");

// Test: buildTopicResponse consumes new instrumentation fields
const docWithInstrumentation = {
  digestDateKey: "2026-04-06",
  summary: {
    candidate_pool_before_dedup: 5,
    candidate_pool_after_editorial: 4,
    candidate_pool_after_archive_dedup: 4,
    candidate_pool_after_freshness: 4,
    candidate_pool_after_story_relationship: 3,
    candidate_pool_scored: 2,
    stale_removed_count: 0,
    archive_repeat_block_count: 0,
    editorial_excluded_count: 1,
    story_relationship_continuation_removed: 1,
  },
  topics: {
    TECH: {
      total_candidates: 5,
      selected_count: 1,
      candidates: [
        { headline: "Selected", url: "https://tc.com/a", source_domain: "tc.com",
          lane: "broker_publisher_feed", selected: true, selection_reason: null,
          _score: 0.9, _score_components: {} },
      ],
    },
  },
  fetch: {
    broker_candidate_count: 3, discovery_candidate_count: 2,
    topic_diagnostics: [{ tag: "TECH", broker_item_count: 3, discovery_item_count: 2 }],
    standard_topic_broker: { source_diagnostics: [] },
    discovery_fetch_items: [
      { stage: "fetch", lane: "perplexity_discovery", status: "passed", topic: "TECH",
        url: "https://perp.ai/x", title: "Discovery item", domain: "perp.ai", published_at: null },
    ],
  },
  selectionDiagnostics: {
    editorial_dropped_items: [
      { stage: "editorial_filter", status: "dropped", reason: "url_excluded",
        url: "https://excluded.com/a", title: "Excluded", domain: "excluded.com", topic: "TECH" },
    ],
    archive_dedup_dropped_items: [],
    freshness_dropped_items: [],
  },
  enrichmentDiagnostics: {
    item_outcomes: [
      { url: "https://tc.com/a", enrichment_status: "success", repair_applied: false, failure_reason: null },
    ],
  },
};

const instrResp = buildTopicResponse(docWithInstrumentation, "TECH");
assert.ok(instrResp, "should return response for instrumented doc");

const fetchStage = instrResp.stages.find((s) => s.stage === "fetch");
assert.ok(fetchStage.instrumented, "fetch stage should be instrumented when discovery_fetch_items present");
assert.ok(fetchStage.items.length > 0, "fetch stage should have items");
assert.strictEqual(fetchStage.items[0].lane, "discovery");

const editorialStage = instrResp.stages.find((s) => s.stage === "editorial_filter");
assert.ok(editorialStage.instrumented, "editorial_filter should be instrumented");
assert.strictEqual(editorialStage.items.length, 1);
assert.strictEqual(editorialStage.items[0].reason, "url_excluded");

const enrichmentStage = instrResp.stages.find((s) => s.stage === "enrichment");
assert.ok(enrichmentStage.instrumented, "enrichment should be instrumented");
assert.strictEqual(enrichmentStage.items[0].enrichment_status, "success");

console.log("buildTopicResponse instrumentation wiring tests pass ✓");
