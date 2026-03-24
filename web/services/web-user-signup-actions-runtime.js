const { normalizeUserRecord } = require("../../src/platform/store");
const { normalizeTopicsForUserInput } = require("./topic-normalization-runtime");

function parseSignupInput({
  body,
  normalizeReferralToken,
  defaultTopics = [],
  maxCustomKeywords = 3,
  allowExampleEmails = true,
}) {
  const {
    name,
    email,
    telegram,
    topics,
    depth,
    delivery_time,
    frequency,
    days_of_week,
    items_per_digest,
  } = body || {};

  const emailNorm = String(email || "").toLowerCase().trim();
  const referralToken = normalizeReferralToken(body?.referral_token);
  const topicsList = Array.isArray(topics) ? topics : null;

  if (!emailNorm || !name) {
    return { ok: false, status: 400, error: "name and email required" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return { ok: false, status: 400, error: "invalid email address" };
  }
  if (!allowExampleEmails && /@example\.com$/i.test(emailNorm)) {
    return {
      ok: false,
      status: 400,
      error: "example.com emails are blocked in production",
    };
  }
  if (!topicsList) {
    return { ok: false, status: 400, error: "topics must be an array" };
  }

  const normalizedTopicsResult = normalizeTopicsForUserInput(topicsList, {
    defaultTopics,
    minRequired: 2,
    maxCustomKeywords,
  });
  if (!normalizedTopicsResult.ok) {
    return { ok: false, status: 400, error: normalizedTopicsResult.error };
  }
  const normalizedTopics = normalizedTopicsResult.topics;

  return {
    ok: true,
    value: {
      name,
      emailNorm,
      telegramClean: telegram ? String(telegram).replace(/^@+/, "").trim() : null,
      normalizedTopics,
      referralToken,
      depth,
      delivery_time,
      frequency,
      days_of_week,
      items_per_digest,
    },
  };
}

function findSignupConflict({ users, emailNorm }) {
  const existingEmail = users.find((user) => (user.email || "").toLowerCase().trim() === emailNorm);
  if (existingEmail) {
    return {
      status: 409,
      error: "An account with this email already exists. Use your existing settings link to access it.",
    };
  }
  return null;
}

function resolveReferralContext({ referralToken, findUserByToken }) {
  if (!referralToken) {
    return {
      referrerUser: null,
      signupReferralSource: null,
    };
  }

  const referrerUser = findUserByToken(referralToken);
  if (!referrerUser) {
    return {
      referrerUser: null,
      signupReferralSource: null,
    };
  }

  return {
    referrerUser,
    signupReferralSource: {
      chatId: referrerUser.chatId,
      email: referrerUser.email || null,
      ts: new Date().toISOString(),
    },
  };
}

function buildSignupUser({
  chatId,
  input,
  token,
  defaultTopics,
  signupReferralSource,
}) {
  const nowIso = new Date().toISOString();
  return normalizeUserRecord({
    chatId,
    name: input.name,
    email: input.emailNorm,
    topics: input.normalizedTopics,
    status: "active",
    token,
    joined_at: nowIso,
    last_updated: nowIso,
    digests_received: 0,
    bookmarks: [],
    topic_weights: {},
    custom_topics: [],
    signup_referral_source: signupReferralSource,
    digest_dates: [],
    last_digest_items: [],
    preferences: {
      depth: input.depth || "headline_plus_why",
      delivery_time: input.delivery_time || "07:00",
      frequency: input.frequency || "daily_weekday",
      days_of_week: Array.isArray(input.days_of_week) ? input.days_of_week : [1, 2, 3, 4, 5],
      items_per_digest: 5, // MVP: always 5
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: false, // MVP: email only
    },
  }, { chatId });
}

async function runSignupSideEffects({
  user,
  chatId,
  referrerUser,
  sendReferralThankYou,
  sendWelcomeEmail,
  queueDigestTrigger,
  resolveBaseUrl,
}) {
  const tasks = [];

  if (referrerUser) {
    tasks.push(
      sendReferralThankYou(referrerUser, user)
        .then(() => null)
        .catch((err) => ({ code: "referral_thank_you_failed", detail: err.message || "unknown error" }))
    );
  }

  tasks.push(
    sendWelcomeEmail(user)
      .then(() => null)
      .catch((err) => ({ code: "welcome_email_failed", detail: err.message || "unknown error" }))
  );

  tasks.push(
    queueDigestTrigger({
      source: "web:signup_welcome",
      trigger: "signup_welcome",
      chatId,
      maxAdmissionWaitMs: 10 * 60 * 1000,
      env: { BASE_URL: resolveBaseUrl() },
    }).then((outcome) => {
      if (outcome.ok) return null;
      return {
        code: "welcome_digest_trigger_failed",
        detail: outcome.code || "unknown trigger status",
      };
    }).catch((err) => ({ code: "welcome_digest_trigger_failed", detail: err.message || "unknown error" }))
  );

  const settled = await Promise.all(tasks);
  return settled.filter(Boolean);
}

function buildSignupResponse({ user, chatId, sideEffectFailures, resolveBaseUrl }) {
  return {
    success: sideEffectFailures.length === 0,
    account_created: true,
    chatId,
    token: user.token,
    archiveUrl: `${resolveBaseUrl()}/archive?token=${user.token}`,
    warnings: sideEffectFailures,
  };
}

module.exports = {
  parseSignupInput,
  findSignupConflict,
  resolveReferralContext,
  buildSignupUser,
  runSignupSideEffects,
  buildSignupResponse,
};
