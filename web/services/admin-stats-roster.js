function toETDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}

function depthLabel(depth) {
  return (
    {
      headline_only: "Scan",
      headline_plus_oneliner: "Brief",
      headline_plus_why: "Deep",
      full: "Deep",
      deep: "Deep",
    }[depth] || "Deep"
  );
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function calcDaysMissed(lastDigestAtIso, daysOfWeek) {
  if (!lastDigestAtIso) return 0;
  const todayET = toETDate(new Date().toISOString());
  const lastET = toETDate(lastDigestAtIso);
  if (lastET >= todayET) return 0;

  let missed = 0;
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 14; i++) {
    const curET = toETDate(cursor.toISOString());
    if (curET <= lastET) break;
    const dowET = DOW_NAMES.indexOf(
      cursor.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })
    );
    if ((daysOfWeek || [1, 2, 3, 4, 5]).includes(dowET)) missed++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return missed;
}

function formatDeliveryTimeLabel(deliveryTime) {
  const [dh, dm] = String(deliveryTime || "07:00").split(":").map(Number);
  const ampm = dh >= 12 ? "PM" : "AM";
  const hour = dh % 12 || 12;
  const min = dm === 0 ? "" : `:${String(dm).padStart(2, "0")}`;
  return `${hour}${min} ${ampm} ET`;
}

function buildArchivePath(user, adminUserPath) {
  if (!user.email) return null;
  if (user.token) {
    return `/archive?token=${encodeURIComponent(user.token)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`;
  }
  return `/archive?email=${encodeURIComponent(user.email)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`;
}

function buildSettingsPath(user, adminUserPath) {
  if (user.token) {
    return `/settings?token=${encodeURIComponent(user.token)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`;
  }
  if (user.email) {
    return `/settings?email=${encodeURIComponent(user.email)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`;
  }
  if (adminUserPath) return adminUserPath;
  return null;
}

function buildLastDigestPreview(user) {
  return (user.last_digest_items || []).slice(0, 3).map((item) => ({
    headline: (item.headline || "").slice(0, 80),
    tag: item.tag || "",
    url: item.url || "",
  }));
}

function buildTopicsList(topics) {
  return (topics || []).map((topic) => topic.replace(/^custom_/, "").replace(/_/g, " ")).join(", ") || "—";
}

function toComparableTs(value) {
  const ts = Date.parse(String(value || "").trim());
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeRecentDigestRows(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
}

function buildRecentDigestLookup(rows = []) {
  const byAny = new Map();
  const byScheduled = new Map();

  function applyRow(map, key, row) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) return;
    const existing = map.get(normalizedKey);
    const rowTs = Math.max(
      toComparableTs(row?.run_at_utc),
      toComparableTs(row?.sent_at_utc),
      toComparableTs(row?.generated_at_utc)
    );
    const existingTs = existing
      ? Math.max(
        toComparableTs(existing?.run_at_utc),
        toComparableTs(existing?.sent_at_utc),
        toComparableTs(existing?.generated_at_utc)
      )
      : 0;
    if (!existing || rowTs >= existingTs) map.set(normalizedKey, row);
  }

  for (const row of normalizeRecentDigestRows(rows)) {
    const keys = new Set([
      String(row?.user_id || "").trim().toLowerCase(),
      String(row?.recipient || "").trim().toLowerCase(),
      String(row?.user_email || "").trim().toLowerCase(),
    ].filter(Boolean));
    const mode = String(row?.mode || "").trim().toLowerCase();
    for (const key of keys) {
      applyRow(byAny, key, row);
      if (mode === "scheduled") applyRow(byScheduled, key, row);
    }
  }

  return { byAny, byScheduled };
}

function getRecentDigestRow(lookup, user) {
  const keys = [
    String(user?.chatId || "").trim().toLowerCase(),
    String(user?.email || "").trim().toLowerCase(),
  ].filter(Boolean);
  for (const key of keys) {
    const row = lookup.get(key);
    if (row) return row;
  }
  return null;
}

function buildAdminRosterEntry({
  user,
  countArchiveDigestsForUser,
  computeQualityTrend,
  formatDaysLabel,
  computeNextDeliveryEt,
  recentDigestLookup,
}) {
  const prefs = user.preferences || {};
  const anyRecentRow = recentDigestLookup?.byAny ? getRecentDigestRow(recentDigestLookup.byAny, user) : null;
  const recentScheduledRow = recentDigestLookup?.byScheduled ? getRecentDigestRow(recentDigestLookup.byScheduled, user) : null;
  const persistedLastDigestAt = String(user.last_digest_at || "").trim() || null;
  const recentLastDigestAt = String(anyRecentRow?.run_at_utc || anyRecentRow?.sent_at_utc || "").trim() || null;
  const useRecentDigestState = toComparableTs(recentLastDigestAt) > toComparableTs(persistedLastDigestAt);
  const effectiveLastDigestAt = useRecentDigestState ? recentLastDigestAt : persistedLastDigestAt;
  const effectiveLastDigestItems = useRecentDigestState
    ? (Array.isArray(anyRecentRow?.sent_items) ? anyRecentRow.sent_items : [])
    : (Array.isArray(user.last_digest_items) ? user.last_digest_items : []);
  const recentScheduledAt = String(recentScheduledRow?.run_at_utc || recentScheduledRow?.sent_at_utc || "").trim() || null;
  const qualityTrend = computeQualityTrend(user.quality_history || []);
  const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
  const daysLabel = formatDaysLabel(allowedDays);
  const nextDelivery = user.status === "active" ? computeNextDeliveryEt(prefs) : null;
  const tgLinked = !!(user.chatId && !user.chatId.startsWith("email-"));
  const adminUserPath = user.email ? `/admin/user?email=${encodeURIComponent(user.email)}` : null;
  const archivePath = buildArchivePath(user, adminUserPath);
  const settingsPath = buildSettingsPath(user, adminUserPath);
  const archiveDigestCountRaw = typeof countArchiveDigestsForUser === "function"
    ? Number(countArchiveDigestsForUser(user))
    : NaN;
  const archiveDigestCount = Number.isFinite(archiveDigestCountRaw) ? Math.max(0, archiveDigestCountRaw) : null;
  const digestCount = archiveDigestCount != null ? archiveDigestCount : Math.max(0, Number(user.digests_received || 0));

  return {
    name: user.name || "",
    email: user.email || "",
    chat_id: user.chatId || "",
    status: user.status || "active",
    joined: toETDate(user.joined_at),
    digests: digestCount,
    archive_digest_count: digestCount,
    digests_legacy: Math.max(0, Number(user.digests_received || 0)),
    last_digest: toETDate(effectiveLastDigestAt),
    last_scheduled_digest: toETDate(recentScheduledAt),
    telegram: tgLinked,
    email_enabled: prefs.email_enabled !== false,
    telegram_enabled: !!(prefs.telegram_enabled && tgLinked),
    topics: (user.topics || []).length,
    topics_raw: Array.isArray(user.topics) ? user.topics : [],
    topics_list: buildTopicsList(user.topics),
    bookmarks: (user.bookmarks || []).length,
    adjustments: Object.keys(user.topic_weights || {}).length,
    topic_weights: user.topic_weights || {},
    last_digest_preview: buildLastDigestPreview({ last_digest_items: effectiveLastDigestItems }),
    last_digest_item_count: effectiveLastDigestItems.length,
    last_scheduled_digest_item_count: Array.isArray(recentScheduledRow?.sent_items) ? recentScheduledRow.sent_items.length : 0,
    days_missed: user.status === "active" ? calcDaysMissed(effectiveLastDigestAt, allowedDays) : 0,
    delivery_time: formatDeliveryTimeLabel(prefs.delivery_time || "07:00"),
    delivery_time_raw: prefs.delivery_time || "07:00",
    days_of_week: allowedDays,
    days_label: daysLabel,
    timezone: prefs.timezone || "America/New_York",
    items_per_digest: parseInt(prefs.items_per_digest, 10) || 5,
    depth: depthLabel(prefs.depth),
    next_delivery_et: nextDelivery?.label || "—",
    next_delivery_key: nextDelivery?.key || null,
    settings_url: settingsPath,
    archive_url: archivePath,
    dqs_current: qualityTrend.current,
    dqs_7d_avg: qualityTrend.avg_7d,
    dqs_14d_delta: qualityTrend.delta_14d,
    dqs_floor_14d: qualityTrend.floor_14d,
    dqs_band: qualityTrend.band || null,
    dqs_sample_14d: qualityTrend.sample_14d || 0,
  };
}

function buildAdminRoster({
  usersAll,
  countArchiveDigestsForUser,
  computeQualityTrend,
  formatDaysLabel,
  computeNextDeliveryEt,
  recentDigestRows,
}) {
  const recentDigestLookup = buildRecentDigestLookup(recentDigestRows);
  return usersAll
    .map((user) => buildAdminRosterEntry({
      user,
      countArchiveDigestsForUser,
      computeQualityTrend,
      formatDaysLabel,
      computeNextDeliveryEt,
      recentDigestLookup,
    }))
    .sort((a, b) => (b.digests - a.digests));
}

function buildDeliveryWarnings(roster) {
  return roster
    .filter((user) => user.status === "active" && user.days_missed >= 2)
    .map((user) => ({ name: user.name || user.email, email: user.email, days_missed: user.days_missed }));
}

module.exports = {
  buildAdminRoster,
  buildDeliveryWarnings,
  buildRecentDigestLookup,
};
