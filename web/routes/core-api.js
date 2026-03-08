async function handleCoreApiRoutes(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json, DEFAULT_TOPICS, INDUSTRY_TOPICS, CAPABILITY_TOPICS,
    findUserByToken, handleSignup, handleSettings, signUnsubEmail, allUsers, writeUser,
    blankReengagementState, isLegacyArchiveEndpointEnabled, recordLegacyArchiveUsage,
    ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC, readArchiveFiles, getAllowedArchiveDates,
    archiveRelevanceScore, path, fs, APP_ROOT, decodeDigestIdParam, buildDigestId,
    toEtDateKey, appendEngagementEventChecked, resetReengagementState, sendTransparentGif,
    normalizeEngagementUrl, requireJsonBody, normalizeBookmarkUrl, sendMagicLinkEmail,
  } = deps;
  if (pathname === "/api/topics" && req.method === "GET") {
    return json(res, { topics: DEFAULT_TOPICS, industries: INDUSTRY_TOPICS, capabilities: CAPABILITY_TOPICS });
  }

  // GET /api/user?token=... — load user by token
  if (pathname === "/api/user" && req.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return json(res, { error: "token required" }, 400);
    const user = findUserByToken(token);
    if (!user) return json(res, { error: "not found" }, 404);
    return json(res, user);
  }

  // POST /api/signup — new user onboarding
  if (pathname === "/api/signup" && req.method === "POST") {
    return handleSignup(req, res);
  }

  // POST /api/settings — update existing user (token-authenticated)
  if (pathname === "/api/settings" && req.method === "POST") {
    return handleSettings(req, res);
  }

  // GET|POST /api/unsubscribe — token-based one-click unsubscribe.
  // Legacy signed email links are bridged to token identity for backward compatibility.
  if ((pathname === "/api/unsubscribe" || pathname === "/api/unsubscribe/legacy") && (req.method === "GET" || req.method === "POST")) {
    const tokenParam = String(url.searchParams.get("token") || "").trim();
    const emailParam = String(url.searchParams.get("email") || "").trim();
    const sigParam = String(url.searchParams.get("sig") || "").trim();
    let tokenLookup = tokenParam ? decodeURIComponent(tokenParam) : "";

    if (!tokenLookup && emailParam) {
      const targetEmail = decodeURIComponent(emailParam).toLowerCase().trim();
      if (!sigParam || sigParam !== signUnsubEmail(targetEmail)) {
        return json(res, { error: "invalid signature" }, 403);
      }
      const legacyUser = allUsers().find(u => String(u.email || "").toLowerCase().trim() === targetEmail);
      tokenLookup = legacyUser?.token ? String(legacyUser.token) : "";
    }

    if (!tokenLookup) {
      if (req.method === "POST") return json(res, { success: true });
      res.writeHead(302, { Location: "/settings?unsubscribed=1", "Cache-Control": "no-store" });
      return res.end();
    }

    const existing = findUserByToken(tokenLookup);
    if (existing) {
      writeUser(existing.chatId, { ...existing, status: "unsubscribed", email_unsubscribed_at: new Date().toISOString() });
      console.log(`[unsubscribe] ${existing.email}`);
    }

    // Always succeed (idempotent — if user not found, silently ok).
    if (req.method === "POST") return json(res, { success: true });

    const confirmUrl = existing?.token
      ? `/settings?token=${encodeURIComponent(existing.token)}&unsubscribed=1`
      : `/settings?unsubscribed=1`;
    res.writeHead(302, { Location: confirmUrl, "Cache-Control": "no-store" });
    return res.end();
  }

  // GET /api/pause?token=... — one-click pause from lifecycle emails
  if (pathname === "/api/pause" && req.method === "GET") {
    const token = String(url.searchParams.get("token") || "").trim();
    const user = token ? findUserByToken(token) : null;
    if (user) {
      const updated = {
        ...user,
        status: "paused",
        preferences: { ...(user.preferences || {}), email_enabled: false },
        last_updated: new Date().toISOString(),
      };
      writeUser(user.chatId, updated);
      console.log(`[pause] ${user.email || user.chatId}`);
    }
    const location = token
      ? `/settings?token=${encodeURIComponent(token)}&paused=1`
      : "/settings?paused=1";
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    return res.end();
  }

  // GET /api/reactivate?token=... — one-click resume from lifecycle emails
  if (pathname === "/api/reactivate" && req.method === "GET") {
    const token = String(url.searchParams.get("token") || "").trim();
    const user = token ? findUserByToken(token) : null;
    if (user) {
      const updated = {
        ...user,
        status: "active",
        preferences: { ...(user.preferences || {}), email_enabled: true },
        reengagement_state: blankReengagementState(),
        last_updated: new Date().toISOString(),
      };
      writeUser(user.chatId, updated);
      console.log(`[reactivate] ${user.email || user.chatId}`);
    }
    const location = token
      ? `/settings?token=${encodeURIComponent(token)}&reactivated=1`
      : "/settings?reactivated=1";
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    return res.end();
  }

  // GET /api/archive?token=... — user-specific archive (filtered to dates they received)
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

  // GET /t/:digestId/:token/o.gif — email open tracking pixel
  const openPixelMatch = pathname.match(/^\/t\/([^/]+)\/([a-f0-9]{64})\/o\.gif$/i);
  if (openPixelMatch && req.method === "GET") {
    const encodedDigestId = String(openPixelMatch[1] || "");
    const token = String(openPixelMatch[2] || "").toLowerCase();
    const decodedDigestId = decodeDigestIdParam(encodedDigestId);
    const nowIso = new Date().toISOString();

    try {
      const user = findUserByToken(token);
      if (user) {
        const digestId = decodedDigestId || buildDigestId(toEtDateKey(nowIso) || nowIso.slice(0, 10), user.chatId);
        const digestDate = String(digestId.split(":")[0] || "").trim();
        appendEngagementEventChecked({
          event_type: "email_open",
          event_key: `open:${digestId}`,
          user_chat_id: String(user.chatId),
          user_email: user.email || null,
          digest_id: digestId,
          date_et: /^\d{4}-\d{2}-\d{2}$/.test(digestDate) ? digestDate : (toEtDateKey(nowIso) || nowIso.slice(0, 10)),
          channel: "email",
          source: "tracking-pixel",
        }, `email_open:${digestId}`);

        const updated = {
          ...user,
          last_email_open_at: nowIso,
          email_opens_total: Math.max(0, Number(user.email_opens_total || 0)) + 1,
          reengagement_state: resetReengagementState(user, {
            preserveAutoPaused: String(user.status || "").toLowerCase() === "paused",
          }),
          last_updated: nowIso,
        };
        writeUser(user.chatId, updated);
      }
    } catch (err) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] tracking pixel processing failed: ${err.message}`);
      }
    }

    return sendTransparentGif(res);
  }

  // GET /api/click?token=...&did=...&item=...&url=... — tracked outbound link redirect
  if (pathname === "/api/click" && req.method === "GET") {
    const rawUrl = String(url.searchParams.get("url") || "").trim();
    if (!rawUrl) return json(res, { error: "url required" }, 400);

    let target;
    try {
      target = new URL(rawUrl);
      if (!/^https?:$/i.test(target.protocol)) throw new Error("unsupported protocol");
    } catch {
      return json(res, { error: "invalid url" }, 400);
    }

    const token = String(url.searchParams.get("token") || "").trim();
    const itemIndex = Number(url.searchParams.get("item") || 0);
    const did = String(url.searchParams.get("did") || "").trim();
    const user = token ? findUserByToken(token) : null;

    if (user) {
      const fallbackDate = toEtDateKey(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
      const dateKey = did ? String(did.split(":")[0]).trim() : fallbackDate;
      const digestId = did || buildDigestId(dateKey, user.chatId);
      const normalizedUrl = normalizeEngagementUrl(target.toString());
      const indexToken = Number.isFinite(itemIndex) && itemIndex > 0 ? itemIndex : "unknown";
      appendEngagementEventChecked({
        event_type: "item_clicked",
        event_key: `item_clicked:${digestId}:${indexToken}:${normalizedUrl}`,
        date_et: dateKey,
        user_chat_id: String(user.chatId),
        user_email: user.email || null,
        digest_id: digestId,
        channel: "email",
        source: "email-click",
        item: {
          index: Number.isFinite(itemIndex) && itemIndex > 0 ? itemIndex : null,
          url: target.toString(),
        },
      }, `item_clicked:${digestId}`);
    }

    res.writeHead(302, {
      Location: target.toString(),
      "Cache-Control": "no-store",
    });
    return res.end();
  }

  // POST /api/bookmarks — add/remove bookmark by URL
  if ((pathname === "/api/bookmarks" || pathname === "/api/bookmarks/") && req.method === "POST") {
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const token = String(body.token || "").trim();
    const action = String(body.action || "").toLowerCase().trim();
    const item = body.item || {};
    const itemUrl = String(item.url || "").trim();

    if (!token) return json(res, { error: "token required" }, 400);
    if (action !== "add" && action !== "remove") return json(res, { error: "action must be add or remove" }, 400);
    if (!itemUrl) return json(res, { error: "item.url required" }, 400);

    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);

    const bookmarks = Array.isArray(user.bookmarks) ? user.bookmarks.slice() : [];
    const target = normalizeBookmarkUrl(itemUrl);

    if (action === "add") {
      const exists = bookmarks.some(b => normalizeBookmarkUrl(b?.url) === target);
      if (!exists) {
        const itemDate = String(item.date || "").trim();
        const digestDateKey = /^\d{4}-\d{2}-\d{2}$/.test(itemDate)
          ? itemDate
          : toEtDateKey(new Date().toISOString());
        const digestId = buildDigestId(digestDateKey, user.chatId);
        bookmarks.push({
          date: String(item.date || ""),
          headline: String(item.headline || "").trim() || itemUrl,
          url: itemUrl,
          tag: item.tag ? String(item.tag) : null,
          source: item.source ? String(item.source) : null,
          saved_at: new Date().toISOString(),
        });
        const itemIndex = Number(item.item_num || item.index || 0);
        appendEngagementEventChecked({
          event_type: "item_saved",
          event_key: `item_saved:${digestId}:${itemIndex > 0 ? itemIndex : normalizeBookmarkUrl(itemUrl)}`,
          date_et: digestDateKey,
          user_chat_id: String(user.chatId),
          user_email: user.email || null,
          digest_id: digestId,
          channel: "web",
          source: "web-ui",
          item: {
            index: itemIndex > 0 ? itemIndex : null,
            headline: String(item.headline || "").trim() || null,
            url: itemUrl,
            tag: item.tag ? String(item.tag) : null,
          },
          metadata: {
            action: "bookmark_add",
            from: "archive",
          },
        }, `item_saved:${digestId}`);
      }
      writeUser(user.chatId, {
        ...user,
        bookmarks,
        last_updated: new Date().toISOString(),
      });
      return json(res, {
        success: true,
        bookmarked: true,
        deduped: exists,
        count: bookmarks.length,
      });
    }

    const filtered = bookmarks.filter(b => normalizeBookmarkUrl(b?.url) !== target);
    const removed = filtered.length !== bookmarks.length;
    writeUser(user.chatId, {
      ...user,
      bookmarks: filtered,
      last_updated: new Date().toISOString(),
    });
    return json(res, {
      success: true,
      bookmarked: false,
      removed,
      count: filtered.length,
    });
  }

  // POST /api/request-link — send magic access link to user's email
  if (pathname === "/api/request-link" && req.method === "POST") {
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const email = String(body.email || "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, { error: "valid email required" }, 400);
    }
    // Always return success (don't reveal whether email exists)
    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (user && user.token) {
      sendMagicLinkEmail(user).catch(e => console.error("[magic link]", e));
    }
    return json(res, { success: true });
  }


  return false;
}

module.exports = {
  handleCoreApiRoutes,
};
