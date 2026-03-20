"use strict";

function toEtDateKey(value = new Date()) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function shiftDateKey(dateKey, offsetDays) {
  const parts = String(dateKey || "").split("-").map((value) => Number(value));
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) return "";
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
  return date.toISOString().slice(0, 10);
}

function resolveWindow(days, now = new Date()) {
  const normalizedDays = Math.min(60, Math.max(1, Number(days || 7)));
  const endDateEt = toEtDateKey(now);
  const startDateEt = shiftDateKey(endDateEt, -normalizedDays + 1);
  return {
    days: normalizedDays,
    startDateEt,
    endDateEt,
  };
}

function normalizeMode(perUserRow, run) {
  const explicit = String(perUserRow?.delivery_mode || "").trim().toLowerCase();
  if (explicit) return explicit;
  const runId = String(run?.run_id || "").trim();
  const runMode = runId.includes(":") ? runId.split(":")[0].toLowerCase() : "";
  if (runMode === "scheduled") return "scheduled";
  if (runMode === "targeted") return "manual";
  if (runMode) return runMode;
  return run?.on_demand ? "manual" : "scheduled";
}

function normalizeItem(item) {
  return {
    index: Number.isFinite(Number(item?.index)) ? Number(item.index) : null,
    headline: String(item?.headline || "").trim() || null,
    url: String(item?.url || "").trim() || null,
    tag: String(item?.tag || "").trim() || null,
    base_score: Number.isFinite(Number(item?.base_score)) ? Number(item.base_score) : null,
    topic_match: Number.isFinite(Number(item?.topic_match)) ? Number(item.topic_match) : null,
    relevance_score: Number.isFinite(Number(item?.relevance_score)) ? Number(item.relevance_score) : null,
    source_domain: String(item?.source_domain || "").trim() || null,
    storyline_key: String(item?.storyline_key || "").trim() || null,
  };
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map(normalizeItem);
}

function createEventAggregate() {
  return {
    channels: new Set(),
    opens: 0,
    clicks: 0,
    saves: 0,
    ignored: 0,
    feedback_submitted: 0,
    feedback_labels: [],
    sent_at: null,
    sent_items: [],
    quality_score: null,
    quality_band: null,
  };
}

function applyEventToAggregate(aggregate, event) {
  const target = aggregate || createEventAggregate();
  const eventType = String(event?.event_type || "").trim();
  const channel = String(event?.channel || "").trim();
  if (channel) target.channels.add(channel);

  if (eventType === "digest_sent") {
    const ts = String(event?.ts_utc || "").trim();
    if (ts && (!target.sent_at || ts > target.sent_at)) target.sent_at = ts;
    const items = normalizeItems(event?.metadata?.items);
    if (items.length >= target.sent_items.length) target.sent_items = items;
    const qualityScore = Number(event?.metadata?.quality_score);
    if (Number.isFinite(qualityScore)) target.quality_score = qualityScore;
    const qualityBand = String(event?.metadata?.quality_band || "").trim();
    if (qualityBand) target.quality_band = qualityBand;
    return target;
  }
  if (eventType === "email_open") target.opens += 1;
  if (eventType === "item_clicked") target.clicks += 1;
  if (eventType === "item_saved") target.saves += 1;
  if (eventType === "item_ignored_computed") target.ignored += 1;
  if (eventType === "digest_feedback_submitted") {
    target.feedback_submitted += 1;
    const label = String(event?.feedback?.label || "").trim();
    if (label) target.feedback_labels.push(label);
  }
  return target;
}

function buildEventIndex(events, startDateEt) {
  const exact = new Map();
  const digestOnly = new Map();

  for (const event of (Array.isArray(events) ? events : [])) {
    const digestId = String(event?.digest_id || "").trim();
    if (!digestId) continue;
    const dateEt = String(event?.date_et || digestId.split(":")[0] || "").trim();
    if (startDateEt && dateEt < startDateEt) continue;

    const runId = String(event?.run_id || "").trim();
    const exactKey = runId ? `${digestId}::${runId}` : "";
    const digestKey = digestId;

    const digestAggregate = applyEventToAggregate(digestOnly.get(digestKey), event);
    digestOnly.set(digestKey, digestAggregate);

    if (exactKey) {
      const exactAggregate = applyEventToAggregate(exact.get(exactKey), event);
      exact.set(exactKey, exactAggregate);
    }
  }

  return { exact, digestOnly };
}

function mergeEventAggregates(primary, fallback) {
  const base = primary || createEventAggregate();
  if (!fallback) return base;

  const merged = createEventAggregate();
  merged.channels = new Set([...(base.channels || []), ...(fallback.channels || [])]);
  merged.opens = Math.max(Number(base.opens || 0), Number(fallback.opens || 0));
  merged.clicks = Math.max(Number(base.clicks || 0), Number(fallback.clicks || 0));
  merged.saves = Math.max(Number(base.saves || 0), Number(fallback.saves || 0));
  merged.ignored = Math.max(Number(base.ignored || 0), Number(fallback.ignored || 0));
  merged.feedback_submitted = Math.max(Number(base.feedback_submitted || 0), Number(fallback.feedback_submitted || 0));
  merged.feedback_labels = Array.from(new Set([...(base.feedback_labels || []), ...(fallback.feedback_labels || [])]));
  merged.sent_at = String(base.sent_at || fallback.sent_at || "").trim() || null;
  merged.sent_items = Array.isArray(base.sent_items) && base.sent_items.length > 0 ? base.sent_items : fallback.sent_items;
  merged.quality_score = Number.isFinite(Number(base.quality_score)) ? Number(base.quality_score) : fallback.quality_score;
  merged.quality_band = String(base.quality_band || fallback.quality_band || "").trim() || null;
  return merged;
}

function lookupUser(allUsers, userId, recipient) {
  const users = Array.isArray(allUsers) ? allUsers : [];
  const normalizedUserId = String(userId || "").trim();
  const normalizedRecipient = String(recipient || "").trim().toLowerCase();
  return users.find((user) => (
    String(user?.chatId || "").trim() === normalizedUserId
    || String(user?.email || "").trim().toLowerCase() === normalizedRecipient
  )) || null;
}

function createRecentDigestsExporter(deps) {
  const {
    loadCostRunsNewest,
    allUsers,
    loadEngagementEvents,
    loadDigestSnapshotByRunId,
    loadLatestDigestSnapshot,
  } = deps;

  return function buildRecentDigestsExport(options = {}) {
    const window = resolveWindow(options.days, options.now || new Date());
    const runs = typeof loadCostRunsNewest === "function" ? loadCostRunsNewest() : [];
    const users = typeof allUsers === "function" ? allUsers() : [];
    const eventIndex = buildEventIndex(
      typeof loadEngagementEvents === "function"
        ? loadEngagementEvents({
          max_age_days: Math.max(window.days + 2, 14),
          dedupe: false,
          capture_parse_error_lines: false,
        })
        : [],
      window.startDateEt
    );

    const rows = [];
    for (const run of (Array.isArray(runs) ? runs : [])) {
      const dateEt = String(run?.date || "").trim();
      if (!dateEt || dateEt < window.startDateEt || dateEt > window.endDateEt) continue;

      for (const perUserRow of (Array.isArray(run?.per_user) ? run.per_user : [])) {
        const digestId = String(perUserRow?.digest_id || "").trim();
        if (!digestId) continue;
        const runId = String(run?.run_id || "").trim();
        const userId = String(digestId.split(":").slice(1).join(":") || "").trim();
        const recipient = String(perUserRow?.id || "").trim();
        const matchedUser = lookupUser(users, userId, recipient);
        const exactEvents = eventIndex.exact.get(`${digestId}::${runId}`) || null;
        const digestEvents = eventIndex.digestOnly.get(digestId) || null;
        const events = mergeEventAggregates(exactEvents, digestEvents);
        const engagementScope = exactEvents ? (digestEvents ? "run+digest" : "run") : (digestEvents ? "digest" : "none");

        const snapshot = typeof loadDigestSnapshotByRunId === "function"
          ? loadDigestSnapshotByRunId(userId, dateEt, runId)
          : null;
        const fallbackSnapshot = !snapshot && typeof loadLatestDigestSnapshot === "function"
          ? loadLatestDigestSnapshot(userId, dateEt)
          : null;
        const resolvedSnapshot = snapshot || fallbackSnapshot || null;
        const sentItems = normalizeItems(
          Array.isArray(resolvedSnapshot?.items) && resolvedSnapshot.items.length > 0
            ? resolvedSnapshot.items
            : events.sent_items
        );
        const qualityScore = Number(perUserRow?.digest_quality_score);
        const resolvedQualityScore = Number.isFinite(qualityScore)
          ? qualityScore
          : (Number.isFinite(Number(events.quality_score)) ? Number(events.quality_score) : null);
        const qualityBand = String(perUserRow?.digest_quality_band || events.quality_band || resolvedSnapshot?.quality_band || "").trim() || null;

        rows.push({
          recipient: recipient || matchedUser?.email || userId,
          user_id: userId || null,
          user_email: matchedUser?.email || null,
          date_et: dateEt,
          run_id: runId || null,
          mode: normalizeMode(perUserRow, run),
          on_demand: run?.on_demand === true,
          run_at_utc: String(run?.run_at || "").trim() || null,
          run_at_et: String(run?.run_at_et || "").trim() || null,
          digest_id: digestId,
          delivery_version: Number.isFinite(Number(perUserRow?.delivery_version))
            ? Number(perUserRow.delivery_version)
            : (Number.isFinite(Number(resolvedSnapshot?.version)) ? Number(resolvedSnapshot.version) : null),
          quality_score: resolvedQualityScore,
          quality_band: qualityBand,
          sent_at_utc: resolvedSnapshot?.sent_at || events.sent_at || null,
          sent_items: sentItems,
          sent_item_count: sentItems.length,
          channels: Array.from(events.channels).sort(),
          engagement: {
            opens: events.opens,
            clicks: events.clicks,
            saves: events.saves,
            ignored: events.ignored,
            feedback_submitted: events.feedback_submitted,
            feedback_labels: events.feedback_labels.slice(),
            scope: engagementScope,
          },
        });
      }
    }

    rows.sort((left, right) => {
      const leftTs = String(left?.run_at_utc || left?.sent_at_utc || "").trim();
      const rightTs = String(right?.run_at_utc || right?.sent_at_utc || "").trim();
      return rightTs.localeCompare(leftTs);
    });

    return {
      generated_at: new Date().toISOString(),
      window: {
        days: window.days,
        start_date_et: window.startDateEt,
        end_date_et: window.endDateEt,
      },
      row_count: rows.length,
      rows,
    };
  };
}

module.exports = {
  createRecentDigestsExporter,
  resolveWindow,
};
