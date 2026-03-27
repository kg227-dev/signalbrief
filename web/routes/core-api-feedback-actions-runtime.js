"use strict";

const VALID_FEEDBACK_TYPES = ["positive", "negative", "repetitive", "weak_source", "not_relevant"];

function resolveDigestItem(user, itemIndex) {
  const idx = Number(itemIndex);
  if (!Number.isFinite(idx) || idx < 1) return null;
  const items = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
  return items[idx - 1] || null;
}

async function handleCoreFeedbackRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    requireJsonBody,
    findUserByToken,
    appendEngagementEventChecked,
    buildDigestId,
    toEtDateKey,
  } = deps;

  if ((pathname !== "/api/feedback" && pathname !== "/api/feedback/") || req.method !== "POST") return false;

  const body = await requireJsonBody(req, res);
  if (body == null) return true;

  const token = String(body.token || "").trim();
  const digestId = String(body.digest_id || "").trim();
  const feedbackType = String(body.feedback_type || "").trim();
  const itemIndex = Number(body.item_index);

  if (!token || !VALID_FEEDBACK_TYPES.includes(feedbackType)) {
    json(res, { ok: false, error: "invalid request" }, 400);
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    json(res, { ok: false, error: "not found" }, 404);
    return true;
  }

  const nowIso = new Date().toISOString();
  const dateEt = typeof toEtDateKey === "function"
    ? (toEtDateKey(nowIso) || nowIso.slice(0, 10))
    : nowIso.slice(0, 10);

  // Resolve the digest item from the user's last digest
  const item = resolveDigestItem(user, itemIndex);
  const effectMeta = {};
  if (item) {
    effectMeta.recorded = true;
  }

  const fullDigestId = typeof buildDigestId === "function" && digestId
    ? buildDigestId(digestId, String(user.chatId))
    : digestId;

  appendEngagementEventChecked({
    event_type: `item_feedback_${feedbackType}`,
    event_key: `feedback:${feedbackType}:${digestId}:${itemIndex}:${String(user.chatId)}`,
    user_chat_id: String(user.chatId),
    user_email: user.email || null,
    digest_id: fullDigestId,
    date_et: dateEt,
    channel: "web",
    source: "web-ui",
    item: {
      index: Number.isFinite(itemIndex) ? itemIndex : 0,
      tag: item?.tag || null,
      source_domain: item?.source_domain || item?.source || null,
    },
    feedback: { type: feedbackType, item_index: Number.isFinite(itemIndex) ? itemIndex : 0 },
    metadata: effectMeta,
  }, `feedback:${feedbackType}:${digestId}:${itemIndex}:${String(user.chatId)}`);

  json(res, { ok: true, effects: effectMeta });
  return true;
}

module.exports = {
  handleCoreFeedbackRoute,
};
