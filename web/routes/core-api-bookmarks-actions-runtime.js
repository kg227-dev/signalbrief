function validateBookmarkRequest({ token, action, itemUrl }) {
  if (!token) return "token required";
  if (action !== "add" && action !== "remove") return "action must be add or remove";
  if (!itemUrl) return "item.url required";
  return null;
}

function addBookmarkForUser({
  user,
  item,
  itemUrl,
  bookmarks,
  normalizeBookmarkUrl,
  toEtDateKey,
  buildDigestId,
  appendEngagementEventChecked,
}) {
  const target = normalizeBookmarkUrl(itemUrl);
  const exists = bookmarks.some((bookmark) => normalizeBookmarkUrl(bookmark?.url) === target);
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
  return {
    bookmarks,
    deduped: exists,
  };
}

function removeBookmarkForUser({ bookmarks, itemUrl, normalizeBookmarkUrl }) {
  const target = normalizeBookmarkUrl(itemUrl);
  const filtered = bookmarks.filter((bookmark) => normalizeBookmarkUrl(bookmark?.url) !== target);
  return {
    filtered,
    removed: filtered.length !== bookmarks.length,
  };
}

module.exports = {
  validateBookmarkRequest,
  addBookmarkForUser,
  removeBookmarkForUser,
};
