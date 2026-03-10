const INDUSTRY_TOPICS = [
  "HEALTHCARE", "FINANCIAL SERVICES", "PE×M&A", "ENERGY", "CONSUMER",
  "LIFE SCIENCES", "TECHNOLOGY", "INDUSTRIALS", "REAL ESTATE", "PUBLIC SECTOR",
];

const CAPABILITY_TOPICS = [
  "AI×TECH", "STRATEGY", "POLICY×REGULATORY", "SUSTAINABILITY",
  "DIGITAL", "M&A ADVISORY", "TALENT",
];

const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];

// Fields that must never be overwritten via /api/settings
const PROTECTED_FIELDS = [
  "chatId",
  "token",
  "joined_at",
  "digests_received",
  "bookmarks",
  "last_digest_items",
  "last_digest_at",
  "digest_dates",
  "last_email_open_at",
  "email_opens_total",
  "reengagement_state",
  "signup_referral_source",
];

module.exports = {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  DEFAULT_TOPICS,
  PROTECTED_FIELDS,
};
