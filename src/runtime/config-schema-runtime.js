"use strict";

const DELIVERY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pushError(errors, fieldPath, message) {
  errors.push(`${fieldPath}: ${message}`);
}

function expectObject(errors, fieldPath, value) {
  if (isPlainObject(value)) return true;
  pushError(errors, fieldPath, "must be an object");
  return false;
}

function expectNonEmptyString(errors, fieldPath, value) {
  if (isNonEmptyString(value)) return true;
  pushError(errors, fieldPath, "must be a non-empty string");
  return false;
}

function expectPositiveInteger(errors, fieldPath, value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    pushError(errors, fieldPath, "must be an integer");
    return false;
  }
  if (parsed < min || parsed > max) {
    pushError(errors, fieldPath, `must be between ${min} and ${max}`);
    return false;
  }
  return true;
}

function validateTopicEntry(errors, topic, idx, seenTags) {
  const topicPath = `topics[${idx}]`;
  if (!expectObject(errors, topicPath, topic)) return;

  if (!expectNonEmptyString(errors, `${topicPath}.tag`, topic.tag)) return;
  const normalizedTag = String(topic.tag || "").trim().toUpperCase();
  if (seenTags.has(normalizedTag)) {
    pushError(errors, `${topicPath}.tag`, `duplicate tag '${normalizedTag}'`);
  } else {
    seenTags.add(normalizedTag);
  }

  if (!Array.isArray(topic.queries) || topic.queries.length === 0) {
    pushError(errors, `${topicPath}.queries`, "must be a non-empty array");
    return;
  }

  topic.queries.forEach((query, queryIdx) => {
    if (!isNonEmptyString(query)) {
      pushError(errors, `${topicPath}.queries[${queryIdx}]`, "must be a non-empty string");
    }
  });
}

function validateConfigSchema(config) {
  const errors = [];
  if (!expectObject(errors, "config", config)) {
    return { ok: false, errors };
  }

  const user = config.user;
  if (expectObject(errors, "user", user)) {
    expectNonEmptyString(errors, "user.email", user.email);
    if (expectNonEmptyString(errors, "user.deliveryTime", user.deliveryTime)) {
      if (!DELIVERY_TIME_RE.test(String(user.deliveryTime || "").trim())) {
        pushError(errors, "user.deliveryTime", "must match HH:MM (24h)");
      }
    }
    expectNonEmptyString(errors, "user.timezone", user.timezone);
  }

  const digest = config.digest;
  if (expectObject(errors, "digest", digest)) {
    expectPositiveInteger(errors, "digest.itemCount", digest.itemCount, { min: 1, max: 20 });
    if (digest.maxItemsPerTag != null) {
      expectPositiveInteger(errors, "digest.maxItemsPerTag", digest.maxItemsPerTag, { min: 1, max: 10 });
    }
    if (digest.maxItemsPerSourceDomain != null) {
      expectPositiveInteger(errors, "digest.maxItemsPerSourceDomain", digest.maxItemsPerSourceDomain, { min: 1, max: 10 });
    }
    if (digest.lookbackHours != null) {
      expectPositiveInteger(errors, "digest.lookbackHours", digest.lookbackHours, { min: 1, max: 168 });
    }
  }

  if (!Array.isArray(config.topics) || config.topics.length === 0) {
    pushError(errors, "topics", "must be a non-empty array");
  } else {
    const seenTags = new Set();
    config.topics.forEach((topic, idx) => validateTopicEntry(errors, topic, idx, seenTags));
  }

  const admin = config.admin;
  if (expectObject(errors, "admin", admin)) {
    expectNonEmptyString(errors, "admin.email", admin.email);
    expectNonEmptyString(errors, "admin.salt", admin.salt);
    expectNonEmptyString(errors, "admin.passwordHash", admin.passwordHash);
  }

  const keys = config.keys;
  if (expectObject(errors, "keys", keys)) {
    [
      "perplexity",
      "anthropic",
      "googleRefreshToken",
      "googleClientId",
      "googleClientSecret",
      "telegramBotToken",
      "signalBriefBotToken",
      "resendApiKey",
      "unsubscribeSigningSecret",
      "fromEmail",
      "fromName",
    ].forEach((field) => {
      if (keys[field] != null && typeof keys[field] !== "string") {
        pushError(errors, `keys.${field}`, "must be a string when provided");
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateConfigSchema,
};
