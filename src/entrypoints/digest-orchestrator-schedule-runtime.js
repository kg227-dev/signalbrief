"use strict";

const TERMINAL_RETRY_OUTCOMES = new Set([
  "withheld_after_retry",
  "withheld_after_retry_window",
  "delivery_failed_after_retry",
  "delivery_failed_after_retry_window",
]);

function hasScheduledDeliveryChannel(user = {}) {
  const prefs = user.preferences || {};
  const hasTelegram = !!(
    user.chatId
    && !String(user.chatId).startsWith("email-")
    && prefs.telegram_enabled !== false
  );
  const hasEmail = !!(user.email && prefs.email_enabled !== false);
  return hasTelegram || hasEmail;
}

function isTerminalRetryOutcome(outcome) {
  return TERMINAL_RETRY_OUTCOMES.has(String(outcome || "").trim());
}

function hasExhaustedScheduledRetryBudget(retryState) {
  if (!retryState || typeof retryState !== "object") return false;
  const attemptCount = Math.max(0, Number(retryState.attempt_count || 0));
  return attemptCount >= 2;
}

function resolveDueUsers(deps) {
  const {
    targetChatId,
    allUsers,
    USER_STATUS,
    getEtNow,
    getEtNowParts,
    toEtDateString,
    CONFIG,
    log,
    allowExampleEmails = true,
    retryStateRuntime = null,
  } = deps;

  const now = getEtNow();
  const etNow = typeof getEtNowParts === "function"
    ? getEtNowParts(now)
    : {};
  const todayET = String(etNow.todayET || toEtDateString(now?.toISOString?.() || "") || "").trim();
  const nowMinutes = Number.isFinite(Number(etNow.nowMinutes))
    ? Number(etNow.nowMinutes)
    : ((now.getHours() * 60) + now.getMinutes());
  const activeUsers = allUsers().filter((user) => user.status === USER_STATUS.ACTIVE);
  const allActive = allowExampleEmails
    ? activeUsers
    : activeUsers.filter((user) => !/@example\.com$/i.test(String(user?.email || "").trim()));
  const blockedExampleCount = activeUsers.length - allActive.length;
  if (blockedExampleCount > 0 && !targetChatId) {
    log(`[schedule] excluded ${blockedExampleCount} @example.com account(s) from production delivery`);
  }

  let dueUsers;
  if (targetChatId) {
    dueUsers = allActive.filter((user) => user.chatId === targetChatId);
  } else {
    const todayDOW = Number.isInteger(etNow.todayDOW) ? etNow.todayDOW : now.getDay();
    const catchupWindowMinutes = Math.max(
      30,
      Number(CONFIG?.digest?.catchupWindowMinutes || 60)
    );
    dueUsers = allActive.filter((user) => {
      const prefs = user.preferences || {};
      const retryState = retryStateRuntime && typeof retryStateRuntime.getRetryState === "function"
        ? retryStateRuntime.getRetryState(user.chatId || user.email, todayET)
        : null;
      if (!hasScheduledDeliveryChannel(user)) {
        return false;
      }
      if (isTerminalRetryOutcome(retryState?.delivery_outcome)) {
        return false;
      }
      if (hasExhaustedScheduledRetryBudget(retryState)) {
        return false;
      }
      if (retryState?.retry_pending === true) {
        const nextRetryAt = Date.parse(String(retryState?.next_retry_at || ""));
        if (Number.isFinite(nextRetryAt) && now.getTime() < nextRetryAt) return false;
        return true;
      }
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(todayDOW)) return false;
      if (toEtDateString(user.last_digest_at) === todayET) return false;

      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const userMinutes = dh * 60 + dm;
      let diff = nowMinutes - userMinutes;
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      return diff >= 0 && diff <= catchupWindowMinutes;
    }).map((user) => {
      const retryState = retryStateRuntime && typeof retryStateRuntime.getRetryState === "function"
        ? retryStateRuntime.getRetryState(user.chatId || user.email, todayET)
        : null;
      return retryState
        ? { ...user, __digest_retry: { ...retryState } }
        : user;
    });
  }

  if (!targetChatId && allActive.length > 0) {
    const parts = allActive.map((user) => {
      const prefs = user.preferences || {};
      const alreadyToday = toEtDateString(user.last_digest_at) === todayET;
      if (alreadyToday) return `${user.email || user.chatId}: alreadyToday`;
      if (!hasScheduledDeliveryChannel(user)) return `${user.email || user.chatId}: noChannel`;
      const retryState = retryStateRuntime && typeof retryStateRuntime.getRetryState === "function"
        ? retryStateRuntime.getRetryState(user.chatId || user.email, todayET)
        : null;
      if (isTerminalRetryOutcome(retryState?.delivery_outcome)) {
        return `${user.email || user.chatId}: halted(${retryState.delivery_outcome})`;
      }
      if (hasExhaustedScheduledRetryBudget(retryState)) {
        return `${user.email || user.chatId}: halted(retry_budget_exhausted)`;
      }
      if (retryState?.retry_pending === true) {
        const nextRetryAt = Date.parse(String(retryState?.next_retry_at || ""));
        const retryReady = Number.isFinite(nextRetryAt) ? now.getTime() >= nextRetryAt : true;
        return `${user.email || user.chatId}: retry ${retryReady ? "ready" : "waiting"} → ${dueUsers.some((dueUser) => dueUser.chatId === user.chatId) ? "DUE" : "skip"}`;
      }
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      let diff = nowMinutes - (dh * 60 + dm);
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      const isDue = dueUsers.some((dueUser) => dueUser.chatId === user.chatId);
      return `${user.email || user.chatId}: target=${prefs.delivery_time} diff=${diff >= 0 ? "+" : ""}${diff}min → ${isDue ? "DUE" : "skip"}`;
    });
    const etHour = Number.isFinite(Number(etNow.hour)) ? Number(etNow.hour) : now.getHours();
    const etMinute = Number.isFinite(Number(etNow.minute)) ? Number(etNow.minute) : now.getMinutes();
    log(`[schedule] ${todayET} ${etHour.toString().padStart(2, "0")}:${etMinute.toString().padStart(2, "0")} ET — ${parts.join(" | ")}`);
  }

  return {
    etNow,
    todayET,
    nowMinutes,
    allActive,
    dueUsers,
  };
}

module.exports = {
  hasExhaustedScheduledRetryBudget,
  hasScheduledDeliveryChannel,
  isTerminalRetryOutcome,
  resolveDueUsers,
};
