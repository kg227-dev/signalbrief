"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/runner-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  budgetGuardStatus,
  buildScenarioEstimate,
  classifyTopicGapAudit,
  computeScenarioCost,
  computePersonaRawBaseline,
  resolveEvalSelectionTarget,
  runRetrievalEval,
} = runtime;
const { createRetrievalEvalStorageRuntime } = require(path.join(process.cwd(), "src/eval/retrieval/storage-runtime.js"));

(async () => {
  const guard = budgetGuardStatus({
    remaining_usd: 6,
    reserve_usd: 5,
  }, 1.2);
  assert.strictEqual(guard.ok, false);
  assert.strictEqual(guard.remaining_after_reserve_usd, 1);

  const estimate = buildScenarioEstimate({
    CONFIG: {
      digest: {
        search_budget: {
          scheduled: { hard_calls: 2 },
        },
      },
    },
  }, {
    dueUsers: [{ chatId: "one" }, { chatId: "two" }],
  });
  assert.strictEqual(estimate, 0.091);

  const scenarioCost = computeScenarioCost({
    fetchResult: {
      standardFetchCalls: 3,
      customFetchCalls: 2,
    },
    enrichResult: {
      claudeUsage: {
        input_tokens: 1000,
        output_tokens: 2000,
      },
    },
  });
  assert.strictEqual(scenarioCost.perplexityCost, 0.025);
  assert.strictEqual(scenarioCost.claudeCost, 0.0088);
  assert.strictEqual(scenarioCost.totalCost, 0.0338);

  const baseline = computePersonaRawBaseline([
    {
      tag: "STRATEGY",
      headline: "General corporate restructuring update",
      summary: "Off-topic for the custom keyword.",
      source_authority: 0.8,
      published_date: "2026-03-21T06:00:00.000Z",
    },
    {
      tag: "NVIDIA",
      headline: "Nvidia Blackwell demand accelerates",
      summary: "Direct custom-keyword coverage.",
      source_authority: 0.8,
      published_date: "2026-03-21T06:00:00.000Z",
    },
  ], {
    topics: ["STRATEGY", "custom_nvidia"],
    topic_weights: {},
    preferences: { items_per_digest: 5 },
  }, (item) => item?.source_domain || "");
  assert.strictEqual(baseline.scored.length, 1);
  assert.strictEqual(baseline.scored[0].tag, "NVIDIA");
  assert.strictEqual(baseline.custom_keyword_count, 1);

  const preferredOnlyGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "GLP 1",
      custom_slug: "custom_glp_1",
      is_custom: true,
      unique_item_count: 0,
      preferred_domains: ["fda.gov", "statnews.com"],
      preferred_call_count: 2,
      broad_call_count: 0,
      status_counts: {},
      failed_calls: 0,
      transport_errors: 0,
      degraded: false,
      preferred_search_result_hit_count: 0,
      preferred_item_count: 0,
    },
    matchingPersonaResults: [{
      requested_count: 5,
      candidate_pool_count: 0,
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: 0,
    }],
    rejectionCounts: {},
  });
  assert.strictEqual(preferredOnlyGap.root_cause, "preferred_only_query_design");
  assert.strictEqual(preferredOnlyGap.better_source_opportunity, "likely");

  const ambiguityGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "AGENTIC AI",
      custom_slug: "custom_agentic_ai",
      is_custom: true,
      unique_item_count: 2,
      preferred_domains: ["theinformation.com"],
      preferred_call_count: 1,
      broad_call_count: 1,
      status_counts: {},
      failed_calls: 0,
      transport_errors: 0,
      degraded: false,
      preferred_search_result_hit_count: 1,
      preferred_item_count: 1,
    },
    matchingPersonaResults: [{
      requested_count: 5,
      candidate_pool_count: 0,
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: 0,
    }],
    rejectionCounts: {},
  });
  assert.strictEqual(ambiguityGap.root_cause, "keyword_ambiguity_or_off_topic_query");
  assert.strictEqual(ambiguityGap.better_source_opportunity, "likely");

  const unexhaustedGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "HEALTHCARE",
      is_custom: false,
      unique_item_count: 0,
      preferred_domains: ["statnews.com"],
      preferred_call_count: 1,
      broad_call_count: 1,
      remaining_broad_queries: 2,
      status_counts: {},
      failed_calls: 0,
      transport_errors: 0,
      degraded: false,
      preferred_search_result_hit_count: 0,
      preferred_item_count: 0,
    },
    matchingPersonaResults: [{
      requested_count: 5,
      candidate_pool_count: 0,
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: -10,
    }],
    rejectionCounts: {},
  });
  assert.strictEqual(unexhaustedGap.root_cause, "query_plan_not_exhausted");
  assert.strictEqual(unexhaustedGap.better_source_opportunity, "likely");

  const selectionCapGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "GRID INFRASTRUCTURE",
      custom_slug: "custom_grid_infrastructure",
      is_custom: true,
      unique_item_count: 1,
      preferred_domains: ["utilitydive.com"],
      preferred_call_count: 1,
      broad_call_count: 3,
      remaining_broad_queries: 1,
      status_counts: {},
      failed_calls: 0,
      transport_errors: 0,
      degraded: false,
      preferred_search_result_hit_count: 0,
      preferred_item_count: 0,
    },
    matchingPersonaResults: [{
      requested_count: 5,
      candidate_pool_count: 1,
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: -72.78,
    }],
    rejectionCounts: {
      selection_custom_cap: 1,
    },
  });
  assert.strictEqual(selectionCapGap.root_cause, "selection_custom_cap");
  assert.strictEqual(selectionCapGap.failure_reason, "selection_custom_cap");

  const deliveryPolicyGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "TECHNOLOGY",
      is_custom: false,
      unique_item_count: 2,
      preferred_domains: ["cio.com"],
      preferred_call_count: 1,
      broad_call_count: 1,
      remaining_broad_queries: 2,
      status_counts: {},
      failed_calls: 0,
      transport_errors: 0,
      degraded: false,
      preferred_search_result_hit_count: 1,
      preferred_item_count: 1,
    },
    matchingPersonaResults: [{
      requested_count: 5,
      candidate_pool_count: 2,
      internal_final_quality: { item_count: 2, score: 76 },
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: -10,
      delivery_policy_breakdown: {
        delivery_policy_total_item_shortfall: 1,
      },
      ranking_gate_breakdown: {},
      final_gate_breakdown: {
        delivery_policy_total_item_shortfall: 1,
      },
      primary_final_gate_reason: "delivery_policy_total_item_shortfall",
    }],
    rejectionCounts: {},
  });
  assert.strictEqual(deliveryPolicyGap.root_cause, "delivery_policy_gate");
  assert.strictEqual(deliveryPolicyGap.failure_reason, "delivery_policy_total_item_shortfall");

  const expandedEvalSelectionTarget = resolveEvalSelectionTarget({
    scenarioId: "custom_realistic",
    baseSelectionTarget: 5,
    dueUsers: [
      { topics: ["STRATEGY", "custom_nvidia"] },
      { topics: ["STRATEGY", "custom_glp_1"] },
      { topics: ["STRATEGY", "custom_agentic_ai"] },
      { topics: ["STRATEGY", "custom_sec_rulemaking"] },
      { topics: ["STRATEGY", "custom_cbam"] },
      { topics: ["STRATEGY", "custom_rate_cuts"] },
      { topics: ["STRATEGY", "custom_grid_infrastructure"] },
      { topics: ["STRATEGY", "custom_semicap"] },
    ],
  });
  assert.strictEqual(expandedEvalSelectionTarget, 8);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-retrieval-eval-runner-"));
  const storage = createRetrievalEvalStorageRuntime({
    fs,
    rootDir: tempDir,
    appRoot: process.cwd(),
  });
  const services = {
    CONFIG: {
      digest: {
        search_budget: {
          scheduled: { hard_calls: 2 },
        },
      },
    },
    runtimePaths: { appRoot: process.cwd() },
    sourceRegistryRuntime: {
      loadSourceRegistry: () => ({ version: 1, domains: {}, identities: {} }),
      buildRegistryMap: () => ({ domains: new Map(), identities: new Map() }),
    },
    preferredSourceRegistryRuntime: {
      loadPreferredSourceRegistry: () => ({ version: 1, global: { reported: [], official: [] }, topics: {} }),
    },
    deliveryRecordRuntime: {
      loadAllCurrentRecords: () => [],
    },
  };

  const result = await runRetrievalEval({
    runId: "retrieval-eval:test-budget-stop",
    resetBudget: true,
    budgetCapUsd: 0.05,
    budgetReserveUsd: 0,
    scenarioDefs: [{
      id: "budget_stop",
      label: "budget stop",
      dueUsers: [{ chatId: "eval-budget-stop", preferences: { items_per_digest: 5 } }],
      personaCount: 1,
    }],
    services,
    storage,
  });

  assert.strictEqual(result.status, "completed");
  assert.strictEqual(result.delivery_disabled, true);
  assert.deepStrictEqual(result.transport_channels_disabled, ["email", "telegram"]);
  assert.strictEqual(result.budget.stop_reason, "budget_cap_before:budget_stop");
  assert.strictEqual(result.scenarios.length, 0);
  assert.ok(result.recommendations.some((row) => String(row).includes("Stopped before")));
  assert.strictEqual(storage.loadRun("retrieval-eval:test-budget-stop").status, "completed");

  process.stdout.write("[retrieval-runner-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
