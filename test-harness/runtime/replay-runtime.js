"use strict";

const fs = require("fs");
const path = require("path");

const {
  ROOT_DIR,
  RESULTS_DIR,
  sanitizeCacheKey,
} = require("../config");
const {
  ensureHarnessPaths,
  readJson,
  writeJson,
} = require("../config");
const {
  annotateEditorialSignals,
  clusterStorylines,
  storylineSimilarity,
  normalizeTopicToken,
} = require("../../src/domains/digest");
const { loadEngagementEvents } = require("../../src/runtime/engagement/engagement-events-runtime");
const { normalizeCanonicalUrl } = require("../../src/runtime/url-normalization-runtime");
const { mapArchiveItem } = require("../stages/dataset/shared");

const REPLAY_RESULTS_DIR = path.join(RESULTS_DIR, "replay");
const DEFAULT_REPLAY_THRESHOLDS = Object.freeze({
  scheduled_duplicate_days_max: 0,
  weak_item_rate_max: 0.05,
  high_score_weak_items_max: 0,
  duplicate_storyline_digests_max: 0,
  same_entity_multi_item_digests_max: 0,
  adjacent_low_novelty_repeat_rate_max: 0.2,
  recent_entity_saturation_rate_max: 0.35,
});

function uniq(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compareDateKeysAsc(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function compareIsoAsc(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function compareIsoDesc(left, right) {
  return String(right || "").localeCompare(String(left || ""));
}

function parseNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeHeadlineKey(value) {
  return normalizeKey(String(value || "").replace(/\s+/g, " "));
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120) || "unknown";
}

function parseArgsToken(argv, index) {
  const token = String(argv[index] || "");
  const next = String(argv[index + 1] || "");
  if (!token.startsWith("--")) return { consumed: 1, key: null, value: null };
  const eqIndex = token.indexOf("=");
  if (eqIndex >= 0) {
    return {
      consumed: 1,
      key: token.slice(2, eqIndex),
      value: token.slice(eqIndex + 1),
    };
  }
  if (next && !next.startsWith("--")) {
    return {
      consumed: 2,
      key: token.slice(2),
      value: next,
    };
  }
  return {
    consumed: 1,
    key: token.slice(2),
    value: "true",
  };
}

function parseReplayArgs(argv = []) {
  const args = {
    user: null,
    email: null,
    chat_id: null,
    start: null,
    end: null,
    days: null,
    similar: 10,
    fixture: null,
    output: null,
    mode: "all",
    no_cohort: false,
    window_digests: 3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const parsed = parseArgsToken(argv, index);
    index += parsed.consumed - 1;
    if (!parsed.key) continue;

    const key = String(parsed.key || "").trim();
    const value = parsed.value;

    if (key === "user") args.user = value;
    else if (key === "email") args.email = value;
    else if (key === "chat-id" || key === "chat_id") args.chat_id = value;
    else if (key === "start") args.start = value;
    else if (key === "end") args.end = value;
    else if (key === "days") args.days = parseNumber(value, null);
    else if (key === "similar") args.similar = Math.max(0, parseNumber(value, 10));
    else if (key === "fixture") args.fixture = value;
    else if (key === "output") args.output = value;
    else if (key === "mode") args.mode = String(value || "all").trim().toLowerCase();
    else if (key === "no-cohort" || key === "no_cohort") args.no_cohort = value !== "false";
    else if (key === "window-digests" || key === "window_digests") {
      args.window_digests = Math.max(1, parseNumber(value, 3));
    }
  }

  return args;
}

function resolveAbsolutePath(rootDir, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
}

function todayDateKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function addDays(dateKey, delta) {
  const base = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return dateKey;
  base.setUTCDate(base.getUTCDate() + Number(delta || 0));
  return base.toISOString().slice(0, 10);
}

function resolveWindow(args = {}, availableDates = []) {
  const sortedDates = uniq(availableDates).sort(compareDateKeysAsc);
  const firstDate = sortedDates[0] || null;
  const lastDate = sortedDates[sortedDates.length - 1] || todayDateKey();
  const end = String(args.end || lastDate || todayDateKey()).trim();

  let start = String(args.start || "").trim() || null;
  if (!start && Number.isFinite(Number(args.days)) && Number(args.days) > 0) {
    start = addDays(end, 1 - Number(args.days));
  } else if (!start && firstDate) {
    start = firstDate;
  }

  return {
    start,
    end,
  };
}

function isDateWithinWindow(dateKey, window) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  if (window?.start && key < window.start) return false;
  if (window?.end && key > window.end) return false;
  return true;
}

function normalizeTopics(user) {
  return uniq([
    ...safeArray(user?.topics),
  ].map((value) => normalizeTopicToken(value)).filter(Boolean));
}

function listUsersFromData(rootDir) {
  const dataDir = path.join(rootDir, "data");
  if (!fs.existsSync(dataDir)) return [];

  return fs.readdirSync(dataDir)
    .filter((fileName) => /^user-.*\.json$/i.test(fileName))
    .map((fileName) => readJson(path.join(dataDir, fileName), null))
    .filter((user) => user && typeof user === "object");
}

function resolveReplayUser(users, args = {}) {
  const desired = normalizeKey(args.user || args.email || args.chat_id);
  if (!desired) return null;

  const byEmail = users.find((user) => normalizeKey(user?.email) === desired);
  if (byEmail) return byEmail;

  const byChatId = users.find((user) => normalizeKey(user?.chatId) === desired);
  if (byChatId) return byChatId;

  const byName = users.find((user) => normalizeKey(user?.name) === desired);
  return byName || null;
}

function topicSimilarity(leftUser, rightUser) {
  const left = new Set(normalizeTopics(leftUser));
  const right = new Set(normalizeTopics(rightUser));
  if (!left.size && !right.size) return 0;
  let intersection = 0;
  for (const topic of left) {
    if (right.has(topic)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
}

function findSimilarUsers(targetUser, users, limit = 10) {
  return (Array.isArray(users) ? users : [])
    .filter((user) => user && String(user?.chatId || "") !== String(targetUser?.chatId || ""))
    .map((user) => ({
      user,
      similarity: topicSimilarity(targetUser, user),
    }))
    .filter((row) => row.similarity > 0)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.max(0, Number(limit || 0)));
}

function buildArchiveIndex(rootDir, dateKeys = []) {
  const archiveDir = path.join(rootDir, "archive");
  const index = new Map();

  for (const dateKey of uniq(dateKeys)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) continue;
    const filePath = path.join(archiveDir, `${dateKey}.json`);
    const payload = readJson(filePath, null);
    if (!payload || !Array.isArray(payload.items)) continue;

    const byUrl = new Map();
    const byHeadlineTag = new Map();

    for (const rawItem of payload.items) {
      const item = mapArchiveItem(rawItem);
      const urlKey = normalizeCanonicalUrl(item.url);
      const headlineTagKey = `${normalizeHeadlineKey(item.headline)}::${normalizeKey(item.tag)}`;
      if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, item);
      if (!byHeadlineTag.has(headlineTagKey)) byHeadlineTag.set(headlineTagKey, item);
    }

    index.set(dateKey, {
      byUrl,
      byHeadlineTag,
    });
  }

  return index;
}

function inferDeliveryMode(event) {
  const runId = String(event?.run_id || "").trim().toLowerCase();
  const source = String(event?.source || "").trim().toLowerCase();
  if (runId.startsWith("scheduled:") || source === "scheduled-job") return "scheduled";
  if (runId.startsWith("admin:") || source === "admin") return "admin";
  return "unknown";
}

function inferDeliveryVersion(event) {
  const key = String(event?.event_key || "");
  const match = key.match(/:v(\d+):[^:]+$/);
  return match ? Math.max(1, Number(match[1] || 1)) : 1;
}

function buildDeliveryIdentity({ digestId, mode, version, runId }) {
  return [
    String(digestId || "").trim(),
    String(mode || "unknown").trim(),
    `v${Math.max(1, Number(version || 1))}`,
    String(runId || "").trim() || "no-run",
  ].join("::");
}

function normalizeDeliveredItem(item = {}) {
  return {
    index: Math.max(1, Number(item.index || 1)),
    headline: String(item.headline || "").trim(),
    summary: String(item.summary || "").trim(),
    wim: item.wim || null,
    wim_brief: item.wim_brief || null,
    implications: item.implications || null,
    watch_next: item.watch_next || null,
    url: String(item.url || "").trim(),
    tag: String(item.tag || "").trim(),
    source: String(item.source || "").trim() || null,
    source_domain: String(item.source_domain || item.source || "").trim() || null,
    why_shown: safeArray(item.why_shown),
    baseScore: parseNumber(item.baseScore, parseNumber(item.base_score, null)),
    topicMatch: parseNumber(item.topicMatch, parseNumber(item.topic_match, null)),
    relevanceScore: parseNumber(item.relevanceScore, parseNumber(item.relevance_score, null)),
    strategic_value: parseNumber(item.strategic_value, null),
    routine_item_score: parseNumber(item.routine_item_score, null),
    content_flags: safeArray(item.content_flags),
    entity_keys: safeArray(item.entity_keys),
    storyline_id: item.storyline_id || null,
    storyline_key: item.storyline_key || null,
    score_breakdown: item.score_breakdown && typeof item.score_breakdown === "object" ? item.score_breakdown : null,
  };
}

function loadEventDeliveries(rootDir, user, window, modeFilter = "all") {
  const eventsFile = path.join(rootDir, "data", "engagement-events.jsonl");
  if (!fs.existsSync(eventsFile)) return [];

  const events = loadEngagementEvents({
    events_file: eventsFile,
    max_age_days: 366,
    dedupe: false,
  });
  const grouped = new Map();

  for (const event of safeArray(events)) {
    if (String(event?.event_type || "") !== "digest_sent") continue;

    const chatMatch = normalizeKey(event?.user_chat_id) === normalizeKey(user?.chatId);
    const emailMatch = normalizeKey(event?.user_email) === normalizeKey(user?.email);
    if (!chatMatch && !emailMatch) continue;

    const dateKey = String(event?.date_et || String(event?.digest_id || "").split(":")[0] || "").trim();
    if (!isDateWithinWindow(dateKey, window)) continue;

    const mode = inferDeliveryMode(event);
    if (modeFilter !== "all" && mode !== modeFilter) continue;

    const version = inferDeliveryVersion(event);
    const digestId = String(event?.digest_id || `${dateKey}:${user?.chatId || "unknown"}`).trim();
    const runId = String(event?.run_id || "").trim() || null;
    const identity = buildDeliveryIdentity({ digestId, mode, version, runId });
    const current = grouped.get(identity);
    const items = safeArray(event?.metadata?.items).map(normalizeDeliveredItem);
    const channels = uniq([...(current?.channels || []), String(event?.channel || "").trim()].filter(Boolean));
    const sentAt = String(event?.ts_utc || "").trim() || null;

    if (!current) {
      grouped.set(identity, {
        identity,
        source_type: "event",
        digest_id: digestId,
        date_et: dateKey,
        mode,
        version,
        run_id: runId,
        source: String(event?.source || "").trim() || null,
        sent_at: sentAt,
        channels,
        quality_score: parseNumber(event?.metadata?.quality_score, null),
        quality_band: event?.metadata?.quality_band || null,
        quality_components: event?.metadata?.quality_components || null,
        quick_scan: event?.metadata?.quick_scan || null,
        items,
      });
      continue;
    }

    const candidateCount = items.length;
    const currentCount = safeArray(current.items).length;
    if (candidateCount > currentCount) current.items = items;
    if (sentAt && (!current.sent_at || sentAt > current.sent_at)) current.sent_at = sentAt;
    current.channels = channels;
    if (parseNumber(event?.metadata?.quality_score, null) != null) current.quality_score = parseNumber(event?.metadata?.quality_score, null);
    if (event?.metadata?.quality_band) current.quality_band = event.metadata.quality_band;
  }

  return Array.from(grouped.values()).sort((left, right) => compareIsoAsc(left.sent_at, right.sent_at));
}

function loadRecordDeliveries(rootDir, user, window, modeFilter = "all") {
  const userDir = path.join(rootDir, "data", "digest-records", sanitizePathSegment(user?.chatId));
  if (!fs.existsSync(userDir)) return [];

  const deliveries = [];
  const fileNames = fs.readdirSync(userDir).filter((fileName) => fileName.endsWith(".json")).sort();

  for (const fileName of fileNames) {
    const payload = readJson(path.join(userDir, fileName), null);
    if (!payload) continue;
    const versions = Array.isArray(payload?.versions) && payload.versions.length
      ? payload.versions
      : [payload.current].filter(Boolean);

    for (const versionRow of versions) {
      const row = versionRow && typeof versionRow === "object" ? versionRow : null;
      if (!row || String(row.status || "") !== "sent") continue;

      const dateKey = String(row.date_et || "").trim();
      const mode = String(row.mode || "unknown").trim();
      if (!isDateWithinWindow(dateKey, window)) continue;
      if (modeFilter !== "all" && mode !== modeFilter) continue;

      deliveries.push({
        identity: buildDeliveryIdentity({
          digestId: row.digest_id,
          mode,
          version: row.version,
          runId: row.run_id,
        }),
        source_type: "record",
        digest_id: row.digest_id,
        date_et: dateKey,
        mode,
        version: Math.max(1, Number(row.version || 1)),
        run_id: row.run_id || null,
        source: row.source || null,
        sent_at: row.sent_at || row.sending_at || row.selected_at || null,
        channels: safeArray(row.channels),
        quality_score: parseNumber(row.quality_score, null),
        quality_band: row.quality_band || null,
        quality_components: null,
        quick_scan: row.quick_scan || null,
        items: safeArray(row.items).map(normalizeDeliveredItem),
      });
    }
  }

  return deliveries.sort((left, right) => compareIsoAsc(left.sent_at, right.sent_at));
}

function resolveArchiveMatch(archiveRow, deliveredItem) {
  if (!archiveRow) return null;
  const urlKey = normalizeCanonicalUrl(deliveredItem?.url || "");
  if (urlKey && archiveRow.byUrl.has(urlKey)) return archiveRow.byUrl.get(urlKey);

  const compositeKey = `${normalizeHeadlineKey(deliveredItem?.headline)}::${normalizeKey(deliveredItem?.tag)}`;
  return archiveRow.byHeadlineTag.get(compositeKey) || null;
}

function mergeResolvedItem(deliveredItem, archiveItem) {
  const merged = {
    ...(archiveItem || {}),
    ...normalizeDeliveredItem(deliveredItem),
  };
  if (!merged.source_domain && merged.source) merged.source_domain = merged.source;
  return merged;
}

function primaryEntityKey(item) {
  const fromEntity = safeArray(item?.entity_keys)[0];
  if (fromEntity) return fromEntity;
  return normalizeTopicToken(item?.tag || "") || "unknown";
}

function classifyWeakItem(item) {
  const flags = new Set(safeArray(item?.content_flags));
  const reasons = [];

  if (item?.hard_exclude) reasons.push("hard_exclude");
  if (flags.has("routine_dividend")) reasons.push("routine_dividend");
  if (flags.has("stock_promo")) reasons.push("stock_promo");
  if (flags.has("generic_commentary")) reasons.push("generic_commentary");
  if (flags.has("conference_recap")) reasons.push("conference_recap");
  if (flags.has("investor_relations")) reasons.push("investor_relations");
  if (Number(item?.strategic_value || 0) < 0.34) reasons.push("low_strategic_value");
  if (Number(item?.routine_item_score || 0) > 0.74) reasons.push("high_routine_score");
  if (String(item?.source_tier || "") === "weak") reasons.push("weak_source");

  const weak = !!item?.hard_exclude
    || Number(item?.strategic_value || 0) < 0.34
    || Number(item?.routine_item_score || 0) > 0.74
    || (
      String(item?.source_tier || "") === "weak"
      && (
        flags.has("generic_commentary")
        || flags.has("conference_recap")
        || flags.has("investor_relations")
      )
    );

  return {
    weak,
    reasons: uniq(reasons),
    high_score: weak && (
      Number(item?.relevanceScore || 0) >= 8
      || Number(item?.baseScore || 0) >= 8
    ),
  };
}

function evaluateDigestItems(delivery, archiveIndex) {
  const archiveRow = archiveIndex.get(String(delivery?.date_et || "").trim()) || null;
  const mergedItems = safeArray(delivery?.items).map((item) => mergeResolvedItem(item, resolveArchiveMatch(archiveRow, item)));
  const annotatedItems = annotateEditorialSignals(mergedItems)
    .sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0));

  const clusters = clusterStorylines(annotatedItems);
  const weakItems = [];
  const highScoreWeakItems = [];
  const entityCounts = {};

  for (const item of annotatedItems) {
    const entity = primaryEntityKey(item);
    entityCounts[entity] = (entityCounts[entity] || 0) + 1;

    const weak = classifyWeakItem(item);
    if (weak.weak) {
      weakItems.push({
        headline: item.headline,
        tag: item.tag,
        entity,
        source_domain: item.source_domain || null,
        source_tier: item.source_tier || null,
        reasons: weak.reasons,
        signal_score: parseNumber(item.relevanceScore, null),
      });
      if (weak.high_score) {
        highScoreWeakItems.push({
          headline: item.headline,
          tag: item.tag,
          signal_score: parseNumber(item.relevanceScore, null),
          reasons: weak.reasons,
        });
      }
    }
  }

  const duplicateStorylines = clusters
    .filter((cluster) => Number(cluster?.storyline_size || 0) > 1)
    .map((cluster) => ({
      storyline_id: cluster.storyline_id,
      canonical_headline: cluster.canonical_headline,
      storyline_size: cluster.storyline_size,
      entity_keys: cluster.entity_keys,
      supporting_headlines: cluster.supporting_headlines,
    }));

  const sameEntityOverages = Object.entries(entityCounts)
    .filter(([, count]) => Number(count) > 1)
    .map(([entity, count]) => ({ entity, count }));

  return {
    annotated_items: annotatedItems,
    clusters,
    duplicate_storylines: duplicateStorylines,
    same_entity_overages: sameEntityOverages,
    weak_items: weakItems,
    high_score_weak_items: highScoreWeakItems,
    entity_counts: entityCounts,
  };
}

function chooseCanonicalDigest(deliveriesForDate = []) {
  const rows = safeArray(deliveriesForDate).slice().sort((left, right) => compareIsoDesc(left.sent_at, right.sent_at));
  const scheduled = rows.filter((row) => row.mode === "scheduled");
  if (scheduled.length) return scheduled[0];
  return rows[0] || null;
}

function summarizeAdjacentRepeats(canonicalDigests) {
  const pairs = [];

  for (let index = 1; index < canonicalDigests.length; index += 1) {
    const previous = canonicalDigests[index - 1];
    const current = canonicalDigests[index];
    const sharedEntities = [];

    const previousByEntity = new Map();
    for (const item of safeArray(previous?.annotated_items)) {
      const entity = primaryEntityKey(item);
      if (!previousByEntity.has(entity)) previousByEntity.set(entity, []);
      previousByEntity.get(entity).push(item);
    }

    const currentByEntity = new Map();
    for (const item of safeArray(current?.annotated_items)) {
      const entity = primaryEntityKey(item);
      if (!currentByEntity.has(entity)) currentByEntity.set(entity, []);
      currentByEntity.get(entity).push(item);
    }

    for (const [entity, currentItems] of currentByEntity.entries()) {
      const previousItems = previousByEntity.get(entity);
      if (!previousItems || !previousItems.length) continue;

      let maxSimilarity = 0;
      let sameStoryline = false;
      for (const leftItem of previousItems) {
        for (const rightItem of currentItems) {
          const similarity = storylineSimilarity(leftItem, rightItem);
          if (similarity > maxSimilarity) maxSimilarity = similarity;
          if (
            leftItem?.storyline_key
            && rightItem?.storyline_key
            && leftItem.storyline_key === rightItem.storyline_key
          ) {
            sameStoryline = true;
          }
        }
      }

      sharedEntities.push({
        entity,
        max_similarity: Number(clamp(maxSimilarity, 0, 1).toFixed(3)),
        same_storyline: sameStoryline,
        low_novelty: sameStoryline || maxSimilarity >= 0.58,
      });
    }

    pairs.push({
      left_date: previous.date_et,
      right_date: current.date_et,
      shared_entities: sharedEntities,
      low_novelty_entities: sharedEntities.filter((row) => row.low_novelty),
    });
  }

  return pairs;
}

function summarizeRecentSaturation(canonicalDigests, windowDigests = 3) {
  const windows = [];

  for (let index = 0; index < canonicalDigests.length; index += 1) {
    const current = canonicalDigests[index];
    const priorDigests = canonicalDigests.slice(Math.max(0, index - Number(windowDigests || 3)), index);
    if (!priorDigests.length) continue;

    const priorItems = priorDigests.flatMap((digest) => safeArray(digest?.annotated_items));
    const repeatedItems = [];

    for (const item of safeArray(current?.annotated_items)) {
      const entity = primaryEntityKey(item);
      const relatedPrior = priorItems.filter((priorItem) => primaryEntityKey(priorItem) === entity);
      if (!relatedPrior.length) continue;

      let maxSimilarity = 0;
      let sameStoryline = false;
      for (const priorItem of relatedPrior) {
        const similarity = storylineSimilarity(priorItem, item);
        if (similarity > maxSimilarity) maxSimilarity = similarity;
        if (
          priorItem?.storyline_key
          && item?.storyline_key
          && priorItem.storyline_key === item.storyline_key
        ) {
          sameStoryline = true;
        }
      }

      repeatedItems.push({
        headline: item.headline,
        tag: item.tag,
        entity,
        max_similarity: Number(clamp(maxSimilarity, 0, 1).toFixed(3)),
        same_storyline: sameStoryline,
        low_novelty: sameStoryline || maxSimilarity >= 0.58,
      });
    }

    windows.push({
      date_et: current.date_et,
      repeated_items: repeatedItems,
      low_novelty_items: repeatedItems.filter((row) => row.low_novelty),
    });
  }

  return windows;
}

function buildGateResult(id, label, value, threshold, examples = []) {
  const numericValue = Number(value || 0);
  const numericThreshold = Number(threshold || 0);
  let status = "pass";
  if (numericThreshold === 0) {
    status = numericValue > 0 ? "fail" : "pass";
  } else if (numericValue > numericThreshold * 1.5) {
    status = "fail";
  } else if (numericValue > numericThreshold) {
    status = "warn";
  }

  return {
    id,
    label,
    status,
    value: Number(numericValue.toFixed(3)),
    threshold: Number(numericThreshold.toFixed(3)),
    examples: safeArray(examples).slice(0, 5),
  };
}

function summarizeUserReplayCore(rootDir, user, deliveries, thresholds, windowDigests) {
  const dateKeys = deliveries.map((row) => row.date_et).filter(Boolean);
  const archiveIndex = buildArchiveIndex(rootDir, dateKeys);
  const evaluatedDigests = safeArray(deliveries).map((delivery) => {
    const itemEval = evaluateDigestItems(delivery, archiveIndex);
    return {
      ...delivery,
      ...itemEval,
      item_count: itemEval.annotated_items.length,
    };
  }).sort((left, right) => compareIsoAsc(left.sent_at, right.sent_at));

  const groupedByDate = new Map();
  for (const digest of evaluatedDigests) {
    if (!groupedByDate.has(digest.date_et)) groupedByDate.set(digest.date_et, []);
    groupedByDate.get(digest.date_et).push(digest);
  }

  const duplicateDays = [];
  const scheduledDuplicateDays = [];
  const canonicalDigests = [];

  for (const dateKey of Array.from(groupedByDate.keys()).sort(compareDateKeysAsc)) {
    const rows = groupedByDate.get(dateKey) || [];
    if (rows.length > 1) {
      duplicateDays.push({
        date_et: dateKey,
        deliveries: rows.map((row) => ({
          mode: row.mode,
          version: row.version,
          run_id: row.run_id,
          sent_at: row.sent_at,
          item_count: row.item_count,
        })),
      });
    }

    const scheduled = rows.filter((row) => row.mode === "scheduled");
    if (scheduled.length > 1) {
      scheduledDuplicateDays.push({
        date_et: dateKey,
        deliveries: scheduled.map((row) => ({
          version: row.version,
          run_id: row.run_id,
          sent_at: row.sent_at,
          item_count: row.item_count,
        })),
      });
    }

    const canonical = chooseCanonicalDigest(rows);
    if (canonical) canonicalDigests.push(canonical);
  }

  const adjacentPairs = summarizeAdjacentRepeats(canonicalDigests);
  const recentWindows = summarizeRecentSaturation(canonicalDigests, windowDigests);
  const allWeakItems = evaluatedDigests.flatMap((digest) => digest.weak_items.map((item) => ({ ...item, date_et: digest.date_et })));
  const allHighScoreWeakItems = evaluatedDigests.flatMap((digest) => digest.high_score_weak_items.map((item) => ({ ...item, date_et: digest.date_et })));
  const duplicateStorylineDigests = evaluatedDigests.filter((digest) => digest.duplicate_storylines.length > 0);
  const sameEntityMultiItemDigests = evaluatedDigests.filter((digest) => digest.same_entity_overages.length > 0);
  const totalItems = evaluatedDigests.reduce((sum, digest) => sum + Number(digest.item_count || 0), 0);
  const weakItemRate = totalItems ? allWeakItems.length / totalItems : 0;
  const adjacentLowNoveltyPairs = adjacentPairs.filter((pair) => pair.low_novelty_entities.length > 0);
  const adjacentLowNoveltyRate = adjacentPairs.length ? adjacentLowNoveltyPairs.length / adjacentPairs.length : 0;
  const recentRepeatedItemCount = recentWindows.reduce((sum, row) => sum + row.repeated_items.length, 0);
  const recentLowNoveltyCount = recentWindows.reduce((sum, row) => sum + row.low_novelty_items.length, 0);
  const recentSaturationRate = totalItems ? recentRepeatedItemCount / totalItems : 0;

  const gateResults = [
    buildGateResult(
      "scheduled_duplicate_days",
      "Scheduled duplicate days",
      scheduledDuplicateDays.length,
      thresholds.scheduled_duplicate_days_max,
      scheduledDuplicateDays
    ),
    buildGateResult(
      "weak_item_rate",
      "Weak-item leakage rate",
      weakItemRate,
      thresholds.weak_item_rate_max,
      allWeakItems
    ),
    buildGateResult(
      "high_score_weak_items",
      "High-score weak items",
      allHighScoreWeakItems.length,
      thresholds.high_score_weak_items_max,
      allHighScoreWeakItems
    ),
    buildGateResult(
      "duplicate_storyline_digests",
      "Within-digest duplicate storylines",
      duplicateStorylineDigests.length,
      thresholds.duplicate_storyline_digests_max,
      duplicateStorylineDigests.map((digest) => ({
        date_et: digest.date_et,
        storylines: digest.duplicate_storylines,
      }))
    ),
    buildGateResult(
      "same_entity_multi_item_digests",
      "Same-entity multi-item digests",
      sameEntityMultiItemDigests.length,
      thresholds.same_entity_multi_item_digests_max,
      sameEntityMultiItemDigests.map((digest) => ({
        date_et: digest.date_et,
        entities: digest.same_entity_overages,
      }))
    ),
    buildGateResult(
      "adjacent_low_novelty_repeat_rate",
      "Adjacent low-novelty repeat rate",
      adjacentLowNoveltyRate,
      thresholds.adjacent_low_novelty_repeat_rate_max,
      adjacentLowNoveltyPairs
    ),
    buildGateResult(
      "recent_entity_saturation_rate",
      "Recent entity saturation rate",
      recentSaturationRate,
      thresholds.recent_entity_saturation_rate_max,
      recentWindows.filter((row) => row.repeated_items.length > 0)
    ),
  ];

  return {
    user: {
      chat_id: user?.chatId || null,
      email: user?.email || null,
      name: user?.name || null,
      topics: safeArray(user?.topics),
    },
    summary: {
      delivery_instances: evaluatedDigests.length,
      canonical_digest_days: canonicalDigests.length,
      duplicate_days: duplicateDays.length,
      scheduled_duplicate_days: scheduledDuplicateDays.length,
      total_items: totalItems,
      weak_item_count: allWeakItems.length,
      weak_item_rate: Number(weakItemRate.toFixed(3)),
      high_score_weak_item_count: allHighScoreWeakItems.length,
      duplicate_storyline_digests: duplicateStorylineDigests.length,
      same_entity_multi_item_digests: sameEntityMultiItemDigests.length,
      adjacent_repeat_pairs: adjacentPairs.filter((pair) => pair.shared_entities.length > 0).length,
      adjacent_low_novelty_pairs: adjacentLowNoveltyPairs.length,
      adjacent_low_novelty_repeat_rate: Number(adjacentLowNoveltyRate.toFixed(3)),
      recent_entity_saturation_items: recentRepeatedItemCount,
      recent_low_novelty_items: recentLowNoveltyCount,
      recent_entity_saturation_rate: Number(recentSaturationRate.toFixed(3)),
    },
    gate_results: gateResults,
    duplicate_days: duplicateDays,
    scheduled_duplicate_days: scheduledDuplicateDays,
    adjacent_pairs: adjacentPairs,
    recent_windows: recentWindows,
    digests: evaluatedDigests.map((digest) => ({
      date_et: digest.date_et,
      mode: digest.mode,
      version: digest.version,
      run_id: digest.run_id,
      sent_at: digest.sent_at,
      item_count: digest.item_count,
      weak_items: digest.weak_items,
      duplicate_storylines: digest.duplicate_storylines,
      same_entity_overages: digest.same_entity_overages,
      items: digest.annotated_items.map((item) => ({
        index: item.index,
        headline: item.headline,
        tag: item.tag,
        entity_keys: item.entity_keys,
        storyline_id: item.storyline_id || null,
        storyline_key: item.storyline_key || null,
        content_flags: item.content_flags,
        source_tier: item.source_tier,
        strategic_value: item.strategic_value,
        routine_item_score: item.routine_item_score,
        signal_score: parseNumber(item.relevanceScore, null),
      })),
    })),
  };
}

function summarizeCohort(rows = []) {
  const valid = safeArray(rows).filter((row) => row && row.summary);
  if (!valid.length) {
    return {
      cohort_size: 0,
      averages: null,
      top_failures: [],
    };
  }

  const sum = (selector) => valid.reduce((total, row) => total + Number(selector(row) || 0), 0);
  const average = (selector) => Number((sum(selector) / valid.length).toFixed(3));

  const topFailures = valid
    .map((row) => ({
      email: row.user?.email || null,
      chat_id: row.user?.chat_id || null,
      weak_item_rate: row.summary.weak_item_rate,
      scheduled_duplicate_days: row.summary.scheduled_duplicate_days,
      adjacent_low_novelty_repeat_rate: row.summary.adjacent_low_novelty_repeat_rate,
    }))
    .sort((left, right) => {
      const leftScore = Number(left.weak_item_rate || 0) + Number(left.adjacent_low_novelty_repeat_rate || 0) + Number(left.scheduled_duplicate_days || 0);
      const rightScore = Number(right.weak_item_rate || 0) + Number(right.adjacent_low_novelty_repeat_rate || 0) + Number(right.scheduled_duplicate_days || 0);
      return rightScore - leftScore;
    })
    .slice(0, 5);

  return {
    cohort_size: valid.length,
    averages: {
      weak_item_rate: average((row) => row.summary.weak_item_rate),
      scheduled_duplicate_days: average((row) => row.summary.scheduled_duplicate_days),
      duplicate_storyline_digests: average((row) => row.summary.duplicate_storyline_digests),
      adjacent_low_novelty_repeat_rate: average((row) => row.summary.adjacent_low_novelty_repeat_rate),
      recent_entity_saturation_rate: average((row) => row.summary.recent_entity_saturation_rate),
    },
    top_failures: topFailures,
  };
}

function printReplaySummary(report) {
  const target = report?.target;
  if (!target) return;

  console.log("");
  console.log("SignalBrief Replay Eval");
  console.log(`User: ${target.user?.email || target.user?.chat_id || "unknown"}`);
  console.log(`Window: ${report.window?.start || "start"} -> ${report.window?.end || "end"}`);
  console.log("------------------------------------------------------------");
  console.log("Gate                              Status  Value   Threshold");
  console.log("------------------------------------------------------------");
  for (const gate of safeArray(target.gate_results)) {
    const label = String(gate.label || "").padEnd(32, " ").slice(0, 32);
    const status = String(gate.status || "").toUpperCase().padEnd(6, " ").slice(0, 6);
    const value = String(gate.value).padEnd(7, " ").slice(0, 7);
    const threshold = String(gate.threshold).padEnd(9, " ").slice(0, 9);
    console.log(`${label} ${status} ${value} ${threshold}`);
  }
  console.log("------------------------------------------------------------");

  const firstWeak = safeArray(target.digests)
    .flatMap((digest) => safeArray(digest.weak_items).map((item) => ({ ...item, date_et: digest.date_et })))
    .slice(0, 3);
  if (firstWeak.length) {
    console.log("Examples:");
    for (const row of firstWeak) {
      console.log(`- ${row.date_et}: ${row.headline} [${safeArray(row.reasons).join(", ")}]`);
    }
  }

  if (report?.cohort?.cohort_size > 0) {
    console.log(`Cohort compared: ${report.cohort.cohort_size}`);
  }
  console.log("");
}

function loadFixtureReplay(rootDir, fixturePath) {
  const fullPath = resolveAbsolutePath(rootDir, fixturePath);
  const payload = readJson(fullPath, null);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Replay fixture not found or invalid: ${fullPath}`);
  }

  return {
    fixture_path: fullPath,
    user: payload.user || null,
    deliveries: safeArray(payload.deliveries).map((delivery) => ({
      identity: buildDeliveryIdentity({
        digestId: delivery.digest_id || `${delivery.date_et}:${payload?.user?.chatId || "fixture"}`,
        mode: delivery.mode || "scheduled",
        version: delivery.version || 1,
        runId: delivery.run_id || null,
      }),
      source_type: "fixture",
      digest_id: delivery.digest_id || `${delivery.date_et}:${payload?.user?.chatId || "fixture"}`,
      date_et: delivery.date_et,
      mode: delivery.mode || "scheduled",
      version: Math.max(1, Number(delivery.version || 1)),
      run_id: delivery.run_id || null,
      source: delivery.source || "fixture",
      sent_at: delivery.sent_at || null,
      channels: safeArray(delivery.channels),
      quality_score: parseNumber(delivery.quality_score, null),
      quality_band: delivery.quality_band || null,
      quality_components: delivery.quality_components || null,
      quick_scan: delivery.quick_scan || null,
      items: safeArray(delivery.items).map(normalizeDeliveredItem),
    })),
  };
}

function loadUserDeliveries(rootDir, user, args, window) {
  const recordDeliveries = loadRecordDeliveries(rootDir, user, window, args.mode);
  if (recordDeliveries.length) return recordDeliveries;
  return loadEventDeliveries(rootDir, user, window, args.mode);
}

function createReplayRuntime(customDeps = {}) {
  const deps = {
    fs,
    path,
    rootDir: ROOT_DIR,
    resultsDir: RESULTS_DIR,
    replayResultsDir: REPLAY_RESULTS_DIR,
    ensureHarnessPaths,
    writeJson,
    ...customDeps,
  };

  function runReplay(argv = []) {
    deps.ensureHarnessPaths();
    if (!deps.fs.existsSync(deps.replayResultsDir)) {
      deps.fs.mkdirSync(deps.replayResultsDir, { recursive: true });
    }

    const args = parseReplayArgs(argv);

    let targetUser = null;
    let deliveries = [];
    let cohortRows = [];
    let availableDates = [];
    let fixturePath = null;

    if (args.fixture) {
      const fixture = loadFixtureReplay(deps.rootDir, args.fixture);
      fixturePath = fixture.fixture_path;
      targetUser = fixture.user;
      deliveries = fixture.deliveries;
      availableDates = deliveries.map((row) => row.date_et);
    } else {
      const users = listUsersFromData(deps.rootDir);
      targetUser = resolveReplayUser(users, args);
      if (!targetUser) {
        throw new Error("Replay user not found. Use --user=<email|chatId> or --fixture=<path>.");
      }

      const provisionalWindow = resolveWindow(args, []);
      deliveries = loadUserDeliveries(deps.rootDir, targetUser, args, provisionalWindow);
      availableDates = deliveries.map((row) => row.date_et);
      const finalWindow = resolveWindow(args, availableDates);
      deliveries = deliveries.filter((row) => isDateWithinWindow(row.date_et, finalWindow));

      if (!args.no_cohort && Number(args.similar || 0) > 0) {
        const similarUsers = findSimilarUsers(targetUser, users, args.similar);
        cohortRows = similarUsers.map((row) => {
        const similarDeliveries = loadUserDeliveries(deps.rootDir, row.user, args, finalWindow);
          if (!similarDeliveries.length) return null;
          return summarizeUserReplayCore(deps.rootDir, row.user, similarDeliveries, DEFAULT_REPLAY_THRESHOLDS, args.window_digests);
        }).filter(Boolean);
      }
    }

    const window = resolveWindow(args, availableDates);
    deliveries = deliveries.filter((row) => isDateWithinWindow(row.date_et, window));
    if (!targetUser || !deliveries.length) {
      throw new Error("No delivered digests found for replay window.");
    }

    const target = summarizeUserReplayCore(deps.rootDir, targetUser, deliveries, DEFAULT_REPLAY_THRESHOLDS, args.window_digests);
    const report = {
      generated_at: new Date().toISOString(),
      fixture_path: fixturePath,
      window,
      thresholds: DEFAULT_REPLAY_THRESHOLDS,
      target,
      cohort: summarizeCohort(cohortRows),
    };

    const targetKey = sanitizeCacheKey(target.user?.email || target.user?.chat_id || "replay");
    const outputPath = resolveAbsolutePath(
      deps.rootDir,
      args.output || path.join(deps.replayResultsDir, `replay-${targetKey}-${Date.now()}.json`)
    );
    deps.writeJson(outputPath, report);
    printReplaySummary(report);

    return {
      args,
      report,
      output_path: outputPath,
    };
  }

  return {
    findSimilarUsers,
    loadEventDeliveries: (user, window, modeFilter = "all") => (
      loadEventDeliveries(deps.rootDir, user, window, modeFilter)
    ),
    loadFixtureReplay: (fixturePath) => loadFixtureReplay(deps.rootDir, fixturePath),
    loadRecordDeliveries: (user, window, modeFilter = "all") => (
      loadRecordDeliveries(deps.rootDir, user, window, modeFilter)
    ),
    loadUserDeliveries: (user, args, window) => loadUserDeliveries(deps.rootDir, user, args, window),
    parseReplayArgs,
    printReplaySummary,
    runReplay,
    summarizeCohort,
    summarizeUserReplay: (user, deliveries, thresholds, windowDigests) => (
      summarizeUserReplayCore(deps.rootDir, user, deliveries, thresholds, windowDigests)
    ),
  };
}

const defaultRuntime = createReplayRuntime();

module.exports = {
  DEFAULT_REPLAY_THRESHOLDS,
  createReplayRuntime,
  parseReplayArgs,
  runReplay: defaultRuntime.runReplay,
  summarizeUserReplay: defaultRuntime.summarizeUserReplay,
};
