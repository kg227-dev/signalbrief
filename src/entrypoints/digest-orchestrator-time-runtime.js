"use strict";

const ET_WEEKDAY_MAP = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

const ET_NOW_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getEtNow() {
  return new Date();
}

function getEtNowParts(date = new Date()) {
  const currentDate = date instanceof Date ? date : new Date(date);
  const rawParts = ET_NOW_PARTS_FORMATTER.formatToParts(currentDate);
  const parts = {};
  for (const part of rawParts) {
    if (part.type === "literal") continue;
    parts[part.type] = part.value;
  }

  const year = String(parts.year || "").trim();
  const month = String(parts.month || "").trim();
  const day = String(parts.day || "").trim();
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const todayDOW = ET_WEEKDAY_MAP[String(parts.weekday || "").trim()] ?? null;
  const todayET = year && month && day
    ? `${year}-${month}-${day}`
    : null;

  return {
    todayET,
    todayDOW,
    hour,
    minute,
    nowMinutes: (hour * 60) + minute,
  };
}

function toEtDateString(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}

function formatEtDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

module.exports = {
  getEtNow,
  getEtNowParts,
  toEtDateString,
  formatEtDateKey,
};
