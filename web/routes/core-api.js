const { handleCoreArchiveRoutes } = require("./core-api-archive-runtime");

function createCoreApiRouteHandler(deps) {
  const {
    json, DEFAULT_TOPICS, INDUSTRY_TOPICS, CAPABILITY_TOPICS,
    findUserByToken, handleSignup, handleSettings, signUnsubEmail, allUsers, writeUser,
    blankReengagementState, isLegacyArchiveEndpointEnabled, recordLegacyArchiveUsage,
    ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC, readArchiveFiles, getAllowedArchiveDates,
    archiveRelevanceScore, path, fs, APP_ROOT, decodeDigestIdParam, buildDigestId,
    toEtDateKey, appendEngagementEventChecked, resetReengagementState, sendTransparentGif,
    normalizeEngagementUrl, requireJsonBody, normalizeBookmarkUrl, sendMagicLinkEmail,
  } = deps;
  return async function handleCoreApiRoutes(ctx) {
    const { req, res, url, pathname } = ctx;
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
    return handleSignup(ctx);
  }

  // POST /api/settings — update existing user (token-authenticated)
  if (pathname === "/api/settings" && req.method === "POST") {
    return handleSettings(ctx);
  }

  function unsubscribeByToken(tokenLookup) {
    const token = String(tokenLookup || "").trim();
    if (!token) return null;
    const existing = findUserByToken(token);
    if (!existing) return null;
    writeUser(existing.chatId, {
      ...existing,
      status: "unsubscribed",
      email_unsubscribed_at: new Date().toISOString(),
    });
    console.log(`[unsubscribe] ${existing.email}`);
    return existing;
  }

  function resolveLegacyUnsubscribeToken(emailRaw, sigRaw) {
    const email = decodeURIComponent(String(emailRaw || "")).toLowerCase().trim();
    const sig = String(sigRaw || "").trim();
    if (!email) return { ok: false, code: "email_required" };
    if (!sig || sig !== signUnsubEmail(email)) return { ok: false, code: "invalid_signature" };
    const legacyUser = allUsers().find((u) => String(u.email || "").toLowerCase().trim() === email);
    return { ok: true, token: legacyUser?.token ? String(legacyUser.token) : "" };
  }

  function redirectUnsubscribed(existing) {
    const location = existing?.token
      ? `/settings?token=${encodeURIComponent(existing.token)}&unsubscribed=1`
      : "/settings?unsubscribed=1";
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    return res.end();
  }

  function resolveOneClickToken(rawToken) {
    const token = String(rawToken || "").trim();
    if (!token) return { ok: false, code: "missing_token", token: "" };
    const user = findUserByToken(token);
    if (!user) return { ok: false, code: "invalid_token", token };
    return { ok: true, token, user };
  }

  function redirectInvalidToken() {
    res.writeHead(302, { Location: "/settings?invalid_token=1", "Cache-Control": "no-store" });
    return res.end();
  }

  // Canonical browser endpoint (token auth only).
  if (pathname === "/api/unsubscribe/confirm" && req.method === "GET") {
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) return redirectInvalidToken();
    const existing = unsubscribeByToken(resolved.token);
    return redirectUnsubscribed(existing);
  }

  // Canonical one-click endpoint (token auth only, RFC8058 style POST).
  if (pathname === "/api/unsubscribe/one-click" && req.method === "POST") {
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) return json(res, { error: "token required" }, 400);
    const existing = unsubscribeByToken(token);
    if (!existing) return json(res, { error: "invalid token" }, 401);
    return json(res, { success: true });
  }

  // Legacy signed-email bridge endpoint (email + sig only).
  if (pathname === "/api/unsubscribe/legacy" && (req.method === "GET" || req.method === "POST")) {
    const legacy = resolveLegacyUnsubscribeToken(
      url.searchParams.get("email"),
      url.searchParams.get("sig")
    );
    if (!legacy.ok) {
      if (legacy.code === "invalid_signature") return json(res, { error: "invalid signature" }, 403);
      return json(res, { error: "email required" }, 400);
    }
    const existing = unsubscribeByToken(legacy.token);
    if (req.method === "POST") return json(res, { success: true });
    return redirectUnsubscribed(existing);
  }

  // Backward-compatible shim for older links/clients.
  if (pathname === "/api/unsubscribe" && (req.method === "GET" || req.method === "POST")) {
    const tokenParam = String(url.searchParams.get("token") || "").trim();
    const emailParam = String(url.searchParams.get("email") || "").trim();
    const sigParam = String(url.searchParams.get("sig") || "").trim();

    if (req.method === "GET") {
      if (tokenParam) {
        res.writeHead(302, {
          Location: `/api/unsubscribe/confirm?token=${encodeURIComponent(tokenParam)}`,
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      if (emailParam || sigParam) {
        res.writeHead(302, {
          Location: `/api/unsubscribe/legacy?email=${encodeURIComponent(emailParam)}&sig=${encodeURIComponent(sigParam)}`,
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      return redirectUnsubscribed(null);
    }

    if (tokenParam) {
      const existing = unsubscribeByToken(tokenParam);
      if (!existing) return json(res, { error: "invalid token" }, 401);
      return json(res, { success: true, deprecated: true, use: "/api/unsubscribe/one-click" });
    }
    if (emailParam || sigParam) {
      const legacy = resolveLegacyUnsubscribeToken(emailParam, sigParam);
      if (!legacy.ok) {
        if (legacy.code === "invalid_signature") return json(res, { error: "invalid signature" }, 403);
        return json(res, { error: "email required" }, 400);
      }
      unsubscribeByToken(legacy.token);
      return json(res, { success: true, deprecated: true, use: "/api/unsubscribe/legacy" });
    }
    return json(res, { error: "token required" }, 400);
  }

  // GET /api/pause?token=... — one-click pause from lifecycle emails
  if (pathname === "/api/pause" && req.method === "GET") {
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) return redirectInvalidToken();

    const user = resolved.user;
    const updated = {
      ...user,
      status: "paused",
      preferences: { ...(user.preferences || {}), email_enabled: false },
      last_updated: new Date().toISOString(),
    };
    writeUser(user.chatId, updated);
    console.log(`[pause] ${user.email || user.chatId}`);

    const location = `/settings?token=${encodeURIComponent(resolved.token)}&paused=1`;
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    return res.end();
  }

  // GET /api/reactivate?token=... — one-click resume from lifecycle emails
  if (pathname === "/api/reactivate" && req.method === "GET") {
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) return redirectInvalidToken();

    const user = resolved.user;
    const updated = {
      ...user,
      status: "active",
      preferences: { ...(user.preferences || {}), email_enabled: true },
      reengagement_state: blankReengagementState(),
      last_updated: new Date().toISOString(),
    };
    writeUser(user.chatId, updated);
    console.log(`[reactivate] ${user.email || user.chatId}`);

    const location = `/settings?token=${encodeURIComponent(resolved.token)}&reactivated=1`;
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    return res.end();
  }

  const archiveRouteResult = await handleCoreArchiveRoutes(ctx, deps);
  if (archiveRouteResult !== false) return archiveRouteResult;

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
  };
}

async function handleCoreApiRoutes(ctx, deps) {
  const routeHandler = createCoreApiRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  createCoreApiRouteHandler,
  handleCoreApiRoutes,
};
