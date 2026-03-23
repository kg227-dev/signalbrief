"use strict";

const SPEND_GUARD_VERSION = 1;
const PRUNE_AFTER_HOURS = 24;

function createDigestOrchestratorSpendGuardRuntime(deps) {
  const {
    fs,
    path,
    spendGuardStatePath,
    log,
    nowProvider = () => new Date(),
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function writeJsonAtomic(filePath, payload) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(spendGuardStatePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[spend-guard] load failed: ${e.message}`);
      return { version: SPEND_GUARD_VERSION, zero_value_runs: [] };
    }
  }

  function pruneRuns(runs, nowMs) {
    const cutoff = nowMs - PRUNE_AFTER_HOURS * 60 * 60 * 1000;
    return (Array.isArray(runs) ? runs : []).filter((run) => {
      const ts = Date.parse(String(run?.ts_utc || ""));
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }

  function recordZeroValueRun(params = {}) {
    const { runId, dateEt, userId, failureClass, costUsd } = params;
    const now = nowProvider();
    const state = loadState();
    const runs = pruneRuns(state.zero_value_runs || [], now.getTime());
    runs.push({
      ts_utc: now.toISOString(),
      date_et: String(dateEt || "").trim(),
      run_id: String(runId || "").trim(),
      user_id: String(userId || "").trim(),
      failure_class: String(failureClass || "").trim(),
      cost_usd: Math.max(0, Number(costUsd || 0)),
    });
    writeJsonAtomic(spendGuardStatePath, {
      version: SPEND_GUARD_VERSION,
      updated_at: now.toISOString(),
      zero_value_runs: runs,
    });
  }

  function queryRollingZeroValueSpend(windowHours = 6) {
    const now = nowProvider();
    const cutoff = now.getTime() - Math.max(1, Number(windowHours || 6)) * 60 * 60 * 1000;
    return (loadState().zero_value_runs || []).reduce((sum, run) => {
      const ts = Date.parse(String(run?.ts_utc || ""));
      if (!Number.isFinite(ts) || ts < cutoff) return sum;
      return sum + Math.max(0, Number(run?.cost_usd || 0));
    }, 0);
  }

  function queryDailyZeroValueSpend(dateEt) {
    const target = String(dateEt || "").trim();
    return (loadState().zero_value_runs || []).reduce((sum, run) => {
      if (String(run?.date_et || "").trim() !== target) return sum;
      return sum + Math.max(0, Number(run?.cost_usd || 0));
    }, 0);
  }

  function hasUserDateZeroValueAttempt(userId, dateEt) {
    const uid = String(userId || "").trim();
    const date = String(dateEt || "").trim();
    if (!uid || !date) return false;
    return (loadState().zero_value_runs || []).some(
      (run) => String(run?.user_id || "").trim() === uid && String(run?.date_et || "").trim() === date
    );
  }

  function checkRollingWindowCap(thresholdUsd = 1.0, windowHours = 6) {
    const spent = queryRollingZeroValueSpend(windowHours);
    return { hit: spent >= Number(thresholdUsd || 0), spent, threshold: Number(thresholdUsd || 0) };
  }

  function checkDailyCap(dateEt, thresholdUsd = 2.5) {
    const spent = queryDailyZeroValueSpend(dateEt);
    return { hit: spent >= Number(thresholdUsd || 0), spent, threshold: Number(thresholdUsd || 0) };
  }

  return {
    recordZeroValueRun,
    queryRollingZeroValueSpend,
    queryDailyZeroValueSpend,
    hasUserDateZeroValueAttempt,
    checkRollingWindowCap,
    checkDailyCap,
  };
}

module.exports = { createDigestOrchestratorSpendGuardRuntime };
