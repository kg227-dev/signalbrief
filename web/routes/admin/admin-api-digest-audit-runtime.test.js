"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DIGEST_AUDIT_ROLLING_WINDOW_DAYS,
  buildSourceHealthSummary,
  buildTopicReadiness,
  handleAdminDigestAuditRoutes,
  buildRollingMvpReadiness,
} = require("./admin-api-digest-audit-runtime");

function buildRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function buildCtx(pathname) {
  const url = new URL(`http://localhost${pathname}`);
  return {
    req: { method: "GET" },
    res: buildRes(),
    pathname,
    url,
  };
}

{
  assert.strictEqual(DIGEST_AUDIT_ROLLING_WINDOW_DAYS, 7, "digest audit rolling window should be fixed at 7 days");
  console.log("DIGEST_AUDIT_ROLLING_WINDOW_DAYS ✓");
}

{
  const readiness = buildRollingMvpReadiness([
    {
      date_et: "2026-03-26",
      fetch: {
        broker_candidate_count: 18,
        discovery_candidate_count: 2,
      },
      topics: {
        TECHNOLOGY: {
          total_candidates: 16,
          selected_count: 5,
          missed_story_flags: [{ headline: "Strong miss" }],
          candidates: [
            { selected: true, source_tier: 1 },
            { selected: true, source_tier: 2 },
            { selected: true, source_tier: 2 },
            { selected: true, source_tier: 3 },
            { selected: true, source_tier: 1 },
          ],
        },
      },
    },
    {
      date_et: "2026-03-25",
      fetch: {
        broker_candidate_count: 14,
        discovery_candidate_count: 6,
      },
      topics: {
        TECHNOLOGY: {
          total_candidates: 12,
          selected_count: 4,
          missed_story_flags: [],
          candidates: [
            { selected: true, source_tier: 1 },
            { selected: true, source_tier: 2 },
            { selected: true, source_tier: 3 },
            { selected: true, source_tier: 3 },
          ],
        },
      },
    },
  ]);

  assert.strictEqual(readiness.days_covered, 2, "rolling window counts audit days");
  assert.strictEqual(readiness.topic_days_observed, 2, "topic-day count computed");
  assert.strictEqual(readiness.topic_days_full_5, 1, "full 5 topic-days counted");
  assert.strictEqual(readiness.missed_story_flag_count, 1, "missed-story flags roll up");
  assert.ok(readiness.consecutive_full_day_streak >= 0, "streak computed");
  assert.ok(Array.isArray(readiness.concerns) && readiness.concerns.length > 0, "concerns explain remaining gaps");
  console.log("buildRollingMvpReadiness ✓");
}

{
  const readiness = buildRollingMvpReadiness([
    {
      date_et: "2026-03-28",
      fetch: {
        broker_candidate_count: 0,
        discovery_candidate_count: 10,
      },
      topics: {
        TECHNOLOGY: {
          total_candidates: 5,
          selected_count: 5,
          missed_story_flags: [],
          candidates: [
            { selected: true, source_tier: "premium", retrieval_origin: "broker_publisher_feed" },
            { selected: true, source_tier: "strong", retrieval_origin: "broker_official" },
            { selected: true, source_tier: "standard", retrieval_origin: "broad" },
            { selected: true, source_tier: "unknown", retrieval_origin: "broad" },
            { selected: true, source_tier: "corporate", retrieval_origin: "broad" },
          ],
        },
      },
    },
  ]);

  assert.strictEqual(readiness.trusted_selected_share_pct, 40, "premium + strong should count as trusted Tier 1/2");
  assert.strictEqual(readiness.broker_candidate_share_pct, 40, "candidate lane evidence should override stale fetch summary counts");
  assert.strictEqual(readiness.discovery_candidate_share_pct, 60, "broad lane should count as discovery supplement");
  console.log("buildRollingMvpReadiness string tiers ✓");
}

{
  const topicReadiness = buildTopicReadiness([
    {
      date_et: "2026-03-26",
      topics: {
        TECHNOLOGY: {
          total_candidates: 16,
          selected_count: 5,
          missed_story_flags: [{ headline: "Flagged story" }],
          candidates: [
            { lane: "publisher_feed", selected: true, source_tier: 1 },
            { lane: "publisher_feed", selected: true, source_tier: 2 },
            { lane: "publisher_feed", selected: true, source_tier: 2 },
            { lane: "official", selected: true, source_tier: 2 },
            { lane: "perplexity_discovery", selected: true, source_tier: 3 },
          ],
        },
      },
      fetch: {
        standard_topic_broker: {
          enabled: true,
          source_diagnostics: [
            {
              id: "tech_feed",
              lane: "publisher_feed",
              topic_tags: ["TECHNOLOGY"],
              endpoint: "https://example.com/feed.xml",
              ok: true,
            },
          ],
          topic_diagnostics: [
            {
              tag: "TECHNOLOGY",
              lane_counts: { publisher_feed: 4, official: 1, discovery: 1 },
              source_ids: ["tech_feed"],
              item_count: 5,
              errors: [],
            },
          ],
        },
        topic_diagnostics: [
          { tag: "TECHNOLOGY", coverage_status: "covered" },
        ],
      },
    },
  ]);

  assert.ok(topicReadiness.TECHNOLOGY, "topic readiness should include observed topic");
  assert.strictEqual(topicReadiness.TECHNOLOGY.full_5_rate_pct, 100, "topic full-5 rate should be computed");
  assert.strictEqual(topicReadiness.TECHNOLOGY.missed_story_flag_count, 1, "topic readiness should roll up missed-story flags");
  assert.strictEqual(topicReadiness.TECHNOLOGY.broker_candidate_share_pct, 80, "broker share should reflect rss/official lane mix");
  console.log("buildTopicReadiness ✓");
}

{
  const sourceHealthSummary = buildSourceHealthSummary({
    days_covered: 3,
    global_lane_totals: {
      rss: 12,
      official: 3,
      discovery: 5,
      unknown: 0,
    },
    warnings: [{ topic: "TECHNOLOGY", message: "Topic TECHNOLOGY had zero rss/official items" }],
    sources: {
      a: {
        id: "a",
        lane: "publisher_feed",
        topic_tags: ["TECHNOLOGY"],
        attempted_days: 3,
        success_days: 0,
        failure_days: 3,
        retained_count: 0,
        stale_count: 0,
        validation_drop_count: 0,
        last_error: "timeout",
      },
      b: {
        id: "b",
        lane: "official",
        topic_tags: ["HEALTHCARE"],
        attempted_days: 3,
        success_days: 3,
        failure_days: 0,
        retained_count: 7,
        stale_count: 1,
        validation_drop_count: 0,
        last_error: null,
      },
    },
  });

  assert.strictEqual(sourceHealthSummary.broker_candidate_share_pct, 75, "broker backbone share should include rss + official");
  assert.strictEqual(sourceHealthSummary.broker_source_success_rate_pct, 50, "source success rate should aggregate across sources");
  assert.strictEqual(sourceHealthSummary.source_warning_count, 1, "failing sources should be flagged");
  assert.strictEqual(sourceHealthSummary.top_source_warnings[0].source_id, "a", "worst source should be listed");
  console.log("buildSourceHealthSummary ✓");
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-audit-route-"));
  const priorAuditDoc = {
    date_et: "2026-03-26",
    summary: {
      total_candidates: 18,
      total_selected: 5,
      missed_story_flag_count: 0,
    },
    topics: {
      TECHNOLOGY: {
        total_candidates: 18,
        selected_count: 5,
        missed_story_flags: [],
        candidates: [
          { headline: "Prior selected item", url: "https://example.com/prior", source: "Example", lane: "publisher_feed", _score: 0.88, selected: true },
        ],
      },
    },
    fetch: {
      broker_candidate_count: 18,
      discovery_candidate_count: 0,
      topic_diagnostics: [],
    },
  };
  const auditDoc = {
    date_et: "2026-03-27",
    summary: {
      total_candidates: 20,
      total_selected: 5,
      missed_story_flag_count: 1,
    },
    topics: {
      TECHNOLOGY: {
        total_candidates: 20,
        selected_count: 5,
        missed_story_flags: [{ headline: "Strong miss" }],
        candidates: [
          { headline: "Selected item", url: "https://example.com/a", source: "Example", lane: "publisher_feed", _score: 0.9, selected: true },
        ],
      },
    },
    fetch: {
      broker_candidate_count: 18,
      discovery_candidate_count: 2,
      topic_diagnostics: [],
    },
  };
  fs.writeFileSync(path.join(tmpDir, "2026-03-26.json"), JSON.stringify(priorAuditDoc, null, 2), "utf8");
  fs.writeFileSync(path.join(tmpDir, "2026-03-27.json"), JSON.stringify(auditDoc, null, 2), "utf8");

  const ctx = buildCtx("/api/admin/digest-audit?date=2026-03-27&days=30");
  const deps = {
    json(res, data, status = 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    },
    isAdminAuthed: () => true,
    digestAuditDir: tmpDir,
    formatEtDateKey: () => "2026-03-27",
  };

  (async () => {
    const handled = await handleAdminDigestAuditRoutes(ctx, deps);
    assert.strictEqual(handled, true, "route handled");
    assert.strictEqual(ctx.res.statusCode, 200, "status 200");
    const body = JSON.parse(ctx.res.body);
    assert.strictEqual(body.ok, true, "ok response");
    assert.ok(body.rolling_readiness && typeof body.rolling_readiness === "object", "rolling readiness included");
    assert.ok(body.topic_readiness && typeof body.topic_readiness === "object", "topic readiness included");
    assert.ok(body.source_health && typeof body.source_health === "object", "source health summary included");
    assert.ok(body.runDiagnosis && typeof body.runDiagnosis === "object", "run diagnosis included");
    assert.ok(body.topics.TECHNOLOGY.topicDiagnosis && typeof body.topics.TECHNOLOGY.topicDiagnosis === "object", "topic diagnosis included");
    assert.strictEqual(body.summary.missed_story_flag_count, 1, "current audit summary preserved");
    assert.strictEqual(body.rolling_readiness.days_covered, 2, "rolling readiness honors requested days window");
    assert.strictEqual(body.topic_readiness.TECHNOLOGY.days_observed, 2, "topic readiness observed days grows past 1 when older audits are available");
    console.log("handleAdminDigestAuditRoutes ✓");
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-audit-route-clamp-"));
  for (let day = 1; day <= 8; day += 1) {
    const dateKey = `2026-03-${String(day).padStart(2, "0")}`;
    const auditDoc = {
      date_et: dateKey,
      summary: {
        total_candidates: 20,
        total_selected: 5,
        missed_story_flag_count: 0,
      },
      topics: {
        TECHNOLOGY: {
          total_candidates: 20,
          selected_count: 5,
          missed_story_flags: [],
          candidates: [
            { headline: `Selected item ${day}`, url: `https://example.com/${day}`, source: "Example", lane: "publisher_feed", _score: 0.9, selected: true },
          ],
        },
      },
      fetch: {
        broker_candidate_count: 18,
        discovery_candidate_count: 2,
        topic_diagnostics: [],
      },
    };
    fs.writeFileSync(path.join(tmpDir, `${dateKey}.json`), JSON.stringify(auditDoc, null, 2), "utf8");
  }

  const ctx = buildCtx("/api/admin/digest-audit?date=2026-03-08&days=30");
  const deps = {
    json(res, data, status = 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    },
    isAdminAuthed: () => true,
    digestAuditDir: tmpDir,
    formatEtDateKey: () => "2026-03-08",
  };

  (async () => {
    const handled = await handleAdminDigestAuditRoutes(ctx, deps);
    assert.strictEqual(handled, true, "route handled");
    assert.strictEqual(ctx.res.statusCode, 200, "status 200");
    const body = JSON.parse(ctx.res.body);
    assert.strictEqual(body.ok, true, "ok response");
    assert.strictEqual(body.rolling_readiness.days_covered, 7, "rolling readiness should clamp to 7 audit days");
    assert.strictEqual(body.source_health.days_covered, 7, "source health should clamp to 7 audit days");
    assert.strictEqual(body.topic_readiness.TECHNOLOGY.days_observed, 7, "topic readiness should clamp to 7 audit days");
    console.log("handleAdminDigestAuditRoutes rolling window clamp ✓");
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
