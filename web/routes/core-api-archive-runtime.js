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
  const files = readArchiveFiles(archiveDir);
  if (files.length === 0) {
    recordLegacyArchiveUsage(req, "/api/archive", "served_empty", { user_chat_id: String(user.chatId || "") });
    json(res, { digests: [] });
    return true;
  }

  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  const digests = files.flatMap((fileName) => {
    const dateKey = fileName.replace(".json", "");
    if (!allowedDates.has(dateKey)) return [];
    try {
      const digest = JSON.parse(fs.readFileSync(path.join(archiveDir, fileName), "utf8"));
      return [{
        date: digest.date,
        dateStr: digest.dateStr,
        quickScan: digest.quickScan,
        itemCount: digest.items?.length || 0,
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
  const files = readArchiveFiles(archiveDir);
  if (files.length === 0) {
    json(res, { items: [], digestCount: 0 });
    return true;
  }

  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  const userTopics = Array.isArray(user.topics) ? user.topics : [];
  const topicWeights = user.topic_weights || {};
  const items = [];
  let digestCount = 0;

  for (const fileName of files) {
    const dateKey = fileName.replace(".json", "");
    if (!allowedDates.has(dateKey)) continue;

    try {
      const digest = JSON.parse(fs.readFileSync(path.join(archiveDir, fileName), "utf8"));
      digestCount++;
      const digestItems = Array.isArray(digest.items) ? digest.items : [];
      digestItems.forEach((item, idx) => {
        items.push({
          date: digest.date || dateKey,
          dateStr: digest.dateStr || dateKey,
          generatedAt: digest.generatedAt || null,
          rank: idx + 1,
          ...mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore),
        });
      });
    } catch (error) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] skipping malformed archive file ${fileName}: ${error.message}`);
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
  const files = readArchiveFiles(archiveDir);
  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  if (!allowedDates.has(rawDate)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "not_found", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, { error: "not found" }, 404);
    return true;
  }

  const file = path.join(archiveDir, `${rawDate}.json`);
  if (!fs.existsSync(file)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "file_missing", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    json(res, { error: "not found" }, 404);
    return true;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const userTopics = Array.isArray(user.topics) ? user.topics : [];
    const topicWeights = user.topic_weights || {};
    if (Array.isArray(raw.items)) {
      raw.items = raw.items.map((item) => mapArchiveItem(item, userTopics, topicWeights, archiveRelevanceScore));
    }
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
