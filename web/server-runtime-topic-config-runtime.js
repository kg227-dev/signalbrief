// MVP topic set: 7 sectors. No capabilities group and no free-form topic controls.
const INDUSTRY_TOPICS = [
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
];

const CAPABILITY_TOPICS = [];

const DEFAULT_TOPICS = [...INDUSTRY_TOPICS];
const MAX_CUSTOM_KEYWORDS = 0;

// Fields that must never be overwritten via /api/settings
const PROTECTED_FIELDS = [
  "chatId",
  "token",
  "joined_at",
  "digests_received",
  "last_digest_items",
  "last_digest_at",
  "digest_dates",
  "last_email_open_at",
  "email_opens_total",
  "signup_referral_source",
];

module.exports = {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  PROTECTED_FIELDS,
};
