const { normalizeUserRecord } = require("../../src/platform/store");
const { normalizeTopicsForUserInput } = require("./topic-normalization-runtime");

const WEEKDAY_DAYS = Object.freeze([1, 2, 3, 4, 5]);
const ITEMS_PER_DIGEST_MIN = 5;
const ITEMS_PER_DIGEST_MAX = 10;

function deriveFrequencyFromDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "daily_weekday";
  if (days.length === 7) return "daily_all";
  if (days.length === WEEKDAY_DAYS.length && WEEKDAY_DAYS.every((day) => days.includes(day))) {
    return "daily_weekday";
  }
  return "custom";
}

function normalizeItemsPerDigest(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "preferences.items_per_digest must be a positive number" };
  }

  // Settings UI exposes 5 and 10; normalize API writes to the same supported buckets.
  const bounded = Math.min(ITEMS_PER_DIGEST_MAX, Math.max(ITEMS_PER_DIGEST_MIN, parsed));
  const midpoint = (ITEMS_PER_DIGEST_MIN + ITEMS_PER_DIGEST_MAX) / 2;
  const normalized = bounded <= midpoint ? ITEMS_PER_DIGEST_MIN : ITEMS_PER_DIGEST_MAX;
  return { ok: true, itemsPerDigest: normalized };
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value)) {
    return { ok: false, error: "preferences.days_of_week must be an array of day indexes" };
  }

  const seen = new Set();
  const days = [];
  for (const day of value) {
    const parsed = Number(day);
    if (!Number.isFinite(parsed)) {
      return { ok: false, error: "preferences.days_of_week must contain numbers between 0 and 6" };
    }
    const normalized = Math.floor(parsed);
    if (normalized < 0 || normalized > 6) {
      return { ok: false, error: "preferences.days_of_week must contain numbers between 0 and 6" };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    days.push(normalized);
  }

  if (days.length === 0) {
    return { ok: false, error: "preferences.days_of_week must include at least one day index" };
  }

  days.sort((a, b) => a - b);
  return { ok: true, days };
}

function sanitizePreferencesPatch(rawPreferences) {
  if (
    !rawPreferences
    || typeof rawPreferences !== "object"
    || Array.isArray(rawPreferences)
    || Object.getPrototypeOf(rawPreferences) !== Object.prototype
  ) {
    return { ok: false, error: "preferences must be an object" };
  }

  const patch = {};
  for (const [key, value] of Object.entries(rawPreferences)) {
    if (key === "depth" || key === "delivery_time" || key === "frequency" || key === "timezone") {
      if (typeof value !== "string" || !value.trim()) {
        return { ok: false, error: `preferences.${key} must be a non-empty string` };
      }
      patch[key] = value.trim();
      continue;
    }

    if (key === "items_per_digest") {
      const itemsResult = normalizeItemsPerDigest(value);
      if (!itemsResult.ok) {
        return itemsResult;
      }
      patch.items_per_digest = itemsResult.itemsPerDigest;
      continue;
    }

    if (key === "days_of_week") {
      const daysResult = normalizeDaysOfWeek(value);
      if (!daysResult.ok) {
        return daysResult;
      }
      patch.days_of_week = daysResult.days;
      continue;
    }

    if (key === "email_enabled" || key === "telegram_enabled") {
      if (typeof value !== "boolean") {
        return { ok: false, error: `preferences.${key} must be a boolean` };
      }
      patch[key] = value;
      continue;
    }

    return { ok: false, error: `preferences.${key} is not allowed` };
  }

  if (Array.isArray(patch.days_of_week)) {
    patch.frequency = deriveFrequencyFromDays(patch.days_of_week);
  }

  return { ok: true, patch };
}

function createSettingsHandler({
  toRouteCtx,
  requireJsonBody,
  json,
  getClientIp,
  checkSettingsRateLimit,
  findUserByToken,
  allUsers,
  writeUser,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  PROTECTED_FIELDS,
}) {
  return async function handleSettings(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);

    if (checkSettingsRateLimit && getClientIp) {
      const ip = getClientIp(req);
      const rl = checkSettingsRateLimit(ip);
      if (rl.limited) return json(res, { error: rl.reason }, 429);
    }

    const body = await requireJsonBody(req, res);
    if (body == null) return;

    const { token } = body;
    if (!token) return json(res, { error: "token required" }, 400);

    const existing = findUserByToken(token);
    if (!existing) return json(res, { error: "invalid token" }, 401);

    const safeBody = Object.fromEntries(
      Object.entries(body).filter(([key]) => !PROTECTED_FIELDS.includes(key))
    );

    if (safeBody.preferences != null) {
      const preferencesResult = sanitizePreferencesPatch(safeBody.preferences);
      if (!preferencesResult.ok) {
        return json(res, { error: preferencesResult.error }, 400);
      }
      safeBody.preferences = preferencesResult.patch;
    }

    if (safeBody.topics != null) {
      const topicsResult = normalizeTopicsForUserInput(safeBody.topics, {
        defaultTopics: DEFAULT_TOPICS,
        minRequired: 2,
        maxCustomKeywords: MAX_CUSTOM_KEYWORDS,
      });
      if (!topicsResult.ok) {
        return json(res, { error: topicsResult.error }, 400);
      }
      safeBody.topics = topicsResult.topics;
    }

    if (safeBody.topic_weights != null) {
      const tw = safeBody.topic_weights;
      if (typeof tw !== "object" || Array.isArray(tw)) {
        return json(res, { error: "topic_weights must be an object" }, 400);
      }
      const patch = {};
      for (const [key, val] of Object.entries(tw)) {
        const tag = String(key || "").trim();
        if (!tag) continue;
        const n = Number(val);
        patch[tag] = Number.isFinite(n) ? Math.max(-5, Math.min(5, n)) : 0;
      }
      // Merge patch: 0 = remove key, otherwise set value
      const merged = { ...(existing.topic_weights || {}) };
      for (const [tag, val] of Object.entries(patch)) {
        if (val === 0) delete merged[tag];
        else merged[tag] = val;
      }
      safeBody.topic_weights = merged;
    }

    if (safeBody.source_preferences != null) {
      const sp = safeBody.source_preferences;
      if (typeof sp !== "object" || Array.isArray(sp)) {
        return json(res, { error: "source_preferences must be an object" }, 400);
      }
      const normalizeDomainList = (arr, field) => {
        if (!Array.isArray(arr)) return { ok: false, error: `source_preferences.${field} must be an array` };
        const out = [];
        for (const d of arr) {
          const s = String(d || "").trim().toLowerCase().replace(/^www\./, "");
          if (!s || s.length > 120) continue;
          if (!/^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/.test(s)) continue;
          if (!out.includes(s)) out.push(s);
        }
        return { ok: true, value: out };
      };
      const t = normalizeDomainList(sp.trusted_sources || [], "trusted_sources");
      if (!t.ok) return json(res, { error: t.error }, 400);
      const b = normalizeDomainList(sp.blocked_sources || [], "blocked_sources");
      if (!b.ok) return json(res, { error: b.error }, 400);
      safeBody.source_preferences = { trusted_sources: t.value, blocked_sources: b.value };
    }

    if (safeBody.telegram != null) {
      safeBody.telegram = String(safeBody.telegram).replace(/^@+/, "").trim() || null;
      if (safeBody.telegram) {
        const telegramKey = safeBody.telegram.toLowerCase();
        const telegramConflict = allUsers().find((user) =>
          String(user.telegram || "").toLowerCase() === telegramKey
          && String(user.chatId || "") !== String(existing.chatId || "")
        );
        if (telegramConflict) {
          return json(res, { error: "That Telegram username is already linked to another account." }, 409);
        }
      }
    }

    if (safeBody.email != null) {
      const nextEmail = String(safeBody.email).toLowerCase().trim();
      if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
        return json(res, { error: "invalid email address" }, 400);
      }
      const emailConflict = allUsers().find((user) =>
        String(user.email || "").toLowerCase().trim() === nextEmail
        && String(user.chatId || "") !== String(existing.chatId || "")
      );
      if (emailConflict) {
        return json(res, { error: "That email is already linked to another account." }, 409);
      }
      safeBody.email = nextEmail;
    }

    const updated = normalizeUserRecord({
      ...existing,
      ...safeBody,
      last_updated: new Date().toISOString(),
      preferences: { ...existing.preferences, ...safeBody.preferences },
      ...Object.fromEntries(PROTECTED_FIELDS.map((key) => [key, existing[key]])),
    }, { chatId: existing.chatId });

    if (Array.isArray(updated.topics)) {
      updated.custom_topics = updated.topics.filter((topic) => !DEFAULT_TOPICS.includes(topic));
    }

    if (updated.status === "unsubscribed" && existing.status !== "unsubscribed") {
      updated.email_unsubscribed_at = new Date().toISOString();
    }

    writeUser(existing.chatId, updated);
    return json(res, { success: true });
  };
}

module.exports = {
  createSettingsHandler,
};
