function buildReferrals(usersAll) {
  return usersAll
    .map((user) => {
      const source = user && typeof user.signup_referral_source === "object" ? user.signup_referral_source : null;
      if (!source) return null;
      return {
        referrerEmail: source.email || null,
        newUserEmail: user.email || null,
        ts: source.ts || null,
      };
    })
    .filter((row) => row && row.referrerEmail && row.newUserEmail && row.ts)
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
}

function buildUniqueEngagementKey(event) {
  const explicit = String(event?.event_key || "").trim();
  if (explicit) return explicit;
  const digestId = String(event?.digest_id || "").trim();
  const chatId = String(event?.user_chat_id || "").trim();
  const type = String(event?.event_type || "").trim();
  if (digestId || chatId || type) return `${type}:${digestId}:${chatId}`;
  const ts = String(event?.ts_utc || "").trim();
  return ts ? `${type}:${ts}` : null;
}

function createWindowPredicate({ nowMs, dayMs, parseIsoTs }) {
  return function inWindow(event, days) {
    const ts = parseIsoTs(event?.ts_utc);
    return ts != null && ts >= (nowMs - (Math.max(1, Number(days || 1)) * dayMs));
  };
}

function countUniqueEvents(events, predicate) {
  const keys = new Set();
  for (const event of events) {
    if (!predicate(event)) continue;
    const key = buildUniqueEngagementKey(event);
    if (!key) continue;
    keys.add(key);
  }
  return keys.size;
}

function countUsersByStatus(usersAll, status) {
  return usersAll.filter((user) => String(user?.status || "active") === status).length;
}

function buildEngagementMetrics({
  usersAll,
  referrals,
  loadEngagementEvents,
  parseIsoTs,
  nowMs = Date.now(),
}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const engagementEvents = loadEngagementEvents({ max_age_days: 120, dedupe: true });
  const inWindow = createWindowPredicate({ nowMs, dayMs, parseIsoTs });

  const openEvents7d = countUniqueEvents(engagementEvents, (event) =>
    String(event?.event_type || "") === "email_open" && inWindow(event, 7)
  );
  const openEvents30d = countUniqueEvents(engagementEvents, (event) =>
    String(event?.event_type || "") === "email_open" && inWindow(event, 30)
  );
  const digestEmailSent7d = countUniqueEvents(engagementEvents, (event) =>
    String(event?.event_type || "") === "digest_sent"
    && String(event?.channel || "") === "email"
    && inWindow(event, 7)
  );
  const digestEmailSent30d = countUniqueEvents(engagementEvents, (event) =>
    String(event?.event_type || "") === "digest_sent"
    && String(event?.channel || "") === "email"
    && inWindow(event, 30)
  );
  const openRate7d = digestEmailSent7d > 0 ? Number((openEvents7d / digestEmailSent7d).toFixed(4)) : 0;
  const openRate30d = digestEmailSent30d > 0 ? Number((openEvents30d / digestEmailSent30d).toFixed(4)) : 0;
  const totalActive = countUsersByStatus(usersAll, "active");
  const totalPaused = countUsersByStatus(usersAll, "paused");
  const totalUnsubscribed = countUsersByStatus(usersAll, "unsubscribed");

  return {
    total_active: totalActive,
    total_paused: totalPaused,
    total_unsubscribed: totalUnsubscribed,
    open_rate_7d: openRate7d,
    open_rate_30d: openRate30d,
    referral_signups_total: referrals.length,
  };
}

module.exports = {
  buildReferrals,
  buildEngagementMetrics,
};
