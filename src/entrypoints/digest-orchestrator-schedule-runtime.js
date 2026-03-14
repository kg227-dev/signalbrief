"use strict";

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
      Number(CONFIG?.digest?.catchupWindowMinutes || (12 * 60))
    );
    dueUsers = allActive.filter((user) => {
      const prefs = user.preferences || {};
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(todayDOW)) return false;
      if (toEtDateString(user.last_digest_at) === todayET) return false;

      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const userMinutes = dh * 60 + dm;
      let diff = nowMinutes - userMinutes;
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      return diff >= 0 && diff <= catchupWindowMinutes;
    });
  }

  if (!targetChatId && allActive.length > 0) {
    const parts = allActive.map((user) => {
      const prefs = user.preferences || {};
      const alreadyToday = toEtDateString(user.last_digest_at) === todayET;
      if (alreadyToday) return `${user.email || user.chatId}: alreadyToday`;
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
  resolveDueUsers,
};
