"use strict";

const path = require("path");
const { resolveSignalBriefRuntimePaths } = require("../../runtime/runtime-state-paths-runtime");
const {
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_BUDGET_RESERVE_USD,
  EVAL_VERSION,
} = require("./constants-runtime");

function safeParseJson(fs, filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(fs, dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function writeJsonAtomic(fs, filePath, payload) {
  ensureDir(fs, path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

function sanitizeRunSummary(raw = {}) {
  return {
    run_id: String(raw.run_id || "").trim(),
    status: String(raw.status || "unknown").trim(),
    started_at: String(raw.started_at || "").trim() || null,
    completed_at: String(raw.completed_at || "").trim() || null,
    scenario_count: Math.max(0, Number(raw.scenario_count || 0)),
    budget_spent_usd: Number(raw.budget_spent_usd || 0),
    overall_score: Number(raw.overall_score || 0),
    strongest_band: String(raw.strongest_band || "").trim() || null,
    weakest_band: String(raw.weakest_band || "").trim() || null,
  };
}

function normalizeBudget(raw = {}) {
  const cap = Number(raw.cap_usd);
  const reserve = Number(raw.reserve_usd);
  const spent = Number(raw.spent_usd);
  const normalized = {
    version: EVAL_VERSION,
    cap_usd: Number.isFinite(cap) ? cap : DEFAULT_BUDGET_CAP_USD,
    reserve_usd: Number.isFinite(reserve) ? reserve : DEFAULT_BUDGET_RESERVE_USD,
    spent_usd: Number.isFinite(spent) ? spent : 0,
    remaining_usd: 0,
    calls: Array.isArray(raw.calls) ? raw.calls : [],
    stop_reason: String(raw.stop_reason || "").trim() || null,
  };
  normalized.remaining_usd = Math.max(0, Number((normalized.cap_usd - normalized.spent_usd).toFixed(6)));
  return normalized;
}

function createRetrievalEvalStorageRuntime(options = {}) {
  const fs = options.fs || require("fs");
  const runtimePaths = resolveSignalBriefRuntimePaths({
    appRoot: options.appRoot,
    env: options.env,
    nodeEnv: options.nodeEnv,
  });
  const rootDir = options.rootDir
    ? path.resolve(String(options.rootDir))
    : path.join(runtimePaths.dataDir, "retrieval-evals");
  const runsDir = path.join(rootDir, "runs");
  const indexPath = path.join(rootDir, "index.json");
  const budgetPath = path.join(rootDir, "budget.json");
  const activeRunPath = path.join(rootDir, "active-run.json");

  function ensureRoot() {
    ensureDir(fs, rootDir);
    ensureDir(fs, runsDir);
    return rootDir;
  }

  function loadIndex() {
    ensureRoot();
    const parsed = safeParseJson(fs, indexPath, null);
    if (!parsed || !Array.isArray(parsed.runs)) {
      return {
        version: EVAL_VERSION,
        updated_at: null,
        runs: [],
      };
    }
    return {
      version: EVAL_VERSION,
      updated_at: String(parsed.updated_at || "").trim() || null,
      runs: parsed.runs.map(sanitizeRunSummary).filter((row) => row.run_id),
    };
  }

  function saveIndex(index) {
    const next = {
      version: EVAL_VERSION,
      updated_at: new Date().toISOString(),
      runs: (Array.isArray(index?.runs) ? index.runs : []).map(sanitizeRunSummary).filter((row) => row.run_id),
    };
    writeJsonAtomic(fs, indexPath, next);
    return next;
  }

  function loadBudget() {
    ensureRoot();
    const budget = normalizeBudget(safeParseJson(fs, budgetPath, null) || {});
    writeJsonAtomic(fs, budgetPath, budget);
    return budget;
  }

  function saveBudget(budget) {
    const normalized = normalizeBudget(budget);
    writeJsonAtomic(fs, budgetPath, normalized);
    return normalized;
  }

  function runPath(runId) {
    const safeId = String(runId || "").trim().replace(/[^a-zA-Z0-9._:-]+/g, "_");
    return path.join(runsDir, `${safeId}.json`);
  }

  function saveRun(run) {
    ensureRoot();
    writeJsonAtomic(fs, runPath(run?.run_id), run);
    const index = loadIndex();
    const summary = sanitizeRunSummary({
      run_id: run?.run_id,
      status: run?.status,
      started_at: run?.started_at,
      completed_at: run?.completed_at,
      scenario_count: Array.isArray(run?.scenarios) ? run.scenarios.length : 0,
      budget_spent_usd: Number(run?.budget?.spent_usd || 0),
      overall_score: Number(run?.overall_summary?.overall_score || 0),
      strongest_band: String(run?.overall_summary?.strongest_band || "").trim() || null,
      weakest_band: String(run?.overall_summary?.weakest_band || "").trim() || null,
    });
    const existing = index.runs.filter((row) => row.run_id !== summary.run_id);
    existing.unshift(summary);
    index.runs = existing.slice(0, 50);
    saveIndex(index);
    return run;
  }

  function loadRun(runId) {
    ensureRoot();
    return safeParseJson(fs, runPath(runId), null);
  }

  function listRuns(limit = 20) {
    return loadIndex().runs.slice(0, Math.max(1, Number(limit || 20)));
  }

  function saveActiveRun(payload) {
    ensureRoot();
    writeJsonAtomic(fs, activeRunPath, payload || null);
    return payload;
  }

  function loadActiveRun() {
    ensureRoot();
    return safeParseJson(fs, activeRunPath, null);
  }

  function clearActiveRun() {
    ensureRoot();
    writeJsonAtomic(fs, activeRunPath, null);
    return null;
  }

  return {
    rootDir,
    runsDir,
    indexPath,
    budgetPath,
    activeRunPath,
    clearActiveRun,
    ensureRoot,
    listRuns,
    loadActiveRun,
    loadBudget,
    loadIndex,
    loadRun,
    runPath,
    saveActiveRun,
    saveBudget,
    saveIndex,
    saveRun,
  };
}

module.exports = {
  createRetrievalEvalStorageRuntime,
  normalizeBudget,
};
