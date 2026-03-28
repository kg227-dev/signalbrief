const crypto = require("crypto");
const { DEFAULT_TOPICS } = require("./persona-topics");

function buildQaToken(id) {
  return crypto.createHash("sha256").update(`qa-persona:${id}`).digest("hex");
}

function basePersona(id, name, purpose, overrides = {}) {
  const persona = {
    id,
    name,
    purpose,
    is_stress: false,
    chatId: `qa-${id}`,
    email: `${id}@qa.signalbrief.local`,
    status: "active",
    token: buildQaToken(id),
    digests_received: 0,
    joined_at: "2026-03-01T00:00:00.000Z",
    last_digest_at: null,
    digest_dates: [],
    last_digest_items: [],
    topics: DEFAULT_TOPICS.slice(0, 3),
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      frequency: "daily_weekday",
      days_of_week: [1, 2, 3, 4, 5],
      timezone: "America/New_York",
      email_enabled: true,
    },
  };

  const merged = {
    ...persona,
    ...overrides,
    preferences: {
      ...persona.preferences,
      ...(overrides.preferences || {}),
    },
  };
  return merged;
}

module.exports = {
  basePersona,
};
