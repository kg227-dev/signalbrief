const {
  buildDeliveredItemsByDate,
  loadDeliveredSnapshotForDate,
  resolveAllowedArchiveDatesForUser,
  resolveDeliveredDigestItems,
  sortArchiveDatesDescending,
} = require("../services/archive-digest-stats-runtime");
const { sortDigestItemsByScoreDescending } = require("../../src/digest/runtime/digest-item-ordering-runtime");

function mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore) {
  return {
    tag: item?.tag || "",
    headline: item?.headline || "",
    summary: item?.summary || "",
    wim: item?.wim || null,
    implications: item?.implications || null,
    watch_next: item?.watch_next || null,
    url: item?.url || "",
    source: item?.source || "",
    baseScore: typeof item?.baseScore === "number" ? item.baseScore : null,
    relevanceScore: archiveRelevanceScore(item, userTopics, topicWeights),
  };
}

function buildArchiveDigestFromSnapshot(dateKey, snapshot, userTopics, topicWeights, archiveRelevanceScore) {
  const items = sortDigestItemsByScoreDescending(
    (Array.isArray(snapshot?.items) ? snapshot.items : [])
      .map((item) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore))
  );
  return {
    date: snapshot?.date_et || dateKey,
    dateStr: snapshot?.date_str || dateKey,
    quickScan: snapshot?.quick_scan || "",
    generatedAt: snapshot?.sent_at || snapshot?.selected_at || null,
    itemCount: items.length,
    items,
  };
}

function ensureLegacyArchiveEnabled(ctx, deps, routeLabel) {
  const {
    req,
    res,
  } = ctx;
  const {
    json,
    isLegacyArchiveEndpointEnabled,
    recordLegacyArchiveUsage,
    ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
  } = deps;

  if (isLegacyArchiveEndpointEnabled()) return true;

  recordLegacyArchiveUsage(req, routeLabel, "blocked_retired");
  json(res, {
    error: "legacy archive endpoint retired",
    use: "/api/archive/all",
    retired_after_utc: ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
  }, 410);
  return false;
}

function handleLegacyArchiveIndex(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json,
    recordLegacyArchiveUsage,
    findUserByToken,
    readArchiveFiles,
    getAllowedArchiveDates,
    path,
    fs,
    APP_ROOT,
  } = deps;

  if (pathname !== "/api/archive" || req.method !== "GET") return false;
  if (!ensureLegacyArchiveEnabled(ctx, deps, "/api/archive")) return true;

  const token = url.searchParams.get("token");
  if (!token) {
    recordLegacyArchiveUsage(req, "/api/archive", "missing_token");
    json(res, { digests: [], requiresAuth: true });
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    recordLegacyArchiveUsage(req, "/api/archive", "invalid_token");
    json(res, { error: "invalid token" }, 401);
    return true;
  }

  const archiveDir = path.join(APP_ROOT, "archive");
  const allowedDates = resolveAllowedArchiveDatesForUser(user, archiveDir, deps);
  const allowedDateKeys = sortArchiveDatesDescending(allowedDates);
  const deliveredItemsByDate = buildDeliveredItemsByDate(user, deps);
  if (allowedDateKeys.length === 0) {
    recordLegacyArchiveUsage(req, "/api/archive", "served_empty", { user_chat_id: String(user.chatId || "") });
    json(res, { digests: [] });
    return true;
  }

  const digests = allowedDateKeys.flatMap((dateKey) => {
    try {
      const snapshot = loadDeliveredSnapshotForDate(user, dateKey, deps);
      if (snapshot) {
        return [{
          date: snapshot.date_et || dateKey,
          dateStr: snapshot.date_str || dateKey,
          quickScan: snapshot.quick_scan || "",
          itemCount: Array.isArray(snapshot.items) ? snapshot.items.length : 0,
        }];
      }
      const digestPath = path.join(archiveDir, `${dateKey}.json`);
      if (!fs.existsSync(digestPath)) return [];
      const digest = JSON.parse(fs.readFileSync(digestPath, "utf8"));
      const deliveredDigestItems = resolveDeliveredDigestItems(dateKey, digest.items, deliveredItemsByDate);
      return [{
        date: digest.date,
        dateStr: digest.dateStr,
        quickScan: digest.quickScan,
        itemCount: deliveredDigestItems.length,
      }];
    } catch {
      return [];
    }
  });

  recordLegacyArchiveUsage(req, "/api/archive", "served", {
    user_chat_id: String(user.chatId || ""),
    digest_count: digests.length,
  });
  json(res, { digests });
  return true;
}

function handleArchiveAllRoute(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json,
    findUserByToken,
    readArchiveFiles,
    getAllowedArchiveDates,
    archiveRelevanceScore,
    path,
    fs,
    APP_ROOT,
  } = deps;

  if ((pathname !== "/api/archive/all" && pathname !== "/api/archive/all/") || req.method !== "GET") return false;

  const token = url.searchParams.get("token");
  if (!token) {
    json(res, { items: [], requiresAuth: true });
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    json(res, { error: "invalid token" }, 401);
    return true;
  }

  const archiveDir = path.join(APP_ROOT, "archive");
  const allowedDates = resolveAllowedArchiveDatesForUser(user, archiveDir, deps);
  const allowedDateKeys = sortArchiveDatesDescending(allowedDates);
  const deliveredItemsByDate = buildDeliveredItemsByDate(user, deps);
  if (allowedDateKeys.length === 0) {
    json(res, { items: [], digestCount: 0 });
    return true;
  }

  const userTopics = Array.isArray(user.topics) ? user.topics : [];
  const topicWeights = user.topic_weights || {};
  const items = [];
  let digestCount = 0;

  for (const dateKey of allowedDateKeys) {
    try {
      const snapshot = loadDeliveredSnapshotForDate(user, dateKey, deps);
      if (snapshot) {
        const snapshotDigest = buildArchiveDigestFromSnapshot(dateKey, snapshot, userTopics, topicWeights, archiveRelevanceScore);
        if (snapshotDigest.items.length === 0) continue;
        digestCount++;
        snapshotDigest.items.forEach((item, idx) => {
          items.push({
            date: snapshotDigest.date,
            dateStr: snapshotDigest.dateStr,
            generatedAt: snapshotDigest.generatedAt,
            rank: idx + 1,
            ...item,
          });
        });
        continue;
      }
      const digestPath = path.join(archiveDir, `${dateKey}.json`);
      if (!fs.existsSync(digestPath)) continue;
      const digest = JSON.parse(fs.readFileSync(digestPath, "utf8"));
      const deliveredDigestItems = sortDigestItemsByScoreDescending(
        resolveDeliveredDigestItems(dateKey, digest.items, deliveredItemsByDate)
          .map(({ item }) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore))
      );
      if (deliveredDigestItems.length === 0) continue;
      digestCount++;
      deliveredDigestItems.forEach((item, idx) => {
        items.push({
          date: digest.date || dateKey,
          dateStr: digest.dateStr || dateKey,
          generatedAt: digest.generatedAt || null,
          rank: idx + 1,
          ...item,
        });
      });
    } catch (error) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] skipping malformed archive file ${dateKey}: ${error.message}`);
      }
    }
  }

  items.sort((a, b) => {
    if (a.date === b.date) return (a.rank || 0) - (b.rank || 0);
    return a.date < b.date ? 1 : -1;
  });

  json(res, { items, digestCount });
  return true;
}

function handleArchiveDateRoute(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json,
    recordLegacyArchiveUsage,
    findUserByToken,
    readArchiveFiles,
    getAllowedArchiveDates,
    archiveRelevanceScore,
    path,
    fs,
    APP_ROOT,
  } = deps;

  if (!pathname.startsWith("/api/archive/") || req.method !== "GET") return false;
  if (!ensureLegacyArchiveEnabled(ctx, deps, "/api/archive/:date")) return true;

  const rawDate = pathname.replace("/api/archive/", "").replace(/\/+$/, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "invalid_date", { date: rawDate });
    json(res, { error: "invalid date" }, 400);
    return true;
  }

  const token = url.searchParams.get("token");
  if (!token) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "missing_token", { date: rawDate });
    json(res, { error: "token required" }, 400);
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "invalid_token", { date: rawDate });
    json(res, { error: "invalid token" }, 401);
    return true;
  }

  const archiveDir = path.join(APP_ROOT, "archive");
  const allowedDates = resolveAllowedArchiveDatesForUser(user, archiveDir, deps);
  if (!allowedDates.has(rawDate)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "not_found", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, { error: "not found" }, 404);
    return true;
  }

  const file = path.join(archiveDir, `${rawDate}.json`);
  const snapshot = loadDeliveredSnapshotForDate(user, rawDate, deps);
  if (!snapshot && !fs.existsSync(file)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "file_missing", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, { error: "not found" }, 404);
    return true;
  }

  try {
    const userTopics = Array.isArray(user.topics) ? user.topics : [];
    const topicWeights = user.topic_weights || {};
    if (snapshot) {
      const snapshotDigest = buildArchiveDigestFromSnapshot(rawDate, snapshot, userTopics, topicWeights, archiveRelevanceScore);
      recordLegacyArchiveUsage(req, "/api/archive/:date", "served", {
        date: rawDate,
        user_chat_id: String(user.chatId || ""),
      });
      json(res, snapshotDigest);
      return true;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const deliveredItemsByDate = buildDeliveredItemsByDate(user, deps);
    raw.items = sortDigestItemsByScoreDescending(
      resolveDeliveredDigestItems(rawDate, raw.items, deliveredItemsByDate)
        .map(({ item }) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore))
    );
    recordLegacyArchiveUsage(req, "/api/archive/:date", "served", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, raw);
    return true;
  } catch {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "malformed_file", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, { error: "malformed archive file" }, 500);
    return true;
  }
 }

async function handleCoreArchiveRoutes(ctx, deps) {
  if (handleLegacyArchiveIndex(ctx, deps)) return true;
  if (handleArchiveAllRoute(ctx, deps)) return true;
  if (handleArchiveDateRoute(ctx, deps)) return true;
  return false;
}

module.exports = {
  handleCoreArchiveRoutes,
};
