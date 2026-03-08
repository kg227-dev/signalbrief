async function handleCoreArchiveRoutes(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json, isLegacyArchiveEndpointEnabled, recordLegacyArchiveUsage, ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
    findUserByToken, readArchiveFiles, getAllowedArchiveDates, archiveRelevanceScore, path, fs, APP_ROOT,
  } = deps;
// Without token: returns empty (archive requires auth)
if (pathname === "/api/archive" && req.method === "GET") {
  if (!isLegacyArchiveEndpointEnabled()) {
    recordLegacyArchiveUsage(req, "/api/archive", "blocked_retired");
    return json(res, {
      error: "legacy archive endpoint retired",
      use: "/api/archive/all",
      retired_after_utc: ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
    }, 410);
  }

  const token = url.searchParams.get("token");
  if (!token) {
    recordLegacyArchiveUsage(req, "/api/archive", "missing_token");
    return json(res, { digests: [], requiresAuth: true });
  }

  const user = findUserByToken(token);
  if (!user) {
    recordLegacyArchiveUsage(req, "/api/archive", "invalid_token");
    return json(res, { error: "invalid token" }, 401);
  }

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  if (files.length === 0) {
    recordLegacyArchiveUsage(req, "/api/archive", "served_empty", { user_chat_id: String(user.chatId || "") });
    return json(res, { digests: [] });
  }

  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  const digests = files.flatMap(f => {
    const dateKey = f.replace(".json", "");
    if (!allowedDates.has(dateKey)) return [];
    try {
      const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
      return [{ date: d.date, dateStr: d.dateStr, quickScan: d.quickScan, itemCount: d.items?.length || 0 }];
    } catch {
      return [];
    }
  });
  recordLegacyArchiveUsage(req, "/api/archive", "served", {
    user_chat_id: String(user.chatId || ""),
    digest_count: digests.length,
  });
  return json(res, { digests });
}

// GET /api/archive/all?token=... — flattened archive feed for search/discovery
if ((pathname === "/api/archive/all" || pathname === "/api/archive/all/") && req.method === "GET") {
  const token = url.searchParams.get("token");
  if (!token) return json(res, { items: [], requiresAuth: true });

  const user = findUserByToken(token);
  if (!user) return json(res, { error: "invalid token" }, 401);

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  if (files.length === 0) return json(res, { items: [], digestCount: 0 });

  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  const userTopics = Array.isArray(user.topics) ? user.topics : [];
  const topicWeights = user.topic_weights || {};
  const items = [];
  let digestCount = 0;

  for (const f of files) {
    const dateKey = f.replace(".json", "");
    if (!allowedDates.has(dateKey)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
      digestCount++;
      const digestItems = Array.isArray(d.items) ? d.items : [];
      digestItems.forEach((item, idx) => {
        items.push({
          date: d.date || dateKey,
          dateStr: d.dateStr || dateKey,
          generatedAt: d.generatedAt || null,
          rank: idx + 1,
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
        });
      });
    } catch (err) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] skipping malformed archive file ${f}: ${err.message}`);
      }
    }
  }

  items.sort((a, b) => {
    if (a.date === b.date) return (a.rank || 0) - (b.rank || 0);
    return a.date < b.date ? 1 : -1;
  });

  return json(res, { items, digestCount });
}

// GET /api/archive/:date?token=... — full digest for a specific date
if (pathname.startsWith("/api/archive/") && req.method === "GET") {
  if (!isLegacyArchiveEndpointEnabled()) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "blocked_retired");
    return json(res, {
      error: "legacy archive endpoint retired",
      use: "/api/archive/all",
      retired_after_utc: ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
    }, 410);
  }

  const rawDate = pathname.replace("/api/archive/", "").replace(/\/+$/, "");
  // Sanitize: only allow YYYY-MM-DD format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "invalid_date", { date: rawDate });
    return json(res, { error: "invalid date" }, 400);
  }

  // Token auth required: verify user received this digest
  const token = url.searchParams.get("token");
  if (!token) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "missing_token", { date: rawDate });
    return json(res, { error: "token required" }, 400);
  }
  const user = findUserByToken(token);
  if (!user) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "invalid_token", { date: rawDate });
    return json(res, { error: "invalid token" }, 401);
  }

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
  if (!allowedDates.has(rawDate)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "not_found", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    return json(res, { error: "not found" }, 404);
  }

  const file = path.join(archiveDir, `${rawDate}.json`);
  if (!fs.existsSync(file)) {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "file_missing", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    return json(res, { error: "not found" }, 404);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const userTopics = Array.isArray(user.topics) ? user.topics : [];
    const topicWeights = user.topic_weights || {};
    if (Array.isArray(raw.items)) {
      raw.items = raw.items.map(item => ({
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
      }));
    }
    recordLegacyArchiveUsage(req, "/api/archive/:date", "served", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    return json(res, raw);
  } catch {
    recordLegacyArchiveUsage(req, "/api/archive/:date", "malformed_file", {
      date: rawDate,
      user_chat_id: String(user.chatId || ""),
    });
    return json(res, { error: "malformed archive file" }, 500);
  }
}


  return false;
}

module.exports = {
  handleCoreArchiveRoutes,
};
