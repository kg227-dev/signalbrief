const path = require("path");

// This module lives in test-harness/config/, so step two levels up to repo root.
const ROOT_DIR = path.join(__dirname, "..", "..");
const RESULTS_DIR = path.join(ROOT_DIR, "test-results");
const CACHE_DIR = path.join(RESULTS_DIR, "cache");
const CACHE_PERPLEXITY_DIR = path.join(CACHE_DIR, "perplexity");
const CACHE_CLAUDE_DIR = path.join(CACHE_DIR, "claude");
const BUDGET_FILE = path.join(RESULTS_DIR, "budget.json");
const IMPROVEMENT_LOG_FILE = path.join(RESULTS_DIR, "improvement-log.json");
const RUNS_DIR = RESULTS_DIR;

const BUDGET_CAP_USD = 20;

const COSTS = {
  perplexity_per_call_usd: 0.005,
  claude_in_per_mtok_usd: 0.8,
  claude_out_per_mtok_usd: 4.0,
  claude_enrichment_estimate_usd: 0.02,
  claude_judge_estimate_usd: 0.004,
};

const JUDGE_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-5",
};

const MODEL_PRICING = {
  "claude-haiku-4-5": {
    input_per_mtok_usd: 0.8,
    output_per_mtok_usd: 4.0,
    judge_estimate_usd: 0.004,
  },
  "claude-sonnet-4-5": {
    input_per_mtok_usd: 3.0,
    output_per_mtok_usd: 15.0,
    judge_estimate_usd: 0.02,
  },
};

const CONFIDENCE_GATES = {
  certification_runs_required: 3,
  suites_must_pass_all: true,
  composite_avg_min: 85,
  composite_floor_min: 75,
  core_personas_min_80_count: 8,
  topic_leak_rate_max: 0.01,
  tweaker_spearman_min: 0.65,
  relevance_anomaly_rate_max: 0.05,
  analysis_mean_min: 4.0,
  analysis_p25_min: 3.6,
  analysis_min_n: 250,
  depth_insight_min: 3.5,
  depth_padding_max: 0.2,
  depth_min_pairs: 40,
  freshness_overlap_max: 0.2,
  median_live_run_cost_max: 0.15,
};

const MATRIX_DEFAULTS = {
  total_windows: 55,
  dayparts: ["morning", "midday", "evening"],
  distinct_days_target: 7,
  max_analysis_samples: 24,
  max_depth_pairs: 8,
  confidence_bootstrap: 1000,
  refresh_every: 0,
};

const SUITE_IDS = [
  "01-topic-matching",
  "02-relevance-scoring",
  "03-analysis-quality",
  "04-diversity",
  "06-depth-control",
  "07-item-count",
  "08-cross-day-freshness",
  "09-end-to-end",
  "10-module-coverage",
];

const COMPOSITE_WEIGHTS = {
  topic_matching: 0.25,
  relevance_scoring: 0.25,
  analysis_quality: 0.3,
  diversity: 0.2,
};

function toEtDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function sanitizeCacheKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

module.exports = {
  ROOT_DIR,
  RESULTS_DIR,
  RUNS_DIR,
  CACHE_DIR,
  CACHE_PERPLEXITY_DIR,
  CACHE_CLAUDE_DIR,
  BUDGET_FILE,
  IMPROVEMENT_LOG_FILE,
  BUDGET_CAP_USD,
  COSTS,
  JUDGE_MODELS,
  MODEL_PRICING,
  CONFIDENCE_GATES,
  MATRIX_DEFAULTS,
  SUITE_IDS,
  COMPOSITE_WEIGHTS,
  toEtDateKey,
  sanitizeCacheKey,
};
