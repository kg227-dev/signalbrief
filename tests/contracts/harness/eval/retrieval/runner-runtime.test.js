"use strict";

const assert = require("assert");
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
} = runtime;

(() => {
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
    },
    enrichResult: {
      claudeUsage: {
        input_tokens: 1000,
        output_tokens: 2000,
      },
    },
  });
  assert.strictEqual(scenarioCost.perplexityCost, 0.015);
  assert.strictEqual(scenarioCost.claudeCost, 0.0088);
  assert.strictEqual(scenarioCost.totalCost, 0.0238);

  assert.strictEqual(
    resolveEvalSelectionTarget({
      scenarioId: "standard_full",
      dueUsers: [{ topics: ["TECHNOLOGY"] }],
      baseSelectionTarget: 5,
    }),
    5
  );

  const baseline = computePersonaRawBaseline([
    {
      tag: "TECHNOLOGY",
      headline: "Enterprise AI budgets expand",
      summary: "Core technology signal.",
      source_domain: "example.com",
      source_authority: 0.8,
      published_date: "2026-03-21T06:00:00.000Z",
    },
    {
      tag: "ENERGY",
      headline: "Oil prices move",
      summary: "Off-topic for the persona.",
      source_domain: "energy.com",
      source_authority: 0.8,
      published_date: "2026-03-21T06:00:00.000Z",
    },
  ], {
    topics: ["TECHNOLOGY"],
    preferences: {},
  }, (item) => item?.source_domain || "");
  assert.strictEqual(baseline.scored.length, 1);
  assert.strictEqual(baseline.scored[0].tag, "TECHNOLOGY");
  assert.strictEqual(baseline.custom_keyword_count, 0);

  const queryPlanGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "HEALTHCARE",
      unique_item_count: 0,
      preferred_domains: ["statnews.com"],
      preferred_call_count: 1,
      broad_call_count: 1,
      remaining_broad_queries: 2,
      broad_depth_stop_reason: "global_search_budget_hard_cap",
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
  assert.strictEqual(queryPlanGap.root_cause, "query_plan_not_exhausted");
  assert.strictEqual(queryPlanGap.better_source_opportunity, "likely");
  assert.strictEqual(queryPlanGap.broad_depth_stop_reason, "global_search_budget_hard_cap");

  const deliveryPolicyGap = classifyTopicGapAudit({
    topicDiagnostic: {
      tag: "TECHNOLOGY",
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
      internal_final_quality: { item_count: 1, score: 6.1 },
      final_selected_quality: { item_count: 0, score: 0 },
      selection_lift: -22,
      delivery_policy: {
        attempt_1: {
          high_confidence_available_count: 2,
          lower_confidence_available_count: 0,
        },
      },
      delivery_policy_breakdown: {
        delivery_policy_total_item_shortfall: 1,
      },
    }],
    rejectionCounts: {},
  });
  assert.strictEqual(deliveryPolicyGap.root_cause, "delivery_policy_gate");
  assert.strictEqual(deliveryPolicyGap.failure_reason, "delivery_policy_total_item_shortfall");
})();
