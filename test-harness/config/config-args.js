const { MATRIX_DEFAULTS } = require("./config-constants");
const {
  buildExactFlagHandlers,
  buildPrefixFlagHandlers,
  applyPrefixToken,
} = require("./config-args-rules");

const DEFAULT_ARGS = {
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

function parseArgs(argv) {
  const args = { ...DEFAULT_ARGS };
  const exactFlags = buildExactFlagHandlers(args);
  const prefixHandlers = buildPrefixFlagHandlers(args);

  for (const token of argv) {
    const exact = exactFlags[token];
    if (exact) {
      exact();
      continue;
    }
    applyPrefixToken(token, prefixHandlers);
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
