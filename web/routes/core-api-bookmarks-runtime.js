const {
  validateBookmarkRequest,
  addBookmarkForUser,
  removeBookmarkForUser,
} = require("./core-api-bookmarks-actions-runtime");

async function handleCoreBookmarksRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    requireJsonBody,
    findUserByToken,
    normalizeBookmarkUrl,
    toEtDateKey,
    buildDigestId,
    appendEngagementEventChecked,
    writeUser,
  } = deps;

  if ((pathname !== "/api/bookmarks" && pathname !== "/api/bookmarks/") || req.method !== "POST") return false;

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const token = String(body.token || "").trim();
  const action = String(body.action || "").toLowerCase().trim();
  const item = body.item || {};
  const itemUrl = String(item.url || "").trim();

  const validationError = validateBookmarkRequest({ token, action, itemUrl });
  if (validationError) {
    json(res, { error: validationError }, 400);
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    json(res, { error: "invalid token" }, 401);
    return true;
  }

  const bookmarks = Array.isArray(user.bookmarks) ? user.bookmarks.slice() : [];

  if (action === "add") {
    const result = addBookmarkForUser({
      user,
      item,
      itemUrl,
      bookmarks,
      normalizeBookmarkUrl,
      toEtDateKey,
      buildDigestId,
      appendEngagementEventChecked,
    });
    writeUser(user.chatId, {
      ...user,
      bookmarks: result.bookmarks,
      last_updated: new Date().toISOString(),
    });
    json(res, {
      success: true,
      bookmarked: true,
      deduped: result.deduped,
      count: result.bookmarks.length,
    });
    return true;
  }

  const result = removeBookmarkForUser({
    bookmarks,
    itemUrl,
    normalizeBookmarkUrl,
  });
  writeUser(user.chatId, {
    ...user,
    bookmarks: result.filtered,
    last_updated: new Date().toISOString(),
  });
  json(res, {
    success: true,
    bookmarked: false,
    removed: result.removed,
    count: result.filtered.length,
  });
  return true;
}

module.exports = {
  handleCoreBookmarksRoute,
};
