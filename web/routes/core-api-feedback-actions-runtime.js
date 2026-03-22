"use strict";

const VALID_FEEDBACK_TYPES = ["positive", "negative", "repetitive", "weak_source", "not_relevant"];

async function handleCoreFeedbackRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    requireJsonBody,
    findUserByToken,
    appendEngagementEventChecked,
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

  appendEngagementEventChecked({
    event_type: `item_feedback_${feedbackType}`,
    event_key: `feedback:${feedbackType}:${digestId}:${itemIndex}:${String(user.chatId)}`,
    user_chat_id: String(user.chatId),
    user_email: user.email || null,
    digest_id: digestId,
    date_et: dateEt,
    channel: "web",
    source: "web-ui",
    item: { index: Number.isFinite(itemIndex) ? itemIndex : 0 },
    feedback: { type: feedbackType, item_index: Number.isFinite(itemIndex) ? itemIndex : 0 },
    metadata: {},
  }, `feedback:${feedbackType}:${digestId}:${itemIndex}:${String(user.chatId)}`);

  json(res, { ok: true });
  return true;
}

module.exports = {
  handleCoreFeedbackRoute,
};
