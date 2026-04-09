"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin/admin-api-funnel-data-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  buildDatesResponse,
  buildSourceRegistry,
  buildSummaryFromAuditDocs,
  expandDateRange,
  listAuditDates,
  readAuditFile,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-funnel-data-contract-"));
  const auditDoc = {
    date_et: "2026-04-05",
    summary: {
      candidate_pool_before_dedup: 3,
      candidate_pool_after_editorial: 3,
      candidate_pool_after_story_relationship: 2,
      candidate_pool_scored: 2,
    },
    topics: {
      TECHNOLOGY: {
        total_candidates: 3,
        selected_count: 1,
        candidates: [
          {
            headline: "Selected item",
            url: "https://www.reuters.com/tech/selected",
            source_domain: "reuters.com",
            selected: true,
            strategic_relevance: "HIGH",
            writeup_status: "model_pass",
          },
          {
            headline: "Rejected item",
            url: "https://www.reuters.com/tech/rejected",
            source_domain: "reuters.com",
            selected: false,
            selection_reason: "selection_not_selected",
            strategic_relevance: "LOW",
          },
        ],
      },
    },
    fetch: {
      broker_candidate_count: 2,
      discovery_candidate_count: 1,
      broker_fetch_items: [
        { topic: "TECHNOLOGY", domain: "reuters.com" },
      ],
      standard_topic_broker: {
        source_diagnostics: [
          {
            id: "reuters_world",
            ok: true,
            parsed_count: 5,
            retained_count: 2,
            stale_count: 1,
          },
        ],
      },
    },
  };
  fs.writeFileSync(path.join(tmpDir, "2026-04-05.json"), JSON.stringify(auditDoc), "utf8");
  fs.writeFileSync(path.join(tmpDir, "ignore-me.txt"), "nope", "utf8");

  assert.deepStrictEqual(expandDateRange("2026-04-03", "2026-04-05"), [
    "2026-04-05",
    "2026-04-04",
    "2026-04-03",
  ]);
  assert.deepStrictEqual(listAuditDates(tmpDir), ["2026-04-05"]);
  assert.strictEqual(readAuditFile(tmpDir, "2026-04-05")?.date_et, "2026-04-05");

  const datesResponse = buildDatesResponse(tmpDir);
  assert.deepStrictEqual(datesResponse.available_dates, ["2026-04-05"]);
  assert.strictEqual(datesResponse.oldest, "2026-04-05");
  assert.strictEqual(datesResponse.newest, "2026-04-05");

  const summary = buildSummaryFromAuditDocs([auditDoc], { from: "2026-04-05", to: "2026-04-05" });
  assert.strictEqual(summary.totals.fetched, 3);
  assert.strictEqual(summary.totals.selected, 1);
  assert.strictEqual(summary.topics[0].tag, "TECHNOLOGY");

  const sourceRegistry = buildSourceRegistry(auditDoc, "TECHNOLOGY");
  assert.ok(Array.isArray(sourceRegistry.sources));
  assert.strictEqual(sourceRegistry.configured_count, sourceRegistry.sources.length);
  assert.ok(Number.isInteger(sourceRegistry.active_count));
  assert.ok(Number.isInteger(sourceRegistry.silent_count));
})();
