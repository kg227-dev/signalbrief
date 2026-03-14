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

function sortArchiveDatesDescending(values) {
  return Array.from(new Set(
    Array.from(values || [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  )).sort((a, b) => (a < b ? 1 : -1));
}

function normalizeArchiveLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function loadDeliveredSnapshotForDate(user, dateKey, deps) {
  const { loadLatestDigestSnapshot } = deps;
  if (typeof loadLatestDigestSnapshot !== "function") return null;
  const userId = String(user?.chatId || "").trim();
  const key = String(dateKey || "").trim();
  if (!userId || !key) return null;
  const snapshot = loadLatestDigestSnapshot(userId, key);
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) return null;
  return snapshot;
}

function buildArchiveDigestFromSnapshot(dateKey, snapshot, userTopics, topicWeights, archiveRelevanceScore) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  return {
    date: snapshot?.date_et || dateKey,
    dateStr: snapshot?.date_str || dateKey,
    quickScan: snapshot?.quick_scan || "",
    generatedAt: snapshot?.sent_at || snapshot?.selected_at || null,
    itemCount: items.length,
    items: items.map((item) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore)),
  };
}

function buildDeliveredItemsByDate(user, deps) {
  const { loadEngagementEvents } = deps;
  if (typeof loadEngagementEvents !== "function") return new Map();

  const chatId = String(user?.chatId || "").trim();
  if (!chatId) return new Map();

  const events = loadEngagementEvents({ max_age_days: 120, dedupe: true });
  const bestByDate = new Map();

  for (const event of (Array.isArray(events) ? events : [])) {
    if (String(event?.event_type || "") !== "digest_sent") continue;
    if (String(event?.user_chat_id || "").trim() !== chatId) continue;

    const dateKey = String(event?.date_et || String(event?.digest_id || "").split(":")[0] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const items = Array.isArray(event?.metadata?.items) ? event.metadata.items : [];
    if (items.length === 0) continue;

    const current = bestByDate.get(dateKey);
    const currentCount = Array.isArray(current?.items) ? current.items.length : 0;
    const candidateTs = Date.parse(String(event?.ts_utc || ""));
    const currentTs = Number(current?.ts_ms || 0);
    const shouldReplace = !current
      || items.length > currentCount
      || (items.length === currentCount && Number.isFinite(candidateTs) && candidateTs > currentTs);

    if (shouldReplace) {
      bestByDate.set(dateKey, {
        items,
        ts_ms: Number.isFinite(candidateTs) ? candidateTs : 0,
      });
    }
  }

  return new Map(Array.from(bestByDate.entries()).map(([dateKey, value]) => [dateKey, value.items]));
}

function resolveDeliveredDigestItems(dateKey, digestItems, deliveredItemsByDate) {
  const rawItems = Array.isArray(digestItems) ? digestItems : [];
  const deliveredRefs = deliveredItemsByDate instanceof Map ? deliveredItemsByDate.get(dateKey) : null;
  if (!Array.isArray(deliveredRefs) || deliveredRefs.length === 0) {
    return rawItems.map((item, idx) => ({ rank: idx + 1, item }));
  }

  const byUrl = new Map();
  const byHeadlineTag = new Map();
  rawItems.forEach((item, idx) => {
    const urlKey = normalizeArchiveLookupKey(item?.url);
    if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, { rank: idx + 1, item });

    const headlineKey = normalizeArchiveLookupKey(item?.headline);
    const tagKey = normalizeArchiveLookupKey(item?.tag);
    const compositeKey = `${headlineKey}::${tagKey}`;
    if (headlineKey && !byHeadlineTag.has(compositeKey)) {
      byHeadlineTag.set(compositeKey, { rank: idx + 1, item });
    }
  });

  return deliveredRefs
    .map((ref, idx) => {
      const urlKey = normalizeArchiveLookupKey(ref?.url);
      const headlineKey = normalizeArchiveLookupKey(ref?.headline);
      const tagKey = normalizeArchiveLookupKey(ref?.tag);
      const compositeKey = `${headlineKey}::${tagKey}`;
      const matched = (urlKey && byUrl.get(urlKey)) || (headlineKey && byHeadlineTag.get(compositeKey)) || null;
      if (matched) return { rank: Number(ref?.index || idx + 1), item: matched.item };
      return {
        rank: Number(ref?.index || idx + 1),
        item: {
          tag: ref?.tag || "",
          headline: ref?.headline || "",
          summary: "",
          wim: null,
          implications: null,
          watch_next: null,
          url: ref?.url || "",
          source: "",
          baseScore: Number.isFinite(Number(ref?.base_score)) ? Number(ref.base_score) : null,
        },
      };
    })
    .filter((entry) => entry && entry.item);
}

function resolveAllowedArchiveDatesForUser(user, archiveDir, deps) {
  const {
    getAllowedArchiveDates,
    readArchiveFiles,
  } = deps;

  const preferred = getAllowedArchiveDates(user, archiveDir, []);
  if (preferred.size > 0) return preferred;
  if (Number(user?.digests_received || 0) <= 0) return preferred;

  const files = readArchiveFiles(archiveDir);
  if (!Array.isArray(files) || files.length === 0) return preferred;
  const bounded = files.slice(0, Math.max(7, Math.min(files.length, Number(user?.digests_received || 0))));
  return getAllowedArchiveDates(user, archiveDir, bounded);
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
      const deliveredDigestItems = resolveDeliveredDigestItems(dateKey, digest.items, deliveredItemsByDate);
      if (deliveredDigestItems.length === 0) continue;
      digestCount++;
      deliveredDigestItems.forEach(({ item, rank }, idx) => {
        items.push({
          date: digest.date || dateKey,
          dateStr: digest.dateStr || dateKey,
          generatedAt: digest.generatedAt || null,
          rank: Number.isFinite(Number(rank)) ? Number(rank) : idx + 1,
          ...mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore),
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
    raw.items = resolveDeliveredDigestItems(rawDate, raw.items, deliveredItemsByDate)
      .map(({ item }) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore));
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
