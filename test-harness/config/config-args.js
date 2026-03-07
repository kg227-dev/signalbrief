const { JUDGE_MODELS, MATRIX_DEFAULTS } = require("./config-constants");

function parseArgs(argv) {
  const args = {
    deterministic: false,
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
    analysis_calibration_samples: 0,
    freshness_max_snapshots: 120,
    custom_persona_limit: 0,
    date_key: null,
  };

  for (const token of argv) {
    if (token === "--deterministic") args.deterministic = true;
    if (token === "--live") args.allow_live_api = true;
    else if (token === "--refresh-cache") args.refresh_cache = true;
    else if (token === "--offline") args.offline_fallback = true;
    else if (token === "--no-judge") args.no_judge = true;
    else if (token.startsWith("--suite=")) {
      const list = token
        .replace("--suite=", "")
        .split(",")
        .map((value) => value.trim())
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
    } else if (token.startsWith("--analysis-calibration=")) {
      const n = Number(token.replace("--analysis-calibration=", ""));
      if (Number.isFinite(n) && n >= 0) args.analysis_calibration_samples = Math.floor(n);
    } else if (token.startsWith("--freshness-max-snapshots=")) {
      const n = Number(token.replace("--freshness-max-snapshots=", ""));
      if (Number.isFinite(n) && n > 0) args.freshness_max_snapshots = Math.floor(n);
    } else if (token.startsWith("--custom-persona-limit=")) {
      const n = Number(token.replace("--custom-persona-limit=", ""));
      if (Number.isFinite(n) && n >= 0) args.custom_persona_limit = Math.floor(n);
    } else if (token.startsWith("--date-key=")) {
      const raw = token.replace("--date-key=", "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) args.date_key = raw;
    }
  }

  if (args.refresh_cache && !args.allow_live_api) {
    throw new Error("--refresh-cache requires --live");
  }

  if (args.deterministic) {
    if (args.allow_live_api) {
      throw new Error("--deterministic cannot be combined with --live");
    }
    if (args.refresh_cache) {
      throw new Error("--deterministic cannot be combined with --refresh-cache");
    }
    args.allow_live_api = false;
    args.refresh_cache = false;
    args.no_judge = true;
    args.offline_fallback = true;
    if (!args.run_label) args.run_label = "deterministic";
  }

  return args;
}

module.exports = {
  parseArgs,
};
