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
