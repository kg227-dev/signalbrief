"use strict";

const USER_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  UNSUBSCRIBED: "unsubscribed",
});
const VALID_USER_STATUSES = new Set(Object.values(USER_STATUS));

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  const email = normalizeString(value).toLowerCase();
  return email || null;
}

function normalizeToken(value) {
  const token = normalizeString(value);
  return token || null;
}

function normalizeStatus(value) {
  const status = normalizeString(value).toLowerCase();
  return VALID_USER_STATUSES.has(status) ? status : USER_STATUS.ACTIVE;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeNumericMap(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(values)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) continue;
    const numericValue = Number(rawValue);
    out[normalizedKey] = Number.isFinite(numericValue) ? numericValue : 0;
  }
  return out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizePreferences(rawPreferences, defaults) {
  const raw = rawPreferences && typeof rawPreferences === "object" && !Array.isArray(rawPreferences)
    ? rawPreferences
    : {};
  const fallback = defaults && typeof defaults === "object" ? defaults : {};
  const deliveryTime = normalizeString(raw.delivery_time || fallback.delivery_time || "07:00");
  const timezone = normalizeString(raw.timezone || fallback.timezone || "America/New_York");
  const frequency = normalizeString(raw.frequency || fallback.frequency || "daily_weekday");
  const depth = normalizeString(raw.depth || fallback.depth || "headline_plus_why");
  const itemsPerDigestRaw = Number(raw.items_per_digest ?? fallback.items_per_digest ?? 5);
  const itemsPerDigest = Number.isFinite(itemsPerDigestRaw) && itemsPerDigestRaw > 0
    ? Math.floor(itemsPerDigestRaw)
    : 5;
  const daysOfWeek = Array.isArray(raw.days_of_week)
    ? [...new Set(raw.days_of_week.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0 && value <= 6).map((value) => Math.floor(value)))]
    : (Array.isArray(fallback.days_of_week) ? fallback.days_of_week.slice() : [1, 2, 3, 4, 5]);
  return {
    delivery_time: deliveryTime || "07:00",
    timezone: timezone || "America/New_York",
    frequency: frequency || "daily_weekday",
    depth: depth || "headline_plus_why",
    days_of_week: daysOfWeek,
    items_per_digest: itemsPerDigest,
    email_enabled: normalizeBoolean(raw.email_enabled, normalizeBoolean(fallback.email_enabled, true)),
    telegram_enabled: normalizeBoolean(raw.telegram_enabled, normalizeBoolean(fallback.telegram_enabled, true)),
  };
}

function createDefaultUser(chatId, nowIso = new Date().toISOString()) {
  const id = normalizeString(chatId);
  return {
    chatId: id,
    name: null,
    email: null,
    telegram: null,
    status: USER_STATUS.ACTIVE,
    token: null,
    digests_received: 0,
    joined_at: nowIso,
    last_updated: nowIso,
    last_digest_at: null,
    last_email_open_at: null,
    email_opens_total: 0,
    topics: [],
    topic_weights: {},
    custom_topics: [],
    digest_dates: [],
    bookmarks: [],
    last_digest_items: [],
    digest_feedback: [],
    quality_history: [],
    last_quality_score: null,
    auto_learning: {
      enabled: true,
      last_processed_ts: null,
      last_checked_at: null,
      last_applied_at: null,
      total_auto_adjustments: 0,
    },
    reengagement_state: {
      day4_sent_at: null,
      day8_sent_at: null,
      auto_paused_at: null,
      reactivated_at: null,
    },
    signup_referral_source: null,
    preferences: {
      delivery_time: "07:00",
      timezone: "America/New_York",
      frequency: "daily_weekday",
      depth: "headline_plus_why",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: 5,
      email_enabled: true,
      telegram_enabled: true,
    },
  };
}

function normalizeUserRecord(input, opts = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const chatId = normalizeString(opts.chatId || raw.chatId || "");
  const defaults = createDefaultUser(chatId || "unknown", opts.nowIso);

  const out = {
    ...defaults,
    ...raw,
    chatId: chatId || defaults.chatId,
    name: normalizeString(raw.name) || null,
    email: normalizeEmail(raw.email),
    telegram: normalizeString(raw.telegram) || null,
    status: normalizeStatus(raw.status),
    token: normalizeToken(raw.token),
    digests_received: Math.max(0, Number(raw.digests_received || 0) || 0),
    email_opens_total: Math.max(0, Number(raw.email_opens_total || 0) || 0),
    topics: normalizeStringArray(raw.topics),
    topic_weights: normalizeNumericMap(raw.topic_weights),
    custom_topics: normalizeStringArray(raw.custom_topics),
    digest_dates: normalizeStringArray(raw.digest_dates),
    bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks.filter((entry) => entry && typeof entry === "object") : [],
    last_digest_items: Array.isArray(raw.last_digest_items) ? raw.last_digest_items.filter((entry) => entry && typeof entry === "object") : [],
    digest_feedback: Array.isArray(raw.digest_feedback) ? raw.digest_feedback.filter((entry) => entry && typeof entry === "object") : [],
    quality_history: Array.isArray(raw.quality_history) ? raw.quality_history.filter((entry) => entry && typeof entry === "object") : [],
    auto_learning: {
      ...defaults.auto_learning,
      ...(raw.auto_learning && typeof raw.auto_learning === "object" ? raw.auto_learning : {}),
    },
    reengagement_state: {
      ...defaults.reengagement_state,
      ...(raw.reengagement_state && typeof raw.reengagement_state === "object" ? raw.reengagement_state : {}),
    },
    signup_referral_source: raw.signup_referral_source && typeof raw.signup_referral_source === "object"
      ? raw.signup_referral_source
      : null,
    preferences: normalizePreferences(raw.preferences, defaults.preferences),
  };

  if (!out.custom_topics.length && out.topics.length) {
    out.custom_topics = out.topics.filter((topic) => topic.toLowerCase().startsWith("custom_"));
  }
  return out;
}

function validateUserRecord(user) {
  const errors = [];
  const chatId = normalizeString(user?.chatId);
  const rawStatus = normalizeString(user?.status).toLowerCase();
  if (!chatId) errors.push("chatId is required");
  if (!VALID_USER_STATUSES.has(rawStatus)) errors.push("status is invalid");
  if (!user || typeof user !== "object") errors.push("user must be an object");
  if (!user?.preferences || typeof user.preferences !== "object") errors.push("preferences must be an object");
  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  USER_STATUS,
  VALID_USER_STATUSES,
  createDefaultUser,
  normalizeUserRecord,
  validateUserRecord,
};
