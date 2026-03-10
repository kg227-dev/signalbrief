"use strict";

function resolveDueUsers(deps) {
  const {
    targetChatId,
    allUsers,
    USER_STATUS,
    getEtNow,
    toEtDateString,
    CONFIG,
    log,
  } = deps;

  const etNow = getEtNow();
  const todayET = etNow.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nowMinutes = etNow.getHours() * 60 + etNow.getMinutes();
  const allActive = allUsers().filter((user) => user.status === USER_STATUS.ACTIVE);

  let dueUsers;
  if (targetChatId) {
    dueUsers = allActive.filter((user) => user.chatId === targetChatId);
  } else {
    const todayDOW = etNow.getDay();
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
    log(`[schedule] ${todayET} ${etNow.getHours().toString().padStart(2, "0")}:${etNow.getMinutes().toString().padStart(2, "0")} ET — ${parts.join(" | ")}`);
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
