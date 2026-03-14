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

function buildAdminRosterEntry({
  user,
  computeQualityTrend,
  formatDaysLabel,
  computeNextDeliveryEt,
}) {
  const prefs = user.preferences || {};
  const qualityTrend = computeQualityTrend(user.quality_history || []);
  const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
  const daysLabel = formatDaysLabel(allowedDays);
  const nextDelivery = user.status === "active" ? computeNextDeliveryEt(prefs) : null;
  const tgLinked = !!(user.chatId && !user.chatId.startsWith("email-"));
  const adminUserPath = user.email ? `/admin/user?email=${encodeURIComponent(user.email)}` : null;
  const archivePath = buildArchivePath(user, adminUserPath);
  const settingsPath = buildSettingsPath(user, adminUserPath);

  return {
    name: user.name || "",
    email: user.email || "",
    chat_id: user.chatId || "",
    status: user.status || "active",
    joined: toETDate(user.joined_at),
    digests: user.digests_received || 0,
    last_digest: toETDate(user.last_digest_at),
    telegram: tgLinked,
    email_enabled: prefs.email_enabled !== false,
    telegram_enabled: !!(prefs.telegram_enabled && tgLinked),
    topics: (user.topics || []).length,
    topics_raw: Array.isArray(user.topics) ? user.topics : [],
    topics_list: buildTopicsList(user.topics),
    bookmarks: (user.bookmarks || []).length,
    adjustments: Object.keys(user.topic_weights || {}).length,
    topic_weights: user.topic_weights || {},
    last_digest_preview: buildLastDigestPreview(user),
    last_digest_item_count: Array.isArray(user.last_digest_items) ? user.last_digest_items.length : 0,
    days_missed: user.status === "active" ? calcDaysMissed(user.last_digest_at, allowedDays) : 0,
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
  computeQualityTrend,
  formatDaysLabel,
  computeNextDeliveryEt,
}) {
  return usersAll
    .map((user) => buildAdminRosterEntry({
      user,
      computeQualityTrend,
      formatDaysLabel,
      computeNextDeliveryEt,
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
};
