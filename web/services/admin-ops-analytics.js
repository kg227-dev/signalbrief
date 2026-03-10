function feedbackTimestampMs(entry, parseIsoTs) {
  const direct = parseIsoTs(entry?.ts_utc);
  if (direct != null) return direct;
  const dateEt = String(entry?.date_et || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) return null;
  const guess = Date.parse(`${dateEt}T00:00:00-05:00`);
  return Number.isFinite(guess) ? guess : null;
}

function feedbackScoreValue(entry, toNumericOrNull) {
  const score = toNumericOrNull(entry?.score);
  if (score != null) return Math.max(0, Math.min(2, score));
  const label = String(entry?.label || "").toLowerCase().trim();
  if (label === "great") return 2;
  if (label === "fine") return 1;
  if (label === "meh") return 0;
  return null;
}

function average(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.reduce((sum, value) => sum + Number(value || 0), 0) / arr.length;
}

function computeFeedbackTrend(users, deps) {
  const { parseIsoTs, toNumericOrNull } = deps;
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const currentStart = nowMs - (14 * DAY_MS);
  const previousStart = nowMs - (28 * DAY_MS);
  const entries = [];

  for (const user of (users || [])) {
    const userRows = Array.isArray(user?.digest_feedback) ? user.digest_feedback : [];
    for (const row of userRows) {
      const ts = feedbackTimestampMs(row, parseIsoTs);
      if (ts == null || ts < previousStart || ts > nowMs) continue;
      const score = feedbackScoreValue(row, toNumericOrNull);
      if (score == null) continue;
      entries.push({
        ts,
        score,
        label: String(row?.label || "").toLowerCase().trim(),
      });
    }
  }

  const current = entries.filter((row) => row.ts >= currentStart);
  const previous = entries.filter((row) => row.ts >= previousStart && row.ts < currentStart);

  const currentScores = current.map((row) => row.score);
  const previousScores = previous.map((row) => row.score);
  const currentAvgRaw = average(currentScores);
  const previousAvgRaw = average(previousScores);
  const currentAvg = currentAvgRaw == null ? null : Number((currentAvgRaw * 50).toFixed(2));
  const previousAvg = previousAvgRaw == null ? null : Number((previousAvgRaw * 50).toFixed(2));
  const positiveCount = current.filter((row) => row.score >= 1).length;
  const greatCount = current.filter((row) => row.label === "great").length;
  const fineCount = current.filter((row) => row.label === "fine").length;
  const mehCount = current.filter((row) => row.label === "meh").length;
  const responses = current.length;
  const positiveRate = responses
    ? Number(((positiveCount / responses) * 100).toFixed(1))
    : null;
  const delta = (currentAvg != null && previousAvg != null)
    ? Number((currentAvg - previousAvg).toFixed(2))
    : null;

  let trendLabel = "Baseline forming";
  if (!responses) trendLabel = "No reactions in last 14 days";
  else if (delta == null) trendLabel = "Baseline forming";
  else if (Math.abs(delta) < 0.5) trendLabel = "Flat vs prior 14d";
  else trendLabel = `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs prior 14d`;

  return {
    responses_14d: responses,
    avg_score_14d: currentAvg,
    avg_score_prev_14d: previousAvg,
    positive_rate_14d: positiveRate,
    great_14d: greatCount,
    fine_14d: fineCount,
    meh_14d: mehCount,
    delta_14d: delta,
    trend_label: trendLabel,
  };
}

function getRecentAutoAdjustmentsForUser(user, deps, limit = 8) {
  const { loadEngagementEvents, parseIsoTs, toNumericOrNull } = deps;
  const maxRows = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const chatId = String(user?.chatId || "").trim();
  const email = String(user?.email || "").toLowerCase().trim();
  if (!chatId && !email) return [];

  return loadEngagementEvents({ max_age_days: 120, dedupe: true })
    .filter((ev) => String(ev?.event_type || "") === "topic_weight_adjusted")
    .filter((ev) => String(ev?.topic?.mode || "").toLowerCase() === "auto")
    .filter((ev) => {
      const evChat = String(ev?.user_chat_id || "").trim();
      if (chatId && evChat === chatId) return true;
      const evEmail = String(ev?.user_email || "").toLowerCase().trim();
      return !!(email && evEmail && evEmail === email);
    })
    .sort((a, b) => (parseIsoTs(b?.ts_utc) || 0) - (parseIsoTs(a?.ts_utc) || 0))
    .slice(0, maxRows)
    .map((ev) => {
      const topic = ev?.topic && typeof ev.topic === "object" ? ev.topic : {};
      const metadata = ev?.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
      return {
        ts_utc: ev?.ts_utc || null,
        date_et: ev?.date_et || null,
        digest_id: ev?.digest_id || null,
        topic_key: topic.key || null,
        delta: toNumericOrNull(topic.delta),
        mode: topic.mode || "auto",
        reason: topic.reason || null,
        net: toNumericOrNull(metadata.net),
        count: toNumericOrNull(metadata.count),
        clicked: toNumericOrNull(metadata.clicked),
        saved: toNumericOrNull(metadata.saved),
        ignored: toNumericOrNull(metadata.ignored),
      };
    });
}

module.exports = {
  computeFeedbackTrend,
  getRecentAutoAdjustmentsForUser,
};
