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

module.exports = {
  computeFeedbackTrend,
};
