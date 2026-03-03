const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
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
  "05-custom-topics",
  "06-depth-control",
  "07-item-count",
  "08-cross-day-freshness",
  "09-end-to-end",
];

const COMPOSITE_WEIGHTS = {
  topic_matching: 0.25,
  relevance_scoring: 0.2,
  analysis_quality: 0.3,
  diversity: 0.15,
  custom_topics: 0.1,
};

function etDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function sanitizeCacheKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function ensureHarnessPaths() {
  [RESULTS_DIR, CACHE_DIR, CACHE_PERPLEXITY_DIR, CACHE_CLAUDE_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function parseArgs(argv) {
  const args = {
    allow_live_api: false,
    refresh_cache: false,
    offline_fallback: false,
    run_suite_ids: null,
    no_judge: false,
    max_analysis_samples: 12,
    max_depth_pairs: 5,
    judge_model: "haiku",
    matrix: null,
    confidence_bootstrap: MATRIX_DEFAULTS.confidence_bootstrap,
    run_label: null,
  };

  for (const token of argv) {
    if (token === "--live") args.allow_live_api = true;
    else if (token === "--refresh-cache") args.refresh_cache = true;
    else if (token === "--offline") args.offline_fallback = true;
    else if (token === "--no-judge") args.no_judge = true;
    else if (token.startsWith("--suite=")) {
      const list = token
        .replace("--suite=", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      args.run_suite_ids = list;
    } else if (token.startsWith("--max-analysis-samples=")) {
      const n = Number(token.replace("--max-analysis-samples=", ""));
      if (Number.isFinite(n) && n > 0) args.max_analysis_samples = Math.floor(n);
    } else if (token.startsWith("--max-depth-pairs=")) {
      const n = Number(token.replace("--max-depth-pairs=", ""));
      if (Number.isFinite(n) && n > 0) args.max_depth_pairs = Math.floor(n);
    } else if (token.startsWith("--judge-model=")) {
      const raw = token.replace("--judge-model=", "").trim().toLowerCase();
      if (JUDGE_MODELS[raw]) args.judge_model = raw;
    } else if (token.startsWith("--matrix=")) {
      const raw = token.replace("--matrix=", "").trim();
      if (raw) args.matrix = raw;
    } else if (token.startsWith("--confidence-bootstrap=")) {
      const n = Number(token.replace("--confidence-bootstrap=", ""));
      if (Number.isFinite(n) && n > 49) args.confidence_bootstrap = Math.floor(n);
    } else if (token.startsWith("--run-label=")) {
      const raw = token.replace("--run-label=", "").trim();
      if (raw) args.run_label = raw;
    }
  }

  if (args.refresh_cache && !args.allow_live_api) {
    throw new Error("--refresh-cache requires --live");
  }

  return args;
}

function loadAppConfig() {
  const configPath = path.join(ROOT_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("config.json not found. Copy config.example.json and fill API keys first.");
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
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
  etDateKey,
  sanitizeCacheKey,
  ensureHarnessPaths,
  readJson,
  writeJson,
  parseArgs,
  loadAppConfig,
};
