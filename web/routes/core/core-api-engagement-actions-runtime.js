const { isDebugWebServerEnabled } = require("../../server-runtime-env-runtime");

function buildFallbackDateKey(toEtDateKey) {
  const nowIso = new Date().toISOString();
  return toEtDateKey(nowIso) || nowIso.slice(0, 10);
}

function handleTrackingPixelRoute({ ctx, deps }) {
  const { req, res, pathname } = ctx;
  const {
    decodeDigestIdParam,
    buildDigestId,
    toEtDateKey,
    appendEngagementEventChecked,
    sendTransparentGif,
    findUserByToken,
    writeUser,
  } = deps;

  const openPixelMatch = pathname.match(/^\/t\/([^/]+)\/([a-f0-9]{64})\/o\.gif$/i);
  if (!openPixelMatch || req.method !== "GET") return false;

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
        last_updated: nowIso,
      };
      writeUser(user.chatId, updated);
    }
  } catch (error) {
    if (isDebugWebServerEnabled()) {
      console.warn(`[web] tracking pixel processing failed: ${error.message}`);
    }
  }

  sendTransparentGif(res);
  return true;
}

function handleClickRedirectRoute({ ctx, deps }) {
  const { req, res, url, pathname } = ctx;
  const {
    json,
    buildDigestId,
    toEtDateKey,
    appendEngagementEventChecked,
    normalizeEngagementUrl,
    findUserByToken,
  } = deps;

  if (pathname !== "/api/click" || req.method !== "GET") return false;

  const rawUrl = String(url.searchParams.get("url") || "").trim();
  if (!rawUrl) {
    json(res, { error: "url required" }, 400);
    return true;
  }

  let target;
  try {
    target = new URL(rawUrl);
    if (!/^https?:$/i.test(target.protocol)) throw new Error("unsupported protocol");
  } catch {
    json(res, { error: "invalid url" }, 400);
    return true;
  }

  const token = String(url.searchParams.get("token") || "").trim();
  const itemIndex = Number(url.searchParams.get("item") || 0);
  const did = String(url.searchParams.get("did") || "").trim();
  const user = token ? findUserByToken(token) : null;

  if (user) {
    const fallbackDate = buildFallbackDateKey(toEtDateKey);
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
  res.end();
  return true;
}

module.exports = {
  handleTrackingPixelRoute,
  handleClickRedirectRoute,
};
