#!/usr/bin/env node

const path = require("path");
const {
  RESULTS_DIR,
  MATRIX_DEFAULTS,
  IMPROVEMENT_LOG_FILE,
  writeJson,
  readJson,
} = require("./config");
const { runHarness } = require("./run-tests");
const STALLED_SIGNATURE_THRESHOLD = 3;

function parseCli(argv) {
  let matrixPath = null;
  let allowStalledRerun = false;
  let stalledThreshold = STALLED_SIGNATURE_THRESHOLD;
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
    if (token.startsWith("--stalled-threshold=")) {
      const raw = Number(token.replace("--stalled-threshold=", "").trim());
      if (Number.isFinite(raw) && raw >= 1) stalledThreshold = Math.max(1, Math.floor(raw));
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
    stalledThreshold,
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

function buildOpenSignature(payload) {
  const suites = payload?.suites && typeof payload.suites === "object" ? payload.suites : {};
  const parts = Object.entries(suites)
    .map(([suiteId, suite]) => ({
      suiteId,
      status: String(suite?.status || "").toLowerCase(),
    }))
    .filter((row) => row.status === "fail" || row.status === "warn")
    .sort((a, b) => a.suiteId.localeCompare(b.suiteId))
    .map((row) => `${row.suiteId}:${row.status}`);
  return parts.length ? parts.join("|") : "all_pass";
}

function readImprovementLogEntries() {
  const raw = readJson(IMPROVEMENT_LOG_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function writeImprovementLogEntries(entries) {
  writeJson(IMPROVEMENT_LOG_FILE, Array.isArray(entries) ? entries : []);
}

function hasAcknowledgedSignature(entries, signature) {
  const target = String(signature || "").trim();
  if (!target || target === "all_pass") return true;
  return entries.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (String(entry.type || "") !== "matrix_signature_ack") return false;
    if (String(entry.signature || "") !== target) return false;
    const state = String(entry.state || "active").toLowerCase();
    return state !== "revoked";
  });
}

function appendSignatureAck(entries, signature, note = "") {
  const existing = Array.isArray(entries) ? entries.slice() : [];
  existing.push({
    type: "matrix_signature_ack",
    signature: String(signature || "").trim(),
    note: String(note || "").trim() || "acknowledged by operator",
    acknowledged_at: new Date().toISOString(),
    state: "active",
  });
  return existing;
}

async function main() {
  const {
    matrixPath,
    passthrough,
    allowStalledRerun,
    stalledThreshold,
    ackSignature,
    ackNote,
  } = parseCli(process.argv.slice(2));
  const matrixConfig = loadMatrixConfig(matrixPath);
  const plan = buildWindowPlan(matrixConfig);
  let improvementLog = readImprovementLogEntries();

  if (ackSignature) {
    improvementLog = appendSignatureAck(improvementLog, ackSignature, ackNote);
    writeImprovementLogEntries(improvementLog);
    console.log(`[run-matrix] acknowledged signature: ${ackSignature}`);
  }

  const runRows = [];
  let priorSignature = null;
  let stalledCount = 0;
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
    const openSignature = buildOpenSignature(payload);
    if (openSignature === "all_pass") {
      priorSignature = null;
      stalledCount = 0;
    } else if (openSignature === priorSignature) {
      stalledCount += 1;
    } else {
      priorSignature = openSignature;
      stalledCount = 1;
    }

    runRows.push({
      label: window.label,
      timestamp: payload?.timestamp || new Date().toISOString(),
      run_id: payload?.run_id || null,
      suites_all_pass: allSuitesPass(payload),
      composite_avg: Number(compositeAvg(payload).toFixed(2)),
      budget_spent: Number(payload?.budget?.spent || 0),
      sample_sizes: payload?.sample_sizes || {},
      open_signature: openSignature,
      stalled_signature_windows: openSignature === "all_pass" ? 0 : stalledCount,
    });

    if (
      openSignature !== "all_pass"
      && stalledCount >= Math.max(1, Number(stalledThreshold || STALLED_SIGNATURE_THRESHOLD))
      && !allowStalledRerun
      && !hasAcknowledgedSignature(improvementLog, openSignature)
    ) {
      throw new Error(
        `Matrix guardrail: fail/warn signature persisted for ${stalledCount} windows (${openSignature}). `
        + `Acknowledge an improvement plan before rerunning: `
        + `node test-harness/run-matrix.js --ack-signature="${openSignature}" --ack-note="<what changed>" `
        + `or override once with --allow-stalled-rerun`
      );
    }
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
