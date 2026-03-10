const path = require("path");
const {
  MATRIX_DEFAULTS,
  CONFIDENCE_GATES,
  readJson,
} = require("../config");

const STALLED_SIGNATURE_THRESHOLD = 3;
const HARD_FAIL_STREAK_THRESHOLD = 3;

function parseFiniteNumber(raw, fallback, opts = {}) {
  const fallbackValue = Number(fallback);
  let value = Number(raw);
  if (!Number.isFinite(value)) {
    value = Number.isFinite(fallbackValue) ? fallbackValue : 0;
  }

  if (opts.integer !== false) {
    value = Math.floor(value);
  }
  if (Number.isFinite(Number(opts.min))) {
    value = Math.max(Number(opts.min), value);
  }
  if (Number.isFinite(Number(opts.max))) {
    value = Math.min(Number(opts.max), value);
  }
  return value;
}

function parseCli(argv) {
  let matrixPath = null;
  let allowStalledRerun = false;
  let allowHardFailRerun = false;
  let allowUnrecoverablePath = false;
  let stalledThreshold = null;
  let hardFailThreshold = null;
  let requiredStreak = null;
  let ackSignature = null;
  let ackNote = "";
  const passthrough = [];

  for (const token of argv) {
    if (token.startsWith("--matrix=")) {
      matrixPath = token.replace("--matrix=", "").trim() || null;
      continue;
    }
    if (token === "--allow-stalled-rerun") {
      allowStalledRerun = true;
      continue;
    }
    if (token === "--allow-hard-fail-rerun") {
      allowHardFailRerun = true;
      continue;
    }
    if (token === "--allow-unrecoverable-path") {
      allowUnrecoverablePath = true;
      continue;
    }
    if (token.startsWith("--stalled-threshold=")) {
      const raw = Number(token.replace("--stalled-threshold=", "").trim());
      if (Number.isFinite(raw) && raw >= 1) {
        stalledThreshold = Math.max(1, Math.floor(raw));
      }
      continue;
    }
    if (token.startsWith("--hard-fail-threshold=")) {
      const raw = Number(token.replace("--hard-fail-threshold=", "").trim());
      if (Number.isFinite(raw) && raw >= 1) {
        hardFailThreshold = Math.max(1, Math.floor(raw));
      }
      continue;
    }
    if (token.startsWith("--required-streak=")) {
      const raw = Number(token.replace("--required-streak=", "").trim());
      if (Number.isFinite(raw) && raw >= 1) {
        requiredStreak = Math.max(1, Math.floor(raw));
      }
      continue;
    }
    if (token.startsWith("--ack-signature=")) {
      ackSignature = token.replace("--ack-signature=", "").trim() || null;
      continue;
    }
    if (token.startsWith("--ack-note=")) {
      ackNote = token.replace("--ack-note=", "").trim();
      continue;
    }
    passthrough.push(token);
  }

  return {
    matrixPath,
    allowStalledRerun,
    allowHardFailRerun,
    allowUnrecoverablePath,
    stalledThreshold,
    hardFailThreshold,
    requiredStreak,
    ackSignature,
    ackNote,
    passthrough,
  };
}

function loadMatrixConfig(matrixPath) {
  if (!matrixPath) {
    return {
      total_windows: MATRIX_DEFAULTS.total_windows,
      dayparts: MATRIX_DEFAULTS.dayparts,
      distinct_days_target: MATRIX_DEFAULTS.distinct_days_target,
      max_analysis_samples: MATRIX_DEFAULTS.max_analysis_samples,
      max_depth_pairs: MATRIX_DEFAULTS.max_depth_pairs,
      confidence_bootstrap: MATRIX_DEFAULTS.confidence_bootstrap,
      refresh_every: MATRIX_DEFAULTS.refresh_every,
      stalled_signature_threshold: STALLED_SIGNATURE_THRESHOLD,
      hard_fail_streak_threshold: HARD_FAIL_STREAK_THRESHOLD,
      required_streak: Math.max(1, Number(CONFIDENCE_GATES?.certification_runs_required || 3)),
      windows: null,
    };
  }

  const fullPath = path.isAbsolute(matrixPath)
    ? matrixPath
    : path.join(process.cwd(), matrixPath);

  const payload = readJson(fullPath, null);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Unable to read matrix config: ${fullPath}`);
  }

  return {
    total_windows: parseFiniteNumber(payload.total_windows, MATRIX_DEFAULTS.total_windows, { min: 1, max: 365 }),
    dayparts: Array.isArray(payload.dayparts) && payload.dayparts.length
      ? payload.dayparts
      : MATRIX_DEFAULTS.dayparts,
    distinct_days_target: parseFiniteNumber(payload.distinct_days_target, MATRIX_DEFAULTS.distinct_days_target, { min: 1, max: 31 }),
    max_analysis_samples: parseFiniteNumber(payload.max_analysis_samples, MATRIX_DEFAULTS.max_analysis_samples, { min: 1, max: 500 }),
    max_depth_pairs: parseFiniteNumber(payload.max_depth_pairs, MATRIX_DEFAULTS.max_depth_pairs, { min: 1, max: 200 }),
    confidence_bootstrap: parseFiniteNumber(payload.confidence_bootstrap, MATRIX_DEFAULTS.confidence_bootstrap, { min: 50, max: 20000 }),
    refresh_every: parseFiniteNumber(payload.refresh_every, MATRIX_DEFAULTS.refresh_every, { min: 0, max: 1000 }),
    stalled_signature_threshold: parseFiniteNumber(payload.stalled_signature_threshold, STALLED_SIGNATURE_THRESHOLD, { min: 1, max: 100 }),
    hard_fail_streak_threshold: parseFiniteNumber(payload.hard_fail_streak_threshold, HARD_FAIL_STREAK_THRESHOLD, { min: 1, max: 100 }),
    required_streak: parseFiniteNumber(payload.required_streak, CONFIDENCE_GATES?.certification_runs_required || 3, { min: 1, max: 50 }),
    windows: Array.isArray(payload.windows) ? payload.windows : null,
  };
}

function buildWindowPlan(config) {
  if (Array.isArray(config.windows) && config.windows.length) {
    return config.windows.map((window, index) => ({
      label: String(window.label || `window-${index + 1}`),
      run_args: Array.isArray(window.args) ? window.args : [],
      max_analysis_samples: parseFiniteNumber(window.max_analysis_samples, config.max_analysis_samples, { min: 1, max: 500 }),
      max_depth_pairs: parseFiniteNumber(window.max_depth_pairs, config.max_depth_pairs, { min: 1, max: 200 }),
    }));
  }

  const plan = [];
  const days = parseFiniteNumber(config.distinct_days_target, 1, { min: 1, max: 31 });
  const dayparts = Array.isArray(config.dayparts) && config.dayparts.length
    ? config.dayparts
    : ["window"];

  let counter = 0;
  for (let day = 1; day <= days; day++) {
    for (const part of dayparts) {
      counter += 1;
      plan.push({
        label: `d${String(day).padStart(2, "0")}-${part}`,
        run_args: [],
        max_analysis_samples: parseFiniteNumber(config.max_analysis_samples, MATRIX_DEFAULTS.max_analysis_samples, { min: 1, max: 500 }),
        max_depth_pairs: parseFiniteNumber(config.max_depth_pairs, MATRIX_DEFAULTS.max_depth_pairs, { min: 1, max: 200 }),
      });
      if (counter >= config.total_windows) return plan;
    }
  }

  while (plan.length < config.total_windows) {
    plan.push({
      label: `d${String((plan.length % days) + 1).padStart(2, "0")}-${dayparts[plan.length % dayparts.length]}`,
      run_args: [],
      max_analysis_samples: parseFiniteNumber(config.max_analysis_samples, MATRIX_DEFAULTS.max_analysis_samples, { min: 1, max: 500 }),
      max_depth_pairs: parseFiniteNumber(config.max_depth_pairs, MATRIX_DEFAULTS.max_depth_pairs, { min: 1, max: 200 }),
    });
  }

  return plan;
}

function buildWindowArgs({ window, matrixConfig, passthrough, refreshNow }) {
  const analysisSamples = parseFiniteNumber(
    window.max_analysis_samples,
    matrixConfig.max_analysis_samples,
    { min: 1, max: 500 }
  );
  const depthPairs = parseFiniteNumber(
    window.max_depth_pairs,
    matrixConfig.max_depth_pairs,
    { min: 1, max: 200 }
  );
  const bootstrapIterations = parseFiniteNumber(
    matrixConfig.confidence_bootstrap,
    MATRIX_DEFAULTS.confidence_bootstrap,
    { min: 50, max: 20000 }
  );
  const args = [
    ...passthrough,
    ...(window.run_args || []),
    `--max-analysis-samples=${analysisSamples}`,
    `--max-depth-pairs=${depthPairs}`,
    `--confidence-bootstrap=${bootstrapIterations}`,
    `--run-label=matrix:${window.label}`,
  ];

  if (refreshNow && !args.includes("--refresh-cache") && args.includes("--live")) {
    args.push("--refresh-cache");
  }

  return args;
}

module.exports = {
  STALLED_SIGNATURE_THRESHOLD,
  HARD_FAIL_STREAK_THRESHOLD,
  parseFiniteNumber,
  parseCli,
  loadMatrixConfig,
  buildWindowPlan,
  buildWindowArgs,
};
