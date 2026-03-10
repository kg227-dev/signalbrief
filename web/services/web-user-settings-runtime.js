const { normalizeUserRecord } = require("../../src/platform/store");
const { normalizeTopicsForUserInput } = require("./topic-normalization-runtime");

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
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, error: "preferences.items_per_digest must be a positive number" };
      }
      patch.items_per_digest = Math.floor(parsed);
      continue;
    }

    if (key === "days_of_week") {
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
      patch.days_of_week = days;
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

  return { ok: true, patch };
}

function createSettingsHandler({
  toRouteCtx,
  requireJsonBody,
  json,
  findUserByToken,
  allUsers,
  writeUser,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  PROTECTED_FIELDS,
}) {
  return async function handleSettings(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
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
