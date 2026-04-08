"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-audit-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  'if (runMode === "scheduled") throw',
  "function buildDigestAuditDocument(",
  "function mergeTopicAuditDocument(",
]);

const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildDigestAuditDocument,
  mergeTopicAuditDocument,
  recomputeDigestAuditRollups,
  createDigestOrchestratorAuditRuntime,
} = runtime;

const baseDoc = buildDigestAuditDocument({
  digestDateKey: "2026-04-08",
  runId: "scheduled:contract-base",
  runMode: "scheduled",
  selected: [{ url: "https://example.com/base-selected" }],
  selectionDiagnostics: {
    candidate_pool_scored: 2,
    topic_selection_audit: [
      {
        tag: "TECHNOLOGY",
        total_candidates: 2,
        selected_count: 1,
        rejected_count: 1,
        tier_counts: { tier1: 1, tier2: 1 },
        lane_breakdown: { broker_publisher_feed: 1, perplexity_discovery: 1 },
        rejection_reason_counts: { selection_not_selected: 1 },
        candidates: [
          {
            headline: "Base winner",
            url: "https://example.com/base-selected",
            source: "example.com",
            source_tier: 1,
            lane: "broker_publisher_feed",
            _score: 0.91,
            selected: true,
          },
          {
            headline: "Base rejected",
            url: "https://example.com/base-rejected",
            source: "example.com",
            source_tier: 2,
            lane: "perplexity_discovery",
            _score: 0.62,
            selected: false,
            selection_reason: "selection_not_selected",
          },
        ],
      },
    ],
  },
  fetchDiagnostics: {
    topic_diagnostics: [
      {
        tag: "TECHNOLOGY",
        broker_item_count: 1,
        discovery_item_count: 1,
        discovery_capped_count: 0,
      },
    ],
  },
  enrichmentDiagnostics: {},
});

assert.strictEqual(baseDoc.summary.total_selected, 1);
assert.strictEqual(baseDoc.topics.TECHNOLOGY.total_candidates, 2);

const mergedDoc = mergeTopicAuditDocument(
  {
    date_et: "2026-04-08",
    topics: {
      HEALTHCARE: {
        total_candidates: 1,
        selected_count: 1,
        rejected_count: 0,
        lane_breakdown: { broker_official: 1 },
        rejection_reason_counts: {},
        missed_story_flags: [],
        strict_quality: { pass: true },
        candidates: [{ headline: "Healthcare winner" }],
      },
    },
    fetch: {
      topic_diagnostics: [
        {
          tag: "HEALTHCARE",
          broker_item_count: 1,
          discovery_item_count: 0,
          discovery_capped_count: 0,
        },
      ],
      standard_topic_broker: {
        topic_diagnostics: [
          {
            tag: "HEALTHCARE",
            lane_counts: { official: 1 },
            source_counts: { cms_feed: 1 },
            source_ids: ["cms_feed"],
            item_count: 1,
            article_item_count: 1,
            official_document_count: 1,
            errors: [],
          },
        ],
      },
    },
    summary: {},
  },
  {
    ...baseDoc,
    fetch: {
      ...baseDoc.fetch,
      topic_diagnostics: [
        {
          tag: "TECHNOLOGY",
          broker_item_count: 1,
          discovery_item_count: 1,
          discovery_capped_count: 1,
        },
      ],
      standard_topic_broker: {
        enabled: true,
        topic_diagnostics: [
          {
            tag: "TECHNOLOGY",
            lane_counts: { publisher_feed: 1 },
            source_counts: { example_feed: 1 },
            source_ids: ["example_feed"],
            item_count: 1,
            article_item_count: 1,
            official_document_count: 0,
            errors: [],
          },
        ],
      },
      broker_fetch_items: [{ topic: "TECHNOLOGY", url: "https://example.com/base-selected" }],
      discovery_fetch_items: [{ topic: "TECHNOLOGY", url: "https://example.com/base-rejected" }],
    },
  },
  "TECHNOLOGY"
);

recomputeDigestAuditRollups(mergedDoc);
assert.strictEqual(mergedDoc.topics.HEALTHCARE.candidates[0].headline, "Healthcare winner");
assert.strictEqual(mergedDoc.topics.TECHNOLOGY.candidates[0].headline, "Base winner");
assert.strictEqual(mergedDoc.summary.total_selected, 2);
assert.strictEqual(mergedDoc.fetch.discovery_candidate_capped_count, 1);
assert.strictEqual(mergedDoc.partial_refresh.tag, "TECHNOLOGY");

const auditDir = path.join(process.cwd(), ".tmp", "audit-runtime-contract");
fs.rmSync(auditDir, { recursive: true, force: true });

const nonFatalLogs = [];
const auditRuntime = createDigestOrchestratorAuditRuntime({
  fs,
  path,
  digestAuditDir: auditDir,
  log: (message) => nonFatalLogs.push(message),
});

auditRuntime.writeDigestAuditLog({
  digestDateKey: "2026-04-08",
  runId: "scheduled:contract-write",
  runMode: "scheduled",
  selected: [{ url: "https://example.com/base-selected" }],
  selectionDiagnostics: {
    candidate_pool_scored: 1,
    topic_selection_audit: [
      {
        tag: "TECHNOLOGY",
        total_candidates: 1,
        selected_count: 1,
        rejected_count: 0,
        lane_breakdown: { broker_publisher_feed: 1 },
        rejection_reason_counts: {},
        candidates: [
          {
            headline: "Persisted winner",
            url: "https://example.com/base-selected",
            source: "example.com",
            lane: "broker_publisher_feed",
            _score: 0.9,
            selected: true,
          },
        ],
      },
    ],
  },
  fetchDiagnostics: {},
  enrichmentDiagnostics: {},
});

const persistedDoc = JSON.parse(fs.readFileSync(path.join(auditDir, "2026-04-08.json"), "utf8"));
assert.strictEqual(persistedDoc.topics.TECHNOLOGY.candidates[0].headline, "Persisted winner");
assert.deepStrictEqual(nonFatalLogs, []);

const scheduledFailureRuntime = createDigestOrchestratorAuditRuntime({
  fs: {
    mkdirSync() {
      throw new Error("disk full");
    },
  },
  path,
  digestAuditDir: auditDir,
  log: () => {},
});

assert.throws(() => {
  scheduledFailureRuntime.writeDigestAuditLog({
    digestDateKey: "2026-04-08",
    runId: "scheduled:contract-failure",
    runMode: "scheduled",
    selected: [],
    selectionDiagnostics: {},
    fetchDiagnostics: {},
    enrichmentDiagnostics: {},
  });
}, /disk full/);

const adminLogs = [];
const adminFailureRuntime = createDigestOrchestratorAuditRuntime({
  fs: {
    mkdirSync() {
      throw new Error("permission denied");
    },
  },
  path,
  digestAuditDir: auditDir,
  log: (message) => adminLogs.push(message),
});

adminFailureRuntime.writeDigestAuditLog({
  digestDateKey: "2026-04-08",
  runId: "admin:contract-failure",
  runMode: "admin_topic_audit_rerun",
  selected: [],
  selectionDiagnostics: {},
  fetchDiagnostics: {},
  enrichmentDiagnostics: {},
});

assert.strictEqual(adminLogs.length, 1);
assert.ok(adminLogs[0].includes("Audit log write failed (non-fatal): permission denied"));

process.stdout.write("[digest-orchestrator-audit-runtime] all assertions passed\n");
