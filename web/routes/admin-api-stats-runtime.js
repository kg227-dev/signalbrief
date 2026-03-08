async function handleAdminStatsRoute(ctx, deps) {
  const { req, res } = ctx;
  const {
    json, isAdminAuthed, emitIgnoredEventsIfDue, CONFIG, loadCostRunsNewest, allUsers, loadEngagementEvents, parseIsoTs,
    computeFeedbackTrend, digestRunStatus, getCachedOrRefreshSchedulerHeartbeat, readSchedulerHeartbeat, readJsonLineLog,
    ADMIN_MESSAGE_LOG, maskEmail, BASE_URL, computeNextDeliveryEt, formatDaysLabel, computeQualityTrend, parseEtNowParts,
  } = deps;
  const loadSchedulerHeartbeat = typeof getCachedOrRefreshSchedulerHeartbeat === "function"
    ? getCachedOrRefreshSchedulerHeartbeat
    : (typeof readSchedulerHeartbeat === "function" ? readSchedulerHeartbeat : (() => null));
if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
let ignoredBackfill = { emitted: 0, considered: 0 };
try {
  ignoredBackfill = emitIgnoredEventsIfDue({
    window_hours: Number(CONFIG?.digest?.ignoredWindowHours || 24),
    max_age_days: 45,
  }) || ignoredBackfill;
} catch (err) {
  if (process.env.DEBUG_WEB_SERVER === "1") {
    console.warn(`[web] ignored-events backfill failed: ${err.message}`);
  }
}
const runs = loadCostRunsNewest();

const now = new Date();
// Use ET date for month prefix so runs at 10 PM ET (= 3 AM UTC next day) aren't miscounted
const monthPrefix = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
const monthLabel  = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
const monthRuns = runs.filter(r => String(r?.date || "").startsWith(monthPrefix));
const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);
const monthDeliveries = sum(monthRuns, "users_served");
const monthUniqueUsersLog = new Set();
for (const r of monthRuns) {
  for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
    if (u && u.id) monthUniqueUsersLog.add(String(u.id));
  }
}
const usersAll = allUsers();
const referrals = usersAll
  .map((u) => {
    const source = u && typeof u.signup_referral_source === "object" ? u.signup_referral_source : null;
    if (!source) return null;
    return {
      referrerEmail: source.email || null,
      newUserEmail: u.email || null,
      ts: source.ts || null,
    };
  })
  .filter((row) => row && row.referrerEmail && row.newUserEmail && row.ts)
  .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

const nowMs = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const engagementEvents = loadEngagementEvents({ max_age_days: 120, dedupe: true });
const inWindow = (ev, days) => {
  const ts = parseIsoTs(ev?.ts_utc);
  return ts != null && ts >= (nowMs - (Math.max(1, Number(days || 1)) * DAY_MS));
};
function buildUniqueEngagementKey(ev) {
  const explicit = String(ev?.event_key || "").trim();
  if (explicit) return explicit;
  const digestId = String(ev?.digest_id || "").trim();
  const chatId = String(ev?.user_chat_id || "").trim();
  const type = String(ev?.event_type || "").trim();
  if (digestId || chatId || type) return `${type}:${digestId}:${chatId}`;
  const ts = String(ev?.ts_utc || "").trim();
  return ts ? `${type}:${ts}` : null;
}

function countUniqueEvents(events, predicate) {
  const keys = new Set();
  for (const ev of events) {
    if (!predicate(ev)) continue;
    const key = buildUniqueEngagementKey(ev);
    if (!key) continue;
    keys.add(key);
  }
  return keys.size;
}

// Open-rate method: unique email_open events divided by unique digest_sent(email) events.
const openEvents7d = countUniqueEvents(engagementEvents, (ev) =>
  String(ev?.event_type || "") === "email_open" && inWindow(ev, 7)
);
const openEvents30d = countUniqueEvents(engagementEvents, (ev) =>
  String(ev?.event_type || "") === "email_open" && inWindow(ev, 30)
);
const digestEmailSent7d = countUniqueEvents(engagementEvents, (ev) =>
  String(ev?.event_type || "") === "digest_sent"
  && String(ev?.channel || "") === "email"
  && inWindow(ev, 7)
);
const digestEmailSent30d = countUniqueEvents(engagementEvents, (ev) =>
  String(ev?.event_type || "") === "digest_sent"
  && String(ev?.channel || "") === "email"
  && inWindow(ev, 30)
);
const openRate7d = digestEmailSent7d > 0 ? Number((openEvents7d / digestEmailSent7d).toFixed(4)) : 0;
const openRate30d = digestEmailSent30d > 0 ? Number((openEvents30d / digestEmailSent30d).toFixed(4)) : 0;
const totalActive = usersAll.filter((u) => String(u?.status || "active") === "active").length;
const totalPaused = usersAll.filter((u) => String(u?.status || "") === "paused").length;
const totalUnsubscribed = usersAll.filter((u) => String(u?.status || "") === "unsubscribed").length;
const inReengagementDay4 = usersAll.filter((u) => {
  if (String(u?.status || "active") !== "active") return false;
  const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
  return !!rs.day4_sent_at && !rs.day8_sent_at && !rs.auto_paused_at;
}).length;
const inReengagementDay8 = usersAll.filter((u) => {
  if (String(u?.status || "active") !== "active") return false;
  const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
  return !!rs.day8_sent_at && !rs.auto_paused_at;
}).length;
const autoPausedLast30d = usersAll.filter((u) => {
  const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
  const ts = parseIsoTs(rs.auto_paused_at);
  return ts != null && ts >= (nowMs - (30 * DAY_MS));
}).length;
const engagement = {
  total_active: totalActive,
  total_paused: totalPaused,
  total_unsubscribed: totalUnsubscribed,
  open_rate_7d: openRate7d,
  open_rate_30d: openRate30d,
  in_reengagement_day4: inReengagementDay4,
  in_reengagement_day8: inReengagementDay8,
  auto_paused_last_30d: autoPausedLast30d,
  referral_signups_total: referrals.length,
};

// Per-user rollup across all runs — divide run cost by number of users served
const userMap = {};
for (const r of runs) {
  const usersServed = r.users_served || 1;
  for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
    if (!userMap[u.id]) userMap[u.id] = { id: u.id, runs: 0, total_cost: 0 };
    userMap[u.id].runs++;
    // Attribute each user their fair share of the run cost
    userMap[u.id].total_cost += (r.total_cost_usd || 0) / usersServed;
  }
}
const perUser = Object.values(userMap)
  .map(u => ({ ...u, total_cost: parseFloat(u.total_cost.toFixed(5)) }))
  .sort((a, b) => b.total_cost - a.total_cost);

// User roster for admin view
// Convert UTC timestamps to ET dates (users signing up after 7 PM ET appear as next UTC day)
const toETDate = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
const depthLabel = d => ({ headline_only: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" }[d] || "Deep");

// Count scheduled delivery days elapsed since last_digest_at with no delivery.
// Walks back from yesterday (excludes today — delivery may still be pending).
const DOW_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function calcDaysMissed(lastDigestAtIso, daysOfWeek) {
  if (!lastDigestAtIso) return 0; // never delivered — not "missed"
  const toET = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayET  = toET(new Date().toISOString());
  const lastET   = toET(lastDigestAtIso);
  if (lastET >= todayET) return 0; // delivered today
  let missed = 0;
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 1); // start from yesterday
  for (let i = 0; i < 14; i++) {
    const curET = toET(cursor.toISOString());
    if (curET <= lastET) break;
    const dowET = DOW_NAMES.indexOf(
      cursor.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })
    );
    if ((daysOfWeek || [1,2,3,4,5]).includes(dowET)) missed++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return missed;
}

const roster = usersAll.map(u => {
  const prefs = u.preferences || {};
  const qualityTrend = computeQualityTrend(u.quality_history || []);
  const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
  const ampm = dh >= 12 ? "PM" : "AM";
  const hour = dh % 12 || 12;
  const min  = dm === 0 ? "" : `:${String(dm).padStart(2,"0")}`;
  const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
  const daysLabel = formatDaysLabel(allowedDays);
  const nextDelivery = u.status === "active" ? computeNextDeliveryEt(prefs) : null;
  const tgLinked = !!(u.chatId && !u.chatId.startsWith("email-"));
  const adminUserPath = u.email ? `/admin/user?email=${encodeURIComponent(u.email)}` : null;
  const archivePath = u.email
    ? (u.token
      ? `/archive?token=${encodeURIComponent(u.token)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`
      : `/archive?email=${encodeURIComponent(u.email)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`)
    : null;
  return {
    name:               u.name || "",
    email:              u.email || "",
    chat_id:            u.chatId || "",
    status:             u.status || "active",
    joined:             toETDate(u.joined_at),
    digests:            u.digests_received || 0,
    last_digest:        toETDate(u.last_digest_at),
    telegram:           tgLinked,
    email_enabled:      prefs.email_enabled !== false,
    telegram_enabled:   !!(prefs.telegram_enabled && tgLinked),
    topics:             (u.topics || []).length,
    topics_raw:         Array.isArray(u.topics) ? u.topics : [],
    topics_list:        (u.topics || []).map(t => t.replace(/^custom_/,"").replace(/_/g," ")).join(", ") || "—",
    bookmarks:          (u.bookmarks || []).length,
    adjustments:        Object.keys(u.topic_weights || {}).length,
    topic_weights:      u.topic_weights || {},
    last_digest_preview: (u.last_digest_items || []).slice(0, 3).map(item => ({
      headline: (item.headline || "").slice(0, 80),
      tag:      item.tag || "",
      url:      item.url || "",
    })),
    last_digest_item_count: Array.isArray(u.last_digest_items) ? u.last_digest_items.length : 0,
    days_missed:        u.status === "active" ? calcDaysMissed(u.last_digest_at, allowedDays) : 0,
    delivery_time:      `${hour}${min} ${ampm} ET`,
    delivery_time_raw:  prefs.delivery_time || "07:00",
    days_of_week:       allowedDays,
    days_label:         daysLabel,
    timezone:           prefs.timezone || "America/New_York",
    items_per_digest:   parseInt(prefs.items_per_digest, 10) || 5,
    depth:              depthLabel(prefs.depth),
    next_delivery_et:   nextDelivery?.label || "—",
    next_delivery_key:  nextDelivery?.key || null,
    settings_url:       adminUserPath ? `${BASE_URL}${adminUserPath}` : null,
    archive_url:        archivePath ? `${BASE_URL}${archivePath}` : null,
    dqs_current:        qualityTrend.current,
    dqs_7d_avg:         qualityTrend.avg_7d,
    dqs_14d_delta:      qualityTrend.delta_14d,
    dqs_floor_14d:      qualityTrend.floor_14d,
    dqs_band:           qualityTrend.band || null,
    dqs_sample_14d:     qualityTrend.sample_14d || 0,
  };
}).sort((a, b) => (b.digests - a.digests));
const activeUsersCount = roster.filter(u => u.status === "active").length;
const activeTelegramUsersCount = roster.filter(u => u.status === "active" && u.telegram).length;
const monthUsersServedFromRoster = roster.filter(u => u.last_digest && u.last_digest.startsWith(monthPrefix)).length;

// Users whose deliveries appear to be falling behind (2+ scheduled days missed)
const deliveryWarnings = roster
  .filter(u => u.status === "active" && u.days_missed >= 2)
  .map(u => ({ name: u.name || u.email, email: u.email, days_missed: u.days_missed }));

// Delivery reliability snapshot (last 7 completed ET days vs previous 7)
const activeRoster = roster.filter(u => u.status === "active");
const activeEmailSet = new Set(
  activeRoster
    .map(u => String(u.email || "").toLowerCase().trim())
    .filter(Boolean)
);
const nowEt = parseEtNowParts();
const toEtDateOffset = offset => {
  const d = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + offset));
  return {
    dateKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    dow: d.getUTCDay(),
  };
};
const buildWindow = (startOffset, endOffset) => {
  const rows = [];
  for (let offset = startOffset; offset <= endOffset; offset++) rows.push(toEtDateOffset(offset));
  return rows;
};
const currentWindow = buildWindow(-7, -1);
const previousWindow = buildWindow(-14, -8);
const expectedScheduledCount = (windowRows) => {
  let total = 0;
  for (const day of windowRows) {
    for (const u of activeRoster) {
      const allowedDays = Array.isArray(u.days_of_week) && u.days_of_week.length
        ? u.days_of_week.map(Number)
        : [1, 2, 3, 4, 5];
      if (allowedDays.includes(day.dow)) total++;
    }
  }
  return total;
};
const deliveredScheduledCount = (windowRows) => {
  const allowedDates = new Set(windowRows.map(row => row.dateKey));
  const deliveredSet = new Set();
  for (const run of runs) {
    if (run.on_demand) continue;
    const dateKey = String(run.date || "");
    if (!allowedDates.has(dateKey)) continue;
    const perUsers = Array.isArray(run.per_user) ? run.per_user : [];
    for (const pu of perUsers) {
      const uid = String((pu && pu.id) || "").toLowerCase().trim();
      if (!uid || !activeEmailSet.has(uid)) continue;
      deliveredSet.add(`${dateKey}|${uid}`);
    }
  }
  return deliveredSet.size;
};
const expectedCurrent7d = expectedScheduledCount(currentWindow);
const deliveredCurrent7d = deliveredScheduledCount(currentWindow);
const expectedPrevious7d = expectedScheduledCount(previousWindow);
const deliveredPrevious7d = deliveredScheduledCount(previousWindow);
const missedCurrent7d = Math.max(0, expectedCurrent7d - deliveredCurrent7d);
const missedPrevious7d = Math.max(0, expectedPrevious7d - deliveredPrevious7d);
const missedDelta7d = missedCurrent7d - missedPrevious7d;
const successRate7d = expectedCurrent7d > 0
  ? Number(((deliveredCurrent7d / expectedCurrent7d) * 100).toFixed(1))
  : 100;
const missedTrendLabel = missedDelta7d === 0
  ? "Flat vs prior 7d"
  : `${missedDelta7d > 0 ? "+" : ""}${missedDelta7d} missed vs prior 7d`;
const lastSuccessfulScheduledRun = runs.find(r => !r.on_demand && (r.users_served || 0) > 0) || null;
const nextExpectedActiveDelivery = activeRoster
  .filter(u => u.next_delivery_key)
  .sort((a, b) => String(a.next_delivery_key || "").localeCompare(String(b.next_delivery_key || "")))[0] || null;
const minutesUntilEtKey = key => {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ET$/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mm] = m;
  const nowStamp = Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day, nowEt.hour, nowEt.minute);
  const targetStamp = Date.UTC(parseInt(yy, 10), parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mm, 10));
  return Math.max(0, Math.round((targetStamp - nowStamp) / 60000));
};
const formatCountdown = totalMinutes => {
  if (totalMinutes == null) return "—";
  const mins = Math.max(0, totalMinutes);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};
const nextExpectedCountdownMinutes = nextExpectedActiveDelivery
  ? minutesUntilEtKey(nextExpectedActiveDelivery.next_delivery_key)
  : null;
const digestRun = digestRunStatus();
const schedulerWorker = loadSchedulerHeartbeat();

// Health / system status
const lastRun = runs[0] || null; // runs is newest-first
const serverUptimeSecs = Math.floor(process.uptime());
const uptimeHours = Math.floor(serverUptimeSecs / 3600);
const uptimeMins  = Math.floor((serverUptimeSecs % 3600) / 60);
const uptimeStr   = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;
const adminMessages = readJsonLineLog(ADMIN_MESSAGE_LOG, 30).map(m => ({
  at: m.at || null,
  actor: m.actor || "unknown",
  action: m.action || "message_user",
  target_email: m.target_email || null,
  target_email_masked: maskEmail(m.target_email || ""),
  target_chat_id: m.target_chat_id || null,
  requested_channels: Array.isArray(m.requested_channels) ? m.requested_channels : [],
  sent_channels: Array.isArray(m.sent_channels) ? m.sent_channels : [],
  success: !!m.success,
  errors: Array.isArray(m.errors) ? m.errors : [],
  message_preview: m.message_preview || "",
  payload_hash: m.payload_hash || null,
}));

const qualityUsers = roster.filter((u) => Number.isFinite(Number(u.dqs_current)));
const qualityCurrentAvg = qualityUsers.length
  ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
  : null;
const quality7dAvg = qualityUsers.length
  ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_7d_avg || u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
  : null;
const qualityImproving14d = qualityUsers.filter((u) => Number(u.dqs_14d_delta || 0) >= 5).length;
const qualityAtRisk = qualityUsers.filter((u) => Number(u.dqs_current || 0) < 75).length;
const feedbackTrend = computeFeedbackTrend(usersAll);

return json(res, {
  summary: {
    all_time_cost:      parseFloat(sum(runs, "total_cost_usd").toFixed(4)),
    all_time_runs:      runs.length,
    all_time_deliveries: sum(runs, "users_served"),
    month_cost:         parseFloat(sum(monthRuns, "total_cost_usd").toFixed(4)),
    month_runs:         monthRuns.length,
    month_on_demand:    monthRuns.filter(r => r.on_demand).length,
    month_users_served: monthUsersServedFromRoster,
    month_unique_users: monthUsersServedFromRoster,
    month_unique_users_log: monthUniqueUsersLog.size,
    month_deliveries:   monthDeliveries,
    total_users:        roster.length,
    active_users:       activeUsersCount,
    active_tg_users:    activeTelegramUsersCount,
    month_label:        monthLabel,
    quality: {
      users_scored: qualityUsers.length,
      dqs_current_avg: qualityCurrentAvg,
      dqs_7d_avg: quality7dAvg,
      improving_14d: qualityImproving14d,
      at_risk: qualityAtRisk,
    },
    feedback: feedbackTrend,
  },
  health: {
    server_uptime:            uptimeStr,
    last_run_at:              lastRun ? lastRun.run_at_et || lastRun.run_at : null,
    last_run_users:           lastRun ? lastRun.users_served : null,
    last_run_cost:            lastRun ? `$${(lastRun.total_cost_usd || 0).toFixed(4)}` : null,
    cron_schedule:            "5-minute worker loop (always-on VM)",
    users_delivery_warning:   deliveryWarnings,
    delivery_reliability: {
      success_rate_7d: successRate7d,
      delivered_7d: deliveredCurrent7d,
      expected_7d: expectedCurrent7d,
      missed_current_7d: missedCurrent7d,
      missed_previous_7d: missedPrevious7d,
      missed_delta_7d: missedDelta7d,
      missed_trend_label: missedTrendLabel,
      last_successful_scheduled_run: lastSuccessfulScheduledRun
        ? (lastSuccessfulScheduledRun.run_at_et || lastSuccessfulScheduledRun.run_at || null)
        : null,
      next_expected_delivery_et: nextExpectedActiveDelivery?.next_delivery_et || null,
      next_expected_countdown: formatCountdown(nextExpectedCountdownMinutes),
      next_expected_countdown_minutes: nextExpectedCountdownMinutes,
    },
    scheduler_worker:         schedulerWorker,
    digest_runner: digestRun.running
      ? {
        running: true,
        state: digestRun.state || "valid",
        unhealthy: digestRun.state === "corrupt" || digestRun.state === "io_error" || digestRun.state === "stale_uncleared",
        mode: digestRun.lock.mode || "scheduled",
        started_at: digestRun.lock.startedAtIso || digestRun.lock.startedAt || null,
        age_seconds: Math.max(0, Math.round((digestRun.lock.ageMs || 0) / 1000)),
        pid: digestRun.lock.pid || null,
        error: digestRun.lock.error || null,
      }
      : { running: false, state: digestRun.state || "absent", unhealthy: false },
    engagement_events: {
      ignored_backfill_emitted: ignoredBackfill.emitted || 0,
      ignored_backfill_considered: ignoredBackfill.considered || 0,
    },
  },
  runs: runs.slice(0, 30),
  per_user: perUser,
  roster,
  engagement,
  referrals,
  admin_messages: adminMessages,
});
}

module.exports = {
  handleAdminStatsRoute,
};
