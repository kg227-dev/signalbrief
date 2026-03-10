#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const EVENTS_FILE = path.join(DATA_DIR, "engagement-events.jsonl");

function logDataWarning(scope, identifier, err) {
  const message = err && err.message ? err.message : String(err || "unknown error");
  process.stderr.write(`[marketing-report] skipped ${scope} (${identifier}): ${message}\n`);
}

function readUsers() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("user-") && f.endsWith(".json"));
  const users = [];
  for (const file of files) {
    try {
      const fullPath = path.join(DATA_DIR, file);
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      users.push(raw);
    } catch (err) {
      // Skip malformed user files so one bad record does not block reporting.
      logDataWarning("user file", file, err);
    }
  }
  return users;
}

function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const lines = fs
    .readFileSync(EVENTS_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      // Skip malformed lines.
      logDataWarning("event line", `line ${i + 1}`, err);
    }
  }
  return events;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeekMonday(dateLike) {
  const d = new Date(
    dateLike.getFullYear(),
    dateLike.getMonth(),
    dateLike.getDate(),
    0,
    0,
    0,
    0
  );
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function endOfDay(dateLike) {
  return new Date(
    dateLike.getFullYear(),
    dateLike.getMonth(),
    dateLike.getDate(),
    23,
    59,
    59,
    999
  );
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function fmtPct(value) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function dateOnly(value) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const args = { asOf: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--as-of" && argv[i + 1]) {
      args.asOf = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function computeDigest2OpenRate(users, events, weekStart, asOfEnd) {
  const openEvents = events.filter((e) => String(e.event_type) === "email_open");
  const sentEvents = events.filter(
    (e) => String(e.event_type) === "digest_sent" && String(e.channel) === "email"
  );
  const openByDigest = new Set(openEvents.map((e) => String(e.digest_id || "")));

  const sentByUser = new Map();
  for (const ev of sentEvents) {
    const ts = parseDate(ev.ts_utc);
    if (!ts || ts < weekStart || ts > asOfEnd) continue;
    const key = String(ev.user_chat_id || "");
    if (!sentByUser.has(key)) sentByUser.set(key, []);
    sentByUser.get(key).push(ev);
  }
  for (const list of sentByUser.values()) {
    list.sort((a, b) => (parseDate(a.ts_utc) || 0) - (parseDate(b.ts_utc) || 0));
  }

  const newUsers = users.filter((u) => {
    const joined = parseDate(u.joined_at);
    return joined && joined >= weekStart && joined <= asOfEnd;
  });

  let eligible = 0;
  let opened = 0;
  for (const user of newUsers) {
    const key = String(user.chatId || user.chat_id || "");
    const list = sentByUser.get(key) || [];
    if (list.length < 2) continue;
    eligible += 1;
    const secondDigestId = String(list[1].digest_id || "");
    if (openByDigest.has(secondDigestId)) opened += 1;
  }

  return { eligible, opened, rate: pct(opened, eligible) };
}

function isEventWithinRange(tsValue, rangeStart, rangeEnd) {
  const ts = parseDate(tsValue);
  return !!ts && ts >= rangeStart && ts <= rangeEnd;
}

function isEmailDigestEvent(event) {
  return String(event.event_type) === "digest_sent" && String(event.channel) === "email";
}

function isEmailOpenEvent(event) {
  return String(event.event_type) === "email_open";
}

function countNewSignups(users, weekStart, asOfEnd) {
  return users.filter((user) => {
    const joined = parseDate(user.joined_at);
    return joined && joined >= weekStart && joined <= asOfEnd;
  }).length;
}

function countWeeklyChurn(users, statuses, weekStart, asOfEnd) {
  return users.filter((user) => {
    if (!statuses.has(String(user.status))) return false;
    const lastDigest = parseDate(user.last_digest_at);
    return !!lastDigest && lastDigest >= weekStart && lastDigest <= asOfEnd;
  }).length;
}

function computeSevenDayEmailMetrics(users, events, sevenDayStart, asOfEnd) {
  const sent7d = events.filter((event) => isEventWithinRange(event.ts_utc, sevenDayStart, asOfEnd) && isEmailDigestEvent(event));
  const opens7d = events.filter((event) => isEventWithinRange(event.ts_utc, sevenDayStart, asOfEnd) && isEmailOpenEvent(event));
  const sentDigestIds = new Set(sent7d.map((event) => String(event.digest_id || ""))).size;
  const openDigestIds = new Set(opens7d.map((event) => String(event.digest_id || ""))).size;
  const trackingSeen =
    opens7d.length > 0 || users.some((user) => user.last_email_open_at || Number(user.email_opens_total || 0) > 0);

  return {
    trackingSeen,
    sentDigestIds,
    openDigestIds,
    openRate7d: trackingSeen ? pct(openDigestIds, sentDigestIds) : null,
  };
}

function selectTopDigestForWeek(events, weekStart, asOfEnd) {
  const weeklyEmailDigests = events.filter((event) => {
    return isEventWithinRange(event.ts_utc, weekStart, asOfEnd) && isEmailDigestEvent(event);
  });
  weeklyEmailDigests.sort(
    (a, b) => Number(b?.metadata?.quality_score || 0) - Number(a?.metadata?.quality_score || 0)
  );
  if (!weeklyEmailDigests[0]) return null;
  const top = weeklyEmailDigests[0];
  return {
    date: top.date_et,
    qualityScore: Number(top?.metadata?.quality_score || 0),
    leadHeadline: top?.metadata?.items?.[0]?.headline || null,
  };
}

function computeReport(asOfDate) {
  const users = readUsers();
  const events = readEvents();

  const asOfEnd = endOfDay(asOfDate);
  const weekStart = startOfWeekMonday(asOfDate);
  const sevenDayStart = new Date(asOfEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const statuses = new Set(["unsubscribed", "paused", "inactive"]);

  const activeSubscribers = users.filter((u) => String(u.status) === "active").length;
  const newSignupsThisWeek = countNewSignups(users, weekStart, asOfEnd);
  const churnThisWeekApprox = countWeeklyChurn(users, statuses, weekStart, asOfEnd);
  const sevenDayEmail = computeSevenDayEmailMetrics(users, events, sevenDayStart, asOfEnd);
  const digest2 = computeDigest2OpenRate(users, events, weekStart, asOfEnd);
  const digest2OpenRate = sevenDayEmail.trackingSeen ? digest2.rate : null;
  const topDigest = selectTopDigestForWeek(events, weekStart, asOfEnd);

  const blockers = [];
  if (!sevenDayEmail.trackingSeen) blockers.push("No email-open tracking data captured yet.");
  if (users.length < 15) blockers.push("Audience is too small for stable week-over-week conversion signals.");

  return {
    asOf: dateOnly(asOfEnd),
    weekStart: dateOnly(weekStart),
    metrics: {
      active_subscribers: activeSubscribers,
      open_rate_7d_pct: sevenDayEmail.openRate7d,
      new_signups_this_week: newSignupsThisWeek,
      digest2_open_rate_pct: digest2OpenRate,
      unsubscribes_or_pauses_this_week_approx: churnThisWeekApprox,
    },
    supporting: {
      email_digests_sent_7d: sevenDayEmail.sentDigestIds,
      email_open_events_7d: sevenDayEmail.openDigestIds,
      digest2_open_eligible_users: digest2.eligible,
      digest2_opened_users: digest2.opened,
      top_digest_this_week: topDigest,
    },
    blockers,
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`# Weekly Marketing Snapshot (${report.asOf})`);
  lines.push("");
  lines.push(`- Week start: ${report.weekStart}`);
  lines.push(`- Active subscribers: ${report.metrics.active_subscribers}`);
  lines.push(`- 7-day open rate: ${fmtPct(report.metrics.open_rate_7d_pct)}`);
  lines.push(`- New signups this week: ${report.metrics.new_signups_this_week}`);
  lines.push(`- Digest #2 open rate: ${fmtPct(report.metrics.digest2_open_rate_pct)}`);
  lines.push(
    `- Unsubscribes/pauses this week (approx): ${report.metrics.unsubscribes_or_pauses_this_week_approx}`
  );
  lines.push("");
  lines.push("## Supporting Data");
  lines.push(`- Email digests sent (7d): ${report.supporting.email_digests_sent_7d}`);
  lines.push(`- Email opens captured (7d): ${report.supporting.email_open_events_7d}`);
  lines.push(`- Digest #2 open eligible users: ${report.supporting.digest2_open_eligible_users}`);
  lines.push(`- Digest #2 opened users: ${report.supporting.digest2_opened_users}`);
  if (report.supporting.top_digest_this_week) {
    lines.push(
      `- Top digest by quality: ${report.supporting.top_digest_this_week.date} ` +
        `(score ${report.supporting.top_digest_this_week.qualityScore.toFixed(2)})`
    );
    if (report.supporting.top_digest_this_week.leadHeadline) {
      lines.push(`- Top digest lead headline: ${report.supporting.top_digest_this_week.leadHeadline}`);
    }
  }
  lines.push("");
  lines.push("## Blockers");
  if (!report.blockers.length) {
    lines.push("- None");
  } else {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  lines.push("");
  lines.push("## Raw JSON");
  lines.push("```json");
  lines.push(JSON.stringify(report, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const { asOf } = parseArgs(process.argv);
  const asOfDate = asOf ? new Date(`${asOf}T12:00:00`) : new Date();
  if (Number.isNaN(asOfDate.getTime())) {
    console.error("Invalid --as-of value. Expected YYYY-MM-DD.");
    process.exit(1);
  }

  const report = computeReport(asOfDate);
  process.stdout.write(toMarkdown(report));
}

if (require.main === module) {
  main();
}

module.exports = {
  readUsers,
  readEvents,
  parseDate,
  startOfWeekMonday,
  endOfDay,
  pct,
  fmtPct,
  dateOnly,
  parseArgs,
  computeDigest2OpenRate,
  computeReport,
  toMarkdown,
  main,
};
