"use strict";

const FAILURE_MODES = new Set([
  "repeat",
  "thin_pool",
  "weak_source",
  "topic_fit",
  "unknown",
]);

function normalizeFailureMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return FAILURE_MODES.has(normalized) ? normalized : "";
}

function average(values = []) {
  const numbers = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function countWeakSourceItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const sourceAuthority = Number(item?.source_authority || 0);
    const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
    const routineScore = Number(item?.routine_item_score || 0);
    return sourceAuthority < 0.55
      || sourceTier === "corporate"
      || sourceTier === "weak"
      || sourceTier === "suspect"
      || routineScore >= 0.6;
  }).length;
}

function countTopFitItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => Number(item?.topic_match || 0) >= 7).length;
}

function averageTopicMatch(items = []) {
  return average((Array.isArray(items) ? items : []).map((item) => Number(item?.topic_match)));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").trim().toLowerCase().replace(/^www\./, "");
    const pathname = String(parsed.pathname || "").trim().replace(/\/+$/, "");
    if (!host && !pathname) return "";
    return `${host}${pathname || ""}`;
  } catch {
    return normalizeText(raw)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

function summarizeRepeatItem(item = {}) {
  const headline = String(item?.headline || "").trim();
  if (headline) return headline;
  const storyline = String(item?.storyline_key || "").trim();
  if (storyline) return storyline.replace(/\|/g, " · ");
  const url = String(item?.url || "").trim();
  if (url) return url;
  const tag = String(item?.tag || "").trim();
  return tag || "Unknown item";
}

function buildRepeatTokens(item = {}) {
  const tokens = [];
  const freshnessKey = normalizeText(item?.freshness_key);
  const url = normalizeUrl(item?.url);
  const storylineKey = normalizeText(item?.storyline_key);
  const headline = normalizeText(item?.headline);
  if (freshnessKey) tokens.push({ type: "freshness_key", value: freshnessKey, key: `fresh:${freshnessKey}` });
  if (url) tokens.push({ type: "url", value: url, key: `url:${url}` });
  if (storylineKey) tokens.push({ type: "storyline_key", value: storylineKey, key: `story:${storylineKey}` });
  if (headline) tokens.push({ type: "headline", value: headline, key: `headline:${headline}` });
  return tokens;
}

function rowSortKey(row = {}) {
  return String(row?.run_at_utc || row?.sent_at_utc || row?.date_et || "");
}

function createRepeatGroup(item, token, row) {
  return {
    key: token?.key || "",
    match_type: token?.type || "unknown",
    label: summarizeRepeatItem(item),
    url: String(item?.url || "").trim() || null,
    occurrences: [],
  };
}

function annotateHistoricalRepeatEvidence(rows = []) {
  const grouped = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || typeof row !== "object") continue;
    const key = String(row?.recipient || row?.user_email || row?.user_id || "").trim().toLowerCase();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  for (const userRows of grouped.values()) {
    userRows.sort((left, right) => rowSortKey(left).localeCompare(rowSortKey(right)));
    const seenTokens = new Map();
    const repeatGroups = new Map();
    for (const row of userRows) {
      const items = Array.isArray(row?.sent_items) ? row.sent_items : [];
      const rowRepeatDetails = [];
      let historicalRepeatCount = 0;
      for (const item of items) {
        const tokens = buildRepeatTokens(item);
        if (!tokens.length) continue;
        let matchedGroup = null;
        for (const token of tokens) {
          const priorGroupKey = seenTokens.get(token.key);
          if (priorGroupKey && repeatGroups.has(priorGroupKey)) {
            matchedGroup = repeatGroups.get(priorGroupKey);
            break;
          }
        }

        if (matchedGroup) {
          historicalRepeatCount += 1;
          rowRepeatDetails.push({
            label: matchedGroup.label || summarizeRepeatItem(item),
            url: matchedGroup.url || String(item?.url || "").trim() || null,
            match_type: matchedGroup.match_type || "unknown",
            prior_dates_et: Array.from(new Set(
              matchedGroup.occurrences
                .map((occurrence) => String(occurrence?.date_et || "").trim())
                .filter(Boolean)
            )),
            current_date_et: String(row?.date_et || "").trim() || null,
          });
        }

        const canonicalGroup = matchedGroup || createRepeatGroup(item, tokens[0], row);
        if (!matchedGroup) repeatGroups.set(canonicalGroup.key, canonicalGroup);
        canonicalGroup.label = canonicalGroup.label || summarizeRepeatItem(item);
        canonicalGroup.url = canonicalGroup.url || String(item?.url || "").trim() || null;
        canonicalGroup.occurrences.push({
          date_et: String(row?.date_et || "").trim() || null,
          run_at_utc: String(row?.run_at_utc || row?.sent_at_utc || "").trim() || null,
        });
        for (const token of tokens) {
          seenTokens.set(token.key, canonicalGroup.key);
        }
      }

      const persistedRepeatCount = Math.max(0, Number(row?.freshness_block_count || 0))
        + Math.max(0, Number(row?.semantic_repeat_block_count || 0));
      row.historical_repeat_count = historicalRepeatCount;
      row.repeat_evidence_count = persistedRepeatCount + historicalRepeatCount;
      row.repeat_details = rowRepeatDetails;
    }

    const userRepeatDetails = Array.from(repeatGroups.values())
      .filter((group) => Array.isArray(group.occurrences) && group.occurrences.length > 1)
      .map((group) => ({
        label: group.label,
        url: group.url,
        match_type: group.match_type,
        occurrences: group.occurrences.length,
        dates_et: Array.from(new Set(
          group.occurrences
            .map((occurrence) => String(occurrence?.date_et || "").trim())
            .filter(Boolean)
        )),
      }))
      .sort((left, right) => Number(right.occurrences || 0) - Number(left.occurrences || 0));

    for (const row of userRows) {
      row.user_repeat_details = userRepeatDetails;
    }
  }

  return rows;
}

function resolveRowFailureMode(row = {}) {
  const repeatBlocks = Math.max(0, Number(row?.freshness_block_count || 0));
  const semanticRepeatBlocks = Math.max(0, Number(row?.semantic_repeat_block_count || 0));
  const historicalRepeats = Math.max(0, Number(row?.historical_repeat_count || 0));
  const repeatEvidenceCount = Math.max(0, Number(row?.repeat_evidence_count || 0));
  if (repeatBlocks > 0 || semanticRepeatBlocks > 0 || historicalRepeats > 0 || repeatEvidenceCount > 0) return "repeat";

  const requestedCount = Math.max(1, Number(row?.requested_count || row?.sent_item_count || 0));
  const sentCount = Math.max(0, Number(row?.sent_item_count || 0));
  const thinPool = row?.thin_pool === true || (sentCount > 0 && sentCount < requestedCount);
  if (thinPool) return "thin_pool";

  const explicit = normalizeFailureMode(row?.dominant_failure_mode);
  if (explicit) return explicit;

  const items = Array.isArray(row?.sent_items) ? row.sent_items : [];
  if (items.length > 0 && countWeakSourceItems(items) >= Math.ceil(items.length / 2)) return "weak_source";

  const avgTopic = averageTopicMatch(items);
  const topFitCount = countTopFitItems(items);
  const requiredTopFit = Math.min(3, sentCount || items.length);
  if ((requiredTopFit > 0 && topFitCount < requiredTopFit) || (avgTopic != null && avgTopic < 4.5)) return "topic_fit";

  return "unknown";
}

function buildDigestInsights(rows = [], opts = {}) {
  annotateHistoricalRepeatEvidence(rows);
  const grouped = new Map();
  const limitDays = Math.max(1, Number(opts.days || 7));

  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || typeof row !== "object") continue;
    const key = String(row?.recipient || row?.user_email || row?.user_id || "").trim().toLowerCase();
    if (!key) continue;
    const failureMode = resolveRowFailureMode(row);
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        recipient: row.recipient || row.user_email || row.user_id || key,
        user_id: row.user_id || null,
        user_email: row.user_email || null,
        rows: [],
        failureModeCounts: {},
      };
      grouped.set(key, entry);
    }
    entry.rows.push({
      ...row,
      dominant_failure_mode: failureMode,
    });
    entry.failureModeCounts[failureMode] = (entry.failureModeCounts[failureMode] || 0) + 1;
  }

  const failureRank = { repeat: 0, thin_pool: 1, weak_source: 2, topic_fit: 3, unknown: 4 };
  const users = Array.from(grouped.values()).map((entry) => {
    entry.rows.sort((left, right) => String(right?.run_at_utc || right?.sent_at_utc || "").localeCompare(String(left?.run_at_utc || left?.sent_at_utc || "")));
    const modeCounts = entry.failureModeCounts;
    const dominantFailureMode = Object.keys(modeCounts)
      .sort((left, right) => {
        const countDelta = Number(modeCounts[right] || 0) - Number(modeCounts[left] || 0);
        if (countDelta !== 0) return countDelta;
        return (failureRank[left] ?? 99) - (failureRank[right] ?? 99);
      })[0] || "unknown";

    const avgQuality = average(entry.rows.map((row) => row.quality_score));
    const avgItemCount = average(entry.rows.map((row) => row.sent_item_count));
    const repeatBlocks = entry.rows.reduce((sum, row) => sum + Math.max(0, Number(row.freshness_block_count || 0)), 0);
    const repeatSentCount = entry.rows.reduce((sum, row) => sum + Math.max(0, Number(row.historical_repeat_count || 0)), 0);
    const repeatEvidenceCount = entry.rows.reduce((sum, row) => sum + Math.max(0, Number(row.repeat_evidence_count || 0)), 0);
    const refillCount = entry.rows.reduce((sum, row) => sum + Math.max(0, Number(row.refill_count || 0)), 0);
    const thinPoolCount = entry.rows.reduce((sum, row) => sum + (row.thin_pool === true ? 1 : 0), 0);
    return {
      recipient: entry.recipient,
      user_id: entry.user_id,
      user_email: entry.user_email,
      days: limitDays,
      digests: entry.rows.length,
      avg_quality: avgQuality == null ? null : Number(avgQuality.toFixed(2)),
      avg_item_count: avgItemCount == null ? null : Number(avgItemCount.toFixed(2)),
      repeat_blocks: repeatBlocks,
      repeat_sent_count: repeatSentCount,
      repeat_evidence_count: repeatEvidenceCount,
      refill_count: refillCount,
      thin_pool_count: thinPoolCount,
      dominant_failure_mode: dominantFailureMode,
      last_run_at_utc: entry.rows[0]?.run_at_utc || entry.rows[0]?.sent_at_utc || null,
      repeat_details: entry.rows[0]?.user_repeat_details || [],
      rows: entry.rows,
    };
  }).sort((left, right) => {
    const leftRank = failureRank[left.dominant_failure_mode] ?? 99;
    const rightRank = failureRank[right.dominant_failure_mode] ?? 99;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Number(left.avg_quality || 0) - Number(right.avg_quality || 0);
  });

  return {
    generated_at: new Date().toISOString(),
    days: limitDays,
    users,
  };
}

module.exports = {
  annotateHistoricalRepeatEvidence,
  buildDigestInsights,
  normalizeFailureMode,
  resolveRowFailureMode,
};
