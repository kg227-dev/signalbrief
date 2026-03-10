"use strict";

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseEtNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function formatTimeEt(hour24, minute) {
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm} ET`;
}

function normalizeDeliveryTimeInput(raw) {
  const clean = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s*et\s*$/i, "")
    .replace(/\s+/g, " ");
  if (!clean) return null;

  let h;
  let m;

  // 24-hour format: HH:MM
  let match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    h = parseInt(match[1], 10);
    m = parseInt(match[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 12-hour format: H[:MM] AM/PM
  match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match) return null;
  h = parseInt(match[1], 10);
  m = match[2] != null ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (meridiem === "am") {
    if (h === 12) h = 0;
  } else if (h !== 12) {
    h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDaysLabel(days) {
  const list = Array.isArray(days) ? [...new Set(days.map(Number))].sort((a, b) => a - b) : [1, 2, 3, 4, 5];
  if (list.length === 7) return "Every day";
  if (list.length === 6 && !list.includes(0)) return "Mon–Sat";
  if (list.length === 5 && [1, 2, 3, 4, 5].every((day) => list.includes(day))) return "Mon–Fri";
  return list.map((day) => DAY_NAMES_SHORT[day] || `D${day}`).join(", ");
}

function computeNextDeliveryEt(preferences) {
  const prefs = preferences || {};
  const [hRaw, mRaw] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const h = Number.isFinite(hRaw) ? hRaw : 7;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const allowed = (
    Array.isArray(prefs.days_of_week) && prefs.days_of_week.length
      ? prefs.days_of_week
      : [1, 2, 3, 4, 5]
  ).map(Number);
  const now = parseEtNowParts();
  const nowMins = now.hour * 60 + now.minute;
  const deliveryMins = h * 60 + m;

  for (let offset = 0; offset < 14; offset++) {
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
    const dow = d.getUTCDay();
    if (!allowed.includes(dow)) continue;
    if (offset === 0 && deliveryMins <= nowMins) continue;

    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const dateKey = `${y}-${mo}-${da}`;
    const prettyDate = d.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return {
      key: `${dateKey} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET`,
      label: `${prettyDate} · ${formatTimeEt(h, m)}`,
    };
  }
  return null;
}

module.exports = {
  parseEtNowParts,
  formatTimeEt,
  normalizeDeliveryTimeInput,
  formatDaysLabel,
  computeNextDeliveryEt,
};

