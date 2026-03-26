"use strict";

const VALID_FEEDBACK_TYPES = ["positive", "negative", "repetitive", "weak_source", "not_relevant"];

function resolveDigestItem(user, itemIndex) {
  const idx = Number(itemIndex);
  if (!Number.isFinite(idx) || idx < 1) return null;
  const items = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
  return items[idx - 1] || null;
}

function applyRepetitionSuppression(user, item) {
  const storylineKey = String(item?.storyline_key || "").trim();
  const freshnessKey = String(item?.freshness_key || "").trim();
  const url = String(item?.url || "").trim();
  if (!storylineKey && !freshnessKey && !url) return false;

  if (!Array.isArray(user.recent_digest_url_history)) user.recent_digest_url_history = [];

  // Add a feedback-driven suppression entry so the next digest suppression pass picks it up
  const entry = {
    digest_id: "feedback_suppressed",
    urls: url ? [url] : [],
    storyline_keys: storylineKey ? [storylineKey] : [],
    freshness_keys: freshnessKey ? [freshnessKey] : [],
    entity_keys: Array.isArray(item?.entity_keys) ? item.entity_keys : [],
    ts: new Date().toISOString(),
  };
  user.recent_digest_url_history.push(entry);
  // Keep at most 20 entries
  if (user.recent_digest_url_history.length > 20) {
    user.recent_digest_url_history.splice(0, user.recent_digest_url_history.length - 20);
  }
  return true;
}

function applySourceBlock(user, item) {
  const domain = String(item?.source_domain || item?.source || "").trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return false;
  if (!user.source_preferences || typeof user.source_preferences !== "object") {
    user.source_preferences = { trusted_sources: [], blocked_sources: [] };
  }
  if (!Array.isArray(user.source_preferences.blocked_sources)) user.source_preferences.blocked_sources = [];
  if (user.source_preferences.blocked_sources.includes(domain)) return false;
  user.source_preferences.blocked_sources.push(domain);
  // Remove from trusted if present
  if (Array.isArray(user.source_preferences.trusted_sources)) {
    user.source_preferences.trusted_sources = user.source_preferences.trusted_sources.filter((d) => d !== domain);
  }
  return true;
}

async function handleCoreFeedbackRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    requireJsonBody,
    findUserByToken,
    writeUser,
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
  let userChanged = false;

  if (item) {
    if (feedbackType === "repetitive") {
      const suppressed = applyRepetitionSuppression(user, item);
      effectMeta.suppressed = suppressed;
      userChanged = suppressed;
    } else if (feedbackType === "weak_source") {
      const blocked = applySourceBlock(user, item);
      effectMeta.source_blocked = blocked;
      userChanged = blocked;
    }
    if (userChanged) writeUser(user.chatId, user);
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
