"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-audit-route-"));
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
  fs.writeFileSync(path.join(tmpDir, "2026-03-27.json"), JSON.stringify(auditDoc, null, 2), "utf8");

  const ctx = buildCtx("/api/admin/digest-audit?date=2026-03-27");
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
    assert.strictEqual(body.summary.missed_story_flag_count, 1, "current audit summary preserved");
    console.log("handleAdminDigestAuditRoutes ✓");
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
