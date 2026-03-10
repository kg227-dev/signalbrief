function toEtDateOffset(nowEt, offset) {
  const d = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + offset));
  return {
    dateKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    dow: d.getUTCDay(),
  };
}

function buildWindow(nowEt, startOffset, endOffset) {
  const rows = [];
  for (let offset = startOffset; offset <= endOffset; offset++) {
    rows.push(toEtDateOffset(nowEt, offset));
  }
  return rows;
}

function expectedScheduledCount(windowRows, activeRoster) {
  let total = 0;
  for (const day of windowRows) {
    for (const user of activeRoster) {
      const allowedDays = Array.isArray(user.days_of_week) && user.days_of_week.length
        ? user.days_of_week.map(Number)
        : [1, 2, 3, 4, 5];
      if (allowedDays.includes(day.dow)) total++;
    }
  }
  return total;
}

function deliveredScheduledCount(windowRows, runs, activeEmailSet) {
  const allowedDates = new Set(windowRows.map((row) => row.dateKey));
  const deliveredSet = new Set();
  for (const run of runs) {
    if (run.on_demand) continue;
    const dateKey = String(run.date || "");
    if (!allowedDates.has(dateKey)) continue;
    const perUsers = Array.isArray(run.per_user) ? run.per_user : [];
    for (const perUser of perUsers) {
      const uid = String((perUser && perUser.id) || "").toLowerCase().trim();
      if (!uid || !activeEmailSet.has(uid)) continue;
      deliveredSet.add(`${dateKey}|${uid}`);
    }
  }
  return deliveredSet.size;
}

function getLastSuccessfulScheduledRun(runs) {
  return runs.find((run) => !run.on_demand && (run.users_served || 0) > 0) || null;
}

function getNextExpectedActiveDelivery(activeRoster) {
  return activeRoster
    .filter((user) => user.next_delivery_key)
    .sort((a, b) => String(a.next_delivery_key || "").localeCompare(String(b.next_delivery_key || "")))[0] || null;
}

function minutesUntilEtKey(key, nowEt) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ET$/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mm] = m;
  const nowStamp = Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day, nowEt.hour, nowEt.minute);
  const targetStamp = Date.UTC(parseInt(yy, 10), parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mm, 10));
  return Math.max(0, Math.round((targetStamp - nowStamp) / 60000));
}

function formatCountdown(totalMinutes) {
  if (totalMinutes == null) return "—";
  const mins = Math.max(0, totalMinutes);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMissedTrendLabel(missedDelta7d) {
  if (missedDelta7d === 0) return "Flat vs prior 7d";
  return `${missedDelta7d > 0 ? "+" : ""}${missedDelta7d} missed vs prior 7d`;
}

module.exports = {
  buildWindow,
  expectedScheduledCount,
  deliveredScheduledCount,
  getLastSuccessfulScheduledRun,
  getNextExpectedActiveDelivery,
  minutesUntilEtKey,
  formatCountdown,
  formatMissedTrendLabel,
};
