"use strict";

function createDigestOrchestratorRecoveryRuntime(deps) {
  const {
    fs,
    path,
    circuitBreakerStatePath,
    incidentStorePath,
    spendGuardStatePath,
    costLogPath,
    digestRetryStatePath,
    recoveryQueuePath,
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

  function safeReadJson(filePath, defaultValue) {
    if (!filePath) return defaultValue;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[recovery-runtime] read failed ${filePath}: ${e.message}`);
      return defaultValue;
    }
  }

  function getTodayEt(now) {
    const s = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const d = new Date(s);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function takeSystemSnapshot() {
    const now = nowProvider();

    // Circuit breaker
    const cbState = safeReadJson(circuitBreakerStatePath, {});
    const circuitBreaker = {
      status: String(cbState.status || "CLOSED"),
      opened_at: cbState.opened_at || null,
      opened_reason: cbState.opened_reason || null,
      triggered_by: cbState.triggered_by || null,
    };

    // Active incidents
    const incidentStore = safeReadJson(incidentStorePath, { incidents: {} });
    const incidentsObj = incidentStore.incidents || {};
    const activeIncidents = Object.values(incidentsObj)
      .filter((inc) => inc.status === "OPEN" || inc.status === "ESCALATED")
      .map((inc) => ({
        fingerprint: inc.fingerprint,
        status: inc.status,
        severity: inc.severity,
        type: inc.type,
        date_et: inc.date_et,
        occurrence_count: inc.occurrence_count,
        first_seen: inc.first_seen,
        last_seen: inc.last_seen,
      }));

    // Spend guard
    const sgState = safeReadJson(spendGuardStatePath, { zero_value_runs: [] });
    const zeroValueRuns = Array.isArray(sgState.zero_value_runs) ? sgState.zero_value_runs : [];
    const todayEt = getTodayEt(now);
    const sixHourCutoff = now.getTime() - 6 * 60 * 60 * 1000;

    let rolling6hUsd = 0;
    let dailyUsd = 0;
    for (const entry of zeroValueRuns) {
      const ts = Date.parse(String(entry.ts_utc || ""));
      const cost = Math.max(0, Number(entry.cost_usd || 0));
      if (Number.isFinite(ts) && ts >= sixHourCutoff) {
        rolling6hUsd += cost;
      }
      if (String(entry.date_et || "").trim() === todayEt) {
        dailyUsd += cost;
      }
    }
    const spendGuard = {
      rolling_6h_usd: rolling6hUsd,
      daily_usd: dailyUsd,
      today_et: todayEt,
      entry_count: zeroValueRuns.length,
    };

    // Recent runs from cost log JSONL
    let recentRuns = [];
    if (costLogPath) {
      try {
        const raw = fs.readFileSync(costLogPath, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        const last5 = lines.slice(-5);
        recentRuns = last5
          .map((line) => {
            try {
              const obj = JSON.parse(line);
              return {
                date: obj.date,
                run_at_et: obj.run_at_et,
                total_cost_usd: obj.total_cost_usd,
                users_served: obj.users_served,
                users_targeted: obj.users_targeted,
                run_value_state: obj.run_value_state,
              };
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean)
          .reverse();
      } catch (e) {
        if (e && e.code !== "ENOENT") logger(`[recovery-runtime] cost log read failed: ${e.message}`);
        recentRuns = [];
      }
    }

    // Retry state
    let usersWithPendingRetry = 0;
    let usersWithExhaustedBudget = 0;
    if (digestRetryStatePath) {
      try {
        const parsed = JSON.parse(fs.readFileSync(digestRetryStatePath, "utf8"));
        const stateObj = parsed.state || parsed;
        for (const val of Object.values(stateObj)) {
          if (val && val.retry_pending === true) usersWithPendingRetry++;
          if (val && Number(val.attempt_count || 0) >= 2) usersWithExhaustedBudget++;
        }
      } catch (e) {
        if (e && e.code !== "ENOENT") logger(`[recovery-runtime] retry state read failed: ${e.message}`);
      }
    }
    const retryState = {
      users_with_pending_retry: usersWithPendingRetry,
      users_with_exhausted_budget: usersWithExhaustedBudget,
    };

    // Recovery queue
    const queue = safeReadJson(recoveryQueuePath, { version: 1, items: [] });
    const items = Array.isArray(queue.items) ? queue.items : [];
    const pendingItems = items.filter((i) => i.status === "pending");
    const recoveryQueue = {
      pending: pendingItems.length,
      items: pendingItems,
    };

    return {
      snapshot_at: now.toISOString(),
      circuit_breaker: circuitBreaker,
      active_incidents: activeIncidents,
      spend_guard: spendGuard,
      recent_runs: recentRuns,
      retry_state: retryState,
      recovery_queue: recoveryQueue,
    };
  }

  function formatSnapshotMessage(snapshot) {
    const snapshotAt = snapshot.snapshot_at
      ? new Date(snapshot.snapshot_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "unknown";

    const lines = [];
    lines.push(`📊 SignalBrief Status — ${snapshotAt}`);
    lines.push("");

    const cb = snapshot.circuit_breaker || {};
    const cbStatus = cb.status === "OPEN" ? "OPEN ⛔" : "CLOSED ✅";
    lines.push(`Circuit Breaker: ${cbStatus}`);
    if (cb.status === "OPEN") {
      if (cb.opened_at) {
        const openedAt = new Date(cb.opened_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        lines.push(`  Opened: ${openedAt}`);
      }
      if (cb.opened_reason) {
        lines.push(`  Reason: ${cb.opened_reason}`);
      }
    }
    lines.push("");

    const incidents = Array.isArray(snapshot.active_incidents) ? snapshot.active_incidents : [];
    lines.push(`Active Incidents: ${incidents.length}`);
    for (const inc of incidents) {
      lines.push(`  • ${inc.severity} ${inc.type} (${inc.date_et}) ×${inc.occurrence_count}`);
    }
    lines.push("");

    const sg = snapshot.spend_guard || {};
    lines.push("Spend (zero-value):");
    lines.push(`  Rolling 6h: $${Number(sg.rolling_6h_usd || 0).toFixed(3)}`);
    lines.push(`  Today: $${Number(sg.daily_usd || 0).toFixed(3)}`);
    lines.push("");

    const runs = Array.isArray(snapshot.recent_runs) ? snapshot.recent_runs : [];
    lines.push("Recent runs:");
    if (runs.length === 0) {
      lines.push("  none");
    } else {
      for (const run of runs) {
        lines.push(
          `  ${run.run_at_et}: ${run.run_value_state} $${run.total_cost_usd} (${run.users_served}/${run.users_targeted})`
        );
      }
    }
    lines.push("");

    const rs = snapshot.retry_state || {};
    lines.push("Retry state:");
    lines.push(`  Pending: ${rs.users_with_pending_retry || 0}`);
    lines.push(`  Exhausted: ${rs.users_with_exhausted_budget || 0}`);
    lines.push("");

    const rq = snapshot.recovery_queue || {};
    lines.push(`Recovery queue: ${rq.pending || 0} pending`);

    return lines.join("\n");
  }

  function enqueueRecoveryAction(action) {
    if (!recoveryQueuePath) {
      logger("[recovery-runtime] warn: recoveryQueuePath not set, cannot enqueue");
      return null;
    }
    const now = nowProvider();
    const queue = safeReadJson(recoveryQueuePath, { version: 1, updated_at: null, items: [] });
    if (!Array.isArray(queue.items)) queue.items = [];

    const item = {
      action_id: `rq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: action.action,
      by: action.by || "admin",
      reason: action.reason || "",
      params: action.params && typeof action.params === "object" ? action.params : {},
      enqueued_at: now.toISOString(),
      status: "pending",
    };

    queue.items.push(item);
    queue.updated_at = now.toISOString();
    queue.version = queue.version || 1;
    writeJsonAtomic(recoveryQueuePath, queue);
    return item;
  }

  async function drainRecoveryQueue(handlers) {
    if (!recoveryQueuePath) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    let queue;
    try {
      queue = JSON.parse(fs.readFileSync(recoveryQueuePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[recovery-runtime] drain: queue read failed: ${e.message}`);
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    if (!Array.isArray(queue.items)) queue.items = [];
    const pending = queue.items.filter((i) => i.status === "pending");
    if (pending.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors = [];
    const now = nowProvider();

    for (const item of pending) {
      const handler = handlers && handlers[item.action];
      if (!handler) continue;

      try {
        await handler(item);
        item.status = "done";
        item.done_at = now.toISOString();
        succeeded++;
      } catch (e) {
        item.status = "error";
        item.error_message = e.message;
        failed++;
        errors.push({ action_id: item.action_id, error_message: e.message });
      }
      processed++;
    }

    queue.updated_at = now.toISOString();
    writeJsonAtomic(recoveryQueuePath, queue);

    return { processed, succeeded, failed, errors };
  }

  return {
    takeSystemSnapshot,
    formatSnapshotMessage,
    enqueueRecoveryAction,
    drainRecoveryQueue,
  };
}

module.exports = {
  createDigestOrchestratorRecoveryRuntime,
};
