const { JUDGE_MODELS } = require("./config-constants");

function parseNumberArg(token, prefix, min = null) {
  const value = Number(token.replace(prefix, ""));
  if (!Number.isFinite(value)) return null;
  if (min != null && value < min) return null;
  return Math.floor(value);
}

function parseTrimmedValue(token, prefix) {
  return token.replace(prefix, "").trim();
}

function createBooleanFlagHandler(args, key) {
  return () => {
    args[key] = true;
  };
}

function createNumberRule(prefix, min, applyValue) {
  return {
    prefix,
    handle: (token) => {
      const value = parseNumberArg(token, prefix, min);
      if (value != null) applyValue(value);
    },
  };
}

function createStringRule(prefix, applyValue) {
  return {
    prefix,
    handle: (token) => {
      const value = parseTrimmedValue(token, prefix);
      if (value) applyValue(value);
    },
  };
}

function buildExactFlagHandlers(args) {
  return {
    "--deterministic": createBooleanFlagHandler(args, "deterministic"),
    "--live": createBooleanFlagHandler(args, "allow_live_api"),
    "--refresh-cache": createBooleanFlagHandler(args, "refresh_cache"),
    "--offline": createBooleanFlagHandler(args, "offline_fallback"),
    "--no-judge": createBooleanFlagHandler(args, "no_judge"),
  };
}

function buildPrefixFlagHandlers(args) {
  return [
    {
      prefix: "--suite=",
      handle: (token) => {
        args.run_suite_ids = parseTrimmedValue(token, "--suite=")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      },
    },
    createNumberRule("--max-analysis-samples=", 1, (value) => {
      args.max_analysis_samples = value;
    }),
    createNumberRule("--max-depth-pairs=", 1, (value) => {
      args.max_depth_pairs = value;
    }),
    {
      prefix: "--judge-model=",
      handle: (token) => {
        const value = parseTrimmedValue(token, "--judge-model=").toLowerCase();
        if (JUDGE_MODELS[value]) args.judge_model = value;
      },
    },
    createStringRule("--matrix=", (value) => {
      args.matrix = value;
    }),
    createNumberRule("--confidence-bootstrap=", 50, (value) => {
      args.confidence_bootstrap = value;
    }),
    createStringRule("--run-label=", (value) => {
      args.run_label = value;
    }),
    createNumberRule("--analysis-calibration=", 0, (value) => {
      args.analysis_calibration_samples = value;
    }),
    createNumberRule("--freshness-max-snapshots=", 1, (value) => {
      args.freshness_max_snapshots = value;
    }),
    createNumberRule("--custom-persona-limit=", 0, (value) => {
      args.custom_persona_limit = value;
    }),
    {
      prefix: "--date-key=",
      handle: (token) => {
        const value = parseTrimmedValue(token, "--date-key=");
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) args.date_key = value;
      },
    },
  ];
}

function applyPrefixToken(token, rules) {
  for (const rule of rules) {
    if (!token.startsWith(rule.prefix)) continue;
    rule.handle(token);
    return true;
  }
  return false;
}

module.exports = {
  buildExactFlagHandlers,
  buildPrefixFlagHandlers,
  applyPrefixToken,
};
