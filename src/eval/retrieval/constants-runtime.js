"use strict";

const { qualityBand } = require("../../runtime/quality-score");

const EVAL_VERSION = 1;
const DEFAULT_BUDGET_CAP_USD = 25;
const DEFAULT_BUDGET_RESERVE_USD = 5;
const DEFAULT_SCENARIOS = Object.freeze([
  "standard_full",
  "standard_core",
  "standard_phase1",
  "standard_phase1_focus",
]);
const DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT = 8;

const SOURCE_EVAL_FORMULA = Object.freeze({
  item: Object.freeze({
    credibility_weight: 0.35,
    relevance_weight: 0.30,
    freshness_weight: 0.25,
    preferred_weight: 0.10,
    weak_penalty_weight: 0.20,
  }),
  set_quality: Object.freeze({
    item_score_weight: 0.30,
    relevance_weight: 0.25,
    freshness_weight: 0.25,
    preferred_hit_rate_weight: 0.10,
    inverse_weak_source_rate_weight: 0.10,
  }),
  freshness_buckets: Object.freeze({
    le_24h: 100,
    le_48h: 75,
    le_72h: 40,
    unknown: 50,
    gt_72h: 0,
  }),
});

const CURRENT_DQS_FORMULA = Object.freeze({
  standard: "0.25T + 0.18R + 0.25A + 0.12F + 0.10C + 0.10N",
  headline_only: "0.37T + 0.25R + 0.00A + 0.18F + 0.10C + 0.10N",
  bands: Object.freeze({
    strong: ">=85",
    watch: ">=75",
    poor: "<75",
  }),
  source_labels: Object.freeze({
    strong: "strong",
    watch: "watch",
    poor: "poor",
  }),
});

const SOURCE_EVAL_BANDS = Object.freeze({
  strong: 80,
  decent: 68,
});

function sourceEvalBand(score) {
  const value = Number(score) || 0;
  if (value >= SOURCE_EVAL_BANDS.strong) return "strong";
  if (value >= SOURCE_EVAL_BANDS.decent) return "decent";
  return "weak";
}

module.exports = {
  CURRENT_DQS_FORMULA,
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_BUDGET_RESERVE_USD,
  DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT,
  DEFAULT_SCENARIOS,
  EVAL_VERSION,
  SOURCE_EVAL_BANDS,
  SOURCE_EVAL_FORMULA,
  qualityBand,
  sourceEvalBand,
};
