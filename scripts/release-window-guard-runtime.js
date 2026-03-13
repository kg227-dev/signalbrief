"use strict";

const ET_TIME_ZONE = "America/New_York";
const DEFAULT_RELEASE_WINDOWS_ET = [
  "MON@11:00",
  "MON@16:00",
  "TUE@11:00",
  "TUE@16:00",
  "WED@11:00",
  "WED@16:00",
  "THU@11:00",
  "THU@16:00",
  "FRI@11:00",
  "FRI@16:00",
].join(",");
const DEFAULT_TOLERANCE_MINUTES = 45;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_MAP = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function parseArgs(argv) {
  const options = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[i + 1];
    if (next != null && !String(next).startsWith("--")) {
      options[key] = String(next);
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { options, flags };
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseBoolean(raw, fallback = false) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(value)) return true;
  if (["0", "false", "no", "n", "off"].includes(value)) return false;
  return fallback;
}

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatWindow(window) {
  return `${WEEKDAY_NAMES[window.weekday]} ${minutesToClock(window.minutes)} ET`;
}

function parseReleaseWindowsEt(rawSpec) {
  const spec = String(rawSpec || DEFAULT_RELEASE_WINDOWS_ET).trim();
  if (!spec) {
    throw new Error("release windows spec is empty");
  }
  const tokens = spec
    .split(/[,\n;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    throw new Error("release windows spec has no windows");
  }

  const seen = new Set();
  const windows = [];
  for (const token of tokens) {
    const match = token.match(/^([a-zA-Z]+)\s*@\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new Error(`invalid release window token: ${token}`);
    }
    const dayToken = String(match[1] || "").toLowerCase();
    const weekday = WEEKDAY_MAP[dayToken];
    if (!Number.isInteger(weekday)) {
      throw new Error(`invalid release window day: ${match[1]}`);
    }
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error(`invalid release window hour: ${match[2]}`);
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error(`invalid release window minute: ${match[3]}`);
    }
    const minutes = hour * 60 + minute;
    const dedupeKey = `${weekday}:${minutes}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    windows.push({
      weekday,
      minutes,
      token: `${WEEKDAY_NAMES[weekday].toUpperCase()}@${minutesToClock(minutes)}`,
    });
  }
  windows.sort((a, b) => (a.weekday - b.weekday) || (a.minutes - b.minutes));
  return windows;
}

function getEtNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const mapped = {};
  for (const part of parts) {
    mapped[part.type] = part.value;
  }
  const weekdayToken = String(mapped.weekday || "").toLowerCase();
  const weekday = WEEKDAY_MAP[weekdayToken];
  const hour = Number(mapped.hour);
  const minute = Number(mapped.minute);
  const minutes = (Number.isInteger(hour) ? hour : 0) * 60 + (Number.isInteger(minute) ? minute : 0);
  return {
    weekday: Number.isInteger(weekday) ? weekday : 0,
    minutes,
    hour: Number.isInteger(hour) ? hour : 0,
    minute: Number.isInteger(minute) ? minute : 0,
    date_label: `${mapped.year || "0000"}-${mapped.month || "00"}-${mapped.day || "00"}`,
    weekday_label: WEEKDAY_NAMES[Number.isInteger(weekday) ? weekday : 0],
  };
}

function toReadableEta(minutesUntil) {
  const value = Math.max(0, Number(minutesUntil || 0));
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const minutes = value % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function findNextWindow(nowEt, windows) {
  let best = null;
  for (const window of windows) {
    let delta = (window.weekday - nowEt.weekday) * 1440 + (window.minutes - nowEt.minutes);
    while (delta < 0) delta += 7 * 1440;
    if (!best || delta < best.minutes_until) {
      best = {
        ...window,
        minutes_until: delta,
      };
    }
  }
  if (!best) return null;
  return {
    ...best,
    eta: toReadableEta(best.minutes_until),
    label: formatWindow(best),
  };
}

function evaluateReleaseWindowGuard(options = {}) {
  const windows = Array.isArray(options.windows) && options.windows.length
    ? options.windows
    : parseReleaseWindowsEt(options.windowsSpec || DEFAULT_RELEASE_WINDOWS_ET);
  const toleranceMinutes = parsePositiveInt(options.toleranceMinutes, DEFAULT_TOLERANCE_MINUTES);
  const now = options.now instanceof Date ? options.now : new Date();
  const nowEt = getEtNowParts(now);
  const hotfix = options.hotfix === true;
  const allowOutsideWindow = options.allowOutsideWindow === true;

  const matches = windows.filter(
    (window) => window.weekday === nowEt.weekday && Math.abs(nowEt.minutes - window.minutes) <= toleranceMinutes
  );
  const inWindow = matches.length > 0;
  const nextWindow = findNextWindow(nowEt, windows);
  const allowed = hotfix || allowOutsideWindow || inWindow;
  const mode = hotfix
    ? "hotfix_override"
    : (allowOutsideWindow ? "manual_override" : (inWindow ? "scheduled_window" : "blocked_outside_window"));

  return {
    allowed,
    mode,
    hotfix,
    allow_outside_window: allowOutsideWindow,
    in_window: inWindow,
    tolerance_minutes: toleranceMinutes,
    matched_window: matches[0]
      ? {
        ...matches[0],
        label: formatWindow(matches[0]),
      }
      : null,
    now_et: {
      date: nowEt.date_label,
      weekday: nowEt.weekday,
      weekday_label: nowEt.weekday_label,
      time: minutesToClock(nowEt.minutes),
      minutes: nowEt.minutes,
      timezone: ET_TIME_ZONE,
    },
    windows: windows.map((window) => ({
      ...window,
      label: formatWindow(window),
    })),
    next_window: nextWindow,
  };
}

function resolveReleaseWindowGuardOptions(argv, env = process.env) {
  const { options, flags } = parseArgs(argv);
  const windowsSpec = readOption(options, "release-windows-et", "release_windows_et")
    || String(env.DEPLOY_RELEASE_WINDOWS_ET || "").trim()
    || DEFAULT_RELEASE_WINDOWS_ET;
  const toleranceMinutes = parsePositiveInt(
    readOption(options, "release-window-tolerance-minutes", "release_window_tolerance_minutes")
    || String(env.DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES || ""),
    DEFAULT_TOLERANCE_MINUTES
  );
  const hotfix = (
    flags.has("hotfix")
    || flags.has("incident-hotfix")
    || parseBoolean(env.DEPLOY_HOTFIX, false)
  );
  const allowOutsideWindow = (
    flags.has("allow-outside-window")
    || parseBoolean(env.DEPLOY_ALLOW_OUTSIDE_WINDOW, false)
  );
  const nowUtc = readOption(options, "now-utc", "now_utc");
  let now = new Date();
  if (nowUtc) {
    const parsed = new Date(nowUtc);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`invalid --now-utc value: ${nowUtc}`);
    }
    now = parsed;
  }
  return {
    windowsSpec,
    toleranceMinutes,
    hotfix,
    allowOutsideWindow,
    now,
    help: flags.has("help") || flags.has("h"),
  };
}

module.exports = {
  DEFAULT_RELEASE_WINDOWS_ET,
  DEFAULT_TOLERANCE_MINUTES,
  ET_TIME_ZONE,
  evaluateReleaseWindowGuard,
  findNextWindow,
  formatWindow,
  parseReleaseWindowsEt,
  resolveReleaseWindowGuardOptions,
};
