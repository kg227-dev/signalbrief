"use strict";

const RUN_VALUE_STATE_ABORTED = "aborted_non_deliverable_pre_spend";
const RUN_VALUE_STATE_ALLOWED = "pending_delivery";

const NON_TRANSIENT_UNDERFILL_REASONS = new Set([
  "retrieval_thin",
  "ranking_policy_limited",
  "quality_below_floor",
  "empty_items",
  "zero_standard_results",
  "no_selectable_items",
]);

function createDigestOrchestratorAdmissionGateRuntime(deps) {
  const {
    circuitBreakerRuntime,
    spendGuardRuntime,
    rollingWindowCapUsd = 1.0,
    rollingWindowHours = 6,
    dailyCapUsd = 2.5,
    log,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function filterEligibleUsers(dueUsers, dateEt, retryStateRuntime) {
    return (Array.isArray(dueUsers) ? dueUsers : []).filter((user) => {
      const userId = String(user?.chatId || user?.email || "").trim();

      // Filter users with non-transient underfill in retry state
      if (retryStateRuntime && typeof retryStateRuntime.getRetryState === "function") {
        const retryState = retryStateRuntime.getRetryState(userId, dateEt);
        if (retryState?.underfill_reason && NON_TRANSIENT_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
          return false;
        }
      }

      // Filter users already at per-user/date zero-value cap
      if (spendGuardRuntime && typeof spendGuardRuntime.hasUserDateZeroValueAttempt === "function") {
        if (spendGuardRuntime.hasUserDateZeroValueAttempt(userId, dateEt)) {
          return false;
        }
      }

      return true;
    });
  }

  function checkScheduledAdmission({ dueUsers, dateEt, retryStateRuntime } = {}) {
    // 1. Circuit breaker
    if (circuitBreakerRuntime && circuitBreakerRuntime.isOpen()) {
      logger(`[admission-gate] BLOCKED: circuit breaker open`);
      return { allowed: false, blockedReason: "circuit_breaker_open", runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
    }

    // 2. Rolling window cap
    if (spendGuardRuntime) {
      const rolling = spendGuardRuntime.checkRollingWindowCap(rollingWindowCapUsd, rollingWindowHours);
      if (rolling.hit) {
        logger(`[admission-gate] BLOCKED: rolling zero-value spend $${rolling.spent.toFixed(4)} >= $${rolling.threshold}`);
        return { allowed: false, blockedReason: `rolling_window_cap_hit_${rolling.spent.toFixed(4)}`, runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
      }

      // 3. Daily cap
      const daily = spendGuardRuntime.checkDailyCap(dateEt, dailyCapUsd);
      if (daily.hit) {
        logger(`[admission-gate] BLOCKED: daily zero-value spend $${daily.spent.toFixed(4)} >= $${daily.threshold}`);
        return { allowed: false, blockedReason: `daily_cap_hit_${daily.spent.toFixed(4)}`, runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
      }
    }

    // 4. Per-user/date cap and non-transient underfill filter
    const eligibleUsers = filterEligibleUsers(dueUsers, dateEt, retryStateRuntime);
    if (eligibleUsers.length === 0) {
      logger(`[admission-gate] BLOCKED: no eligible users after user/date cap filter`);
      return { allowed: false, blockedReason: "all_users_at_zero_value_cap", runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
    }

    return { allowed: true, blockedReason: null, runValueState: RUN_VALUE_STATE_ALLOWED, eligibleUsers };
  }

  function checkOnDemandAdmission({ dueUsers } = {}) {
    // On-demand runs are conscious user-triggered actions — bypass all safety gates
    return { allowed: true, blockedReason: null, runValueState: RUN_VALUE_STATE_ALLOWED, eligibleUsers: Array.isArray(dueUsers) ? dueUsers : [] };
  }

  return {
    checkScheduledAdmission,
    checkOnDemandAdmission,
    RUN_VALUE_STATE_ABORTED,
    RUN_VALUE_STATE_ALLOWED,
    NON_TRANSIENT_UNDERFILL_REASONS,
  };
}

module.exports = {
  createDigestOrchestratorAdmissionGateRuntime,
  RUN_VALUE_STATE_ABORTED,
  RUN_VALUE_STATE_ALLOWED,
  NON_TRANSIENT_UNDERFILL_REASONS,
};
