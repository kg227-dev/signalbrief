#!/usr/bin/env node

const path = require("path");
const {
  RESULTS_DIR,
  MATRIX_DEFAULTS,
  writeJson,
  readJson,
} = require("./config");
const { runHarness } = require("./run-tests");

function parseCli(argv) {
  let matrixPath = null;
  const passthrough = [];

  for (const token of argv) {
    if (token.startsWith("--matrix=")) {
      matrixPath = token.replace("--matrix=", "").trim() || null;
      continue;
    }
    passthrough.push(token);
  }

  return { matrixPath, passthrough };
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
      windows: null,
    };
  }

  const full = path.isAbsolute(matrixPath)
    ? matrixPath
    : path.join(process.cwd(), matrixPath);

  const payload = readJson(full, null);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Unable to read matrix config: ${full}`);
  }

  return {
    total_windows: Number(payload.total_windows || MATRIX_DEFAULTS.total_windows),
    dayparts: Array.isArray(payload.dayparts) && payload.dayparts.length
      ? payload.dayparts
      : MATRIX_DEFAULTS.dayparts,
    distinct_days_target: Number(payload.distinct_days_target || MATRIX_DEFAULTS.distinct_days_target),
    max_analysis_samples: Number(payload.max_analysis_samples || MATRIX_DEFAULTS.max_analysis_samples),
    max_depth_pairs: Number(payload.max_depth_pairs || MATRIX_DEFAULTS.max_depth_pairs),
    confidence_bootstrap: Number(payload.confidence_bootstrap || MATRIX_DEFAULTS.confidence_bootstrap),
    refresh_every: Number(payload.refresh_every || MATRIX_DEFAULTS.refresh_every),
    windows: Array.isArray(payload.windows) ? payload.windows : null,
  };
}

function buildWindowPlan(config) {
  if (Array.isArray(config.windows) && config.windows.length) {
    return config.windows.map((w, idx) => ({
      label: String(w.label || `window-${idx + 1}`),
      run_args: Array.isArray(w.args) ? w.args : [],
      max_analysis_samples: Number(w.max_analysis_samples || config.max_analysis_samples),
      max_depth_pairs: Number(w.max_depth_pairs || config.max_depth_pairs),
    }));
  }

  const plan = [];
  const days = Math.max(1, Number(config.distinct_days_target || 1));
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
        max_analysis_samples: config.max_analysis_samples,
        max_depth_pairs: config.max_depth_pairs,
      });
      if (counter >= config.total_windows) return plan;
    }
  }

  while (plan.length < config.total_windows) {
    plan.push({
      label: `d${String((plan.length % days) + 1).padStart(2, "0")}-${dayparts[plan.length % dayparts.length]}`,
      run_args: [],
      max_analysis_samples: config.max_analysis_samples,
      max_depth_pairs: config.max_depth_pairs,
    });
  }

  return plan;
}

function allSuitesPass(payload) {
  if (!payload?.suites) return false;
  const statuses = Object.values(payload.suites).map((s) => String(s.status || "").toLowerCase());
  if (!statuses.length) return false;
  return statuses.every((s) => s === "pass");
}

function compositeAvg(payload) {
  return Number(
    payload?.suites?.["end-to-end"]?.score
      || payload?.suites?.["end_to_end"]?.score
      || payload?.suites?.["end-to-end-composite"]?.score
      || 0
  );
}

async function main() {
  const { matrixPath, passthrough } = parseCli(process.argv.slice(2));
  const matrixConfig = loadMatrixConfig(matrixPath);
  const plan = buildWindowPlan(matrixConfig);

  const runRows = [];
  for (let i = 0; i < plan.length; i++) {
    const window = plan[i];
    const refreshNow = matrixConfig.refresh_every > 0 && i > 0 && i % matrixConfig.refresh_every === 0;

    const runArgs = [
      ...passthrough,
      ...(window.run_args || []),
      `--max-analysis-samples=${Math.max(1, Number(window.max_analysis_samples || matrixConfig.max_analysis_samples))}`,
      `--max-depth-pairs=${Math.max(1, Number(window.max_depth_pairs || matrixConfig.max_depth_pairs))}`,
      `--confidence-bootstrap=${Math.max(50, Number(matrixConfig.confidence_bootstrap || MATRIX_DEFAULTS.confidence_bootstrap))}`,
      `--run-label=matrix:${window.label}`,
    ];

    if (refreshNow && !runArgs.includes("--refresh-cache") && runArgs.includes("--live")) {
      runArgs.push("--refresh-cache");
    }

    const result = await runHarness(runArgs);
    const payload = result?.report?.payload || null;

    runRows.push({
      label: window.label,
      timestamp: payload?.timestamp || new Date().toISOString(),
      run_id: payload?.run_id || null,
      suites_all_pass: allSuitesPass(payload),
      composite_avg: Number(compositeAvg(payload).toFixed(2)),
      budget_spent: Number(payload?.budget?.spent || 0),
      sample_sizes: payload?.sample_sizes || {},
    });
  }

  let certificationStreak = 0;
  for (let i = runRows.length - 1; i >= 0; i--) {
    if (!runRows[i].suites_all_pass) break;
    certificationStreak += 1;
  }

  const matrixSummary = {
    generated_at: new Date().toISOString(),
    matrix_path: matrixPath || null,
    total_windows: runRows.length,
    certification_streak: certificationStreak,
    required_streak: 3,
    ready_for_release: certificationStreak >= 3,
    runs: runRows,
  };

  const runId = matrixSummary.generated_at.replace(/[:.]/g, "-");
  const outFile = path.join(RESULTS_DIR, `matrix-${runId}.json`);
  writeJson(outFile, matrixSummary);

  console.log(`Matrix report written: ${outFile}`);
  console.log(`Certification streak: ${certificationStreak} / 3`);
}

main().catch((err) => {
  console.error("[run-matrix] fatal:", err.message);
  process.exit(1);
});
