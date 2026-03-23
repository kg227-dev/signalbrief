"use strict";

const CB_STATUS_OPEN = "OPEN";
const CB_STATUS_CLOSED = "CLOSED";
const CB_VERSION = 1;

function createDigestOrchestratorCircuitBreakerRuntime(deps) {
  const {
    fs,
    path,
    circuitBreakerStatePath,
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

  function emptyState() {
    return {
      version: CB_VERSION,
      status: CB_STATUS_CLOSED,
      opened_at: null,
      opened_reason: null,
      triggered_by: null,
      date_et: null,
      recent_zero_serve_runs: [],
      updated_at: null,
    };
  }

  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(circuitBreakerStatePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[circuit-breaker] load failed: ${e.message}`);
      return emptyState();
    }
  }

  function saveState(state) {
    writeJsonAtomic(circuitBreakerStatePath, { ...state, updated_at: nowProvider().toISOString() });
  }

  function isOpen() {
    return String(loadState()?.status || "") === CB_STATUS_OPEN;
  }

  function getState() {
    return loadState();
  }

  function openCircuit({ reason, triggeredBy, dateEt } = {}) {
    const state = loadState();
    const next = {
      ...state,
      status: CB_STATUS_OPEN,
      opened_at: nowProvider().toISOString(),
      opened_reason: String(reason || "").trim(),
      triggered_by: String(triggeredBy || "").trim(),
      date_et: String(dateEt || "").trim(),
    };
    saveState(next);
    logger(`[circuit-breaker] OPENED: ${reason}`);
    return next;
  }

  function closeCircuit() {
    const next = emptyState();
    saveState(next);
    logger(`[circuit-breaker] CLOSED (admin resume)`);
    return next;
  }

  function evaluateRunOutcome(params = {}) {
    const {
      dueCount, servedCount, dominantFailureClass,
      runId, dateEt,
      rollingZeroValueSpend, rollingCap,
      dailyZeroValueSpend, dailyCap,
    } = params;
    const now = nowProvider();
    const due = Math.max(0, Number(dueCount || 0));
    const served = Math.max(0, Number(servedCount || 0));
    const isNonTransient = dominantFailureClass && dominantFailureClass !== "transient";

    // Trigger 1: ≥3 users targeted, 0 served, non-transient dominant failure
    if (due >= 3 && served === 0 && isNonTransient) {
      return openCircuit({
        reason: `targeted_${due}_served_0_${dominantFailureClass}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    // Trigger 2: two consecutive zero-serve runs within 60 minutes
    const state = loadState();
    const windowMs = 60 * 60 * 1000;
    const recent = (state.recent_zero_serve_runs || []).filter((r) => {
      const ts = Date.parse(String(r?.ts_utc || ""));
      return Number.isFinite(ts) && (now.getTime() - ts) <= windowMs;
    });

    if (served === 0) {
      const updated = [...recent, { ts_utc: now.toISOString(), run_id: String(runId || "") }];
      if (updated.length >= 2) {
        saveState({ ...state, recent_zero_serve_runs: updated });
        return openCircuit({ reason: "two_consecutive_zero_serve_within_60min", triggeredBy: runId, dateEt });
      }
      saveState({ ...state, recent_zero_serve_runs: updated });
    } else {
      // Successful serve clears the zero-serve streak
      saveState({ ...state, recent_zero_serve_runs: [] });
    }

    // Trigger 3: rolling spend cap exceeded
    if (Number.isFinite(rollingZeroValueSpend) && Number.isFinite(rollingCap) && rollingZeroValueSpend >= rollingCap) {
      return openCircuit({
        reason: `rolling_zero_value_${rollingZeroValueSpend.toFixed(4)}_gte_cap_${rollingCap}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    // Trigger 4: daily spend cap exceeded
    if (Number.isFinite(dailyZeroValueSpend) && Number.isFinite(dailyCap) && dailyZeroValueSpend >= dailyCap) {
      return openCircuit({
        reason: `daily_zero_value_${dailyZeroValueSpend.toFixed(4)}_gte_cap_${dailyCap}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    return null;
  }

  return {
    isOpen,
    getState,
    openCircuit,
    closeCircuit,
    evaluateRunOutcome,
    CB_STATUS_OPEN,
    CB_STATUS_CLOSED,
  };
}

module.exports = {
  createDigestOrchestratorCircuitBreakerRuntime,
  CB_STATUS_OPEN,
  CB_STATUS_CLOSED,
};
