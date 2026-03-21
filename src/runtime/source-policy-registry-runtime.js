"use strict";

const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");

const DEFAULT_REGISTRY_VERSION = 1;
const MAX_NOTE_LENGTH = 400;
const SOURCE_TYPE_VALUES = Object.freeze([
  "primary_official",
  "reported_media",
  "trade_specialist",
  "corporate_pr",
  "analysis_blog",
  "aggregator_republisher",
  "platform_user_generated",
  "unclassified",
]);
const SOURCE_POLICY_VALUES = Object.freeze([
  "preferred",
  "allowed",
  "limited",
  "review",
  "blocked",
]);
const REVIEW_STATUS_VALUES = Object.freeze([
  "reviewed",
  "monitor",
  "unreviewed",
]);
const ORIGINALITY_PROFILE_VALUES = Object.freeze([
  "primary",
  "original_reporting",
  "derived_synthesis",
  "rewrite_aggregator",
  "press_release_repost",
  "unknown",
]);
const TOPIC_FIT_BAND_VALUES = Object.freeze([
  "low",
  "medium",
  "high",
]);
const TOPIC_FIT_BAND_SCORES = Object.freeze({
  low: 0.25,
  medium: 0.65,
  high: 1,
});
const SOURCE_POLICY_RANKING_EFFECTS = Object.freeze({
  preferred: Object.freeze({
    lead_eligible: true,
    exposure_cap: null,
    requires_corroboration: false,
    score_multiplier: 1.04,
  }),
  allowed: Object.freeze({
    lead_eligible: true,
    exposure_cap: null,
    requires_corroboration: false,
    score_multiplier: 1,
  }),
  limited: Object.freeze({
    lead_eligible: false,
    exposure_cap: 1,
    requires_corroboration: true,
    score_multiplier: 0.88,
  }),
  review: Object.freeze({
    lead_eligible: false,
    exposure_cap: 1,
    requires_corroboration: true,
    score_multiplier: 0.76,
  }),
  blocked: Object.freeze({
    lead_eligible: false,
    exposure_cap: 0,
    requires_corroboration: true,
    score_multiplier: 0,
  }),
});
const TIER_OVERRIDE_SCORES = Object.freeze({
  premium: 0.95,
  strong: 0.8,
  standard: 0.6,
  blog: 0.48,
  corporate: 0.42,
  weak: 0.22,
  suspect: 0.15,
  unknown: 0.3,
});
const ALLOWED_TIER_OVERRIDES = new Set(Object.keys(TIER_OVERRIDE_SCORES));
const ALLOWED_SOURCE_TYPES = new Set(SOURCE_TYPE_VALUES);
const ALLOWED_SOURCE_POLICIES = new Set(SOURCE_POLICY_VALUES);
const ALLOWED_REVIEW_STATUSES = new Set(REVIEW_STATUS_VALUES);
const ALLOWED_ORIGINALITY_PROFILES = new Set(ORIGINALITY_PROFILE_VALUES);
const ALLOWED_TOPIC_FIT_BANDS = new Set(TOPIC_FIT_BAND_VALUES);

function clampAuthority(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSourcePolicyDomain(rawValue) {
  let value = String(rawValue || "").trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split(/[/?#\s]/)[0] || "";
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^(?:ng|m|amp|mobile|rss|feeds|api|cdn|static|images)\./i, "");
  value = value.replace(/^[a-z]\./i, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return "";
  return value;
}

function sanitizeTierOverride(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return ALLOWED_TIER_OVERRIDES.has(normalized) ? normalized : null;
}

function normalizeSourceTopicToken(rawValue) {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function sanitizeEnumValue(rawValue, allowedValues) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : null;
}

function sanitizeSourceType(rawValue) {
  return sanitizeEnumValue(rawValue, ALLOWED_SOURCE_TYPES);
}

function sanitizeSourcePolicy(rawValue) {
  return sanitizeEnumValue(rawValue, ALLOWED_SOURCE_POLICIES);
}

function sanitizeReviewStatus(rawValue) {
  return sanitizeEnumValue(rawValue, ALLOWED_REVIEW_STATUSES);
}

function sanitizeOriginalityProfile(rawValue) {
  return sanitizeEnumValue(rawValue, ALLOWED_ORIGINALITY_PROFILES);
}

function sanitizeTopicFitMap(rawValue) {
  const input = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const topicFit = {};
  for (const [rawTopic, rawBand] of Object.entries(input)) {
    const topic = normalizeSourceTopicToken(rawTopic);
    const band = sanitizeEnumValue(rawBand, ALLOWED_TOPIC_FIT_BANDS);
    if (!topic || !band) continue;
    topicFit[topic] = band;
  }
  return topicFit;
}

function sanitizeRegistryEntry(domain, rawEntry, meta = {}) {
  const normalizedDomain = normalizeSourcePolicyDomain(domain || rawEntry?.domain);
  if (!normalizedDomain) return null;
  const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const tierOverride = sanitizeTierOverride(entry.tier_override);
  const authorityOverride = clampAuthority(entry.authority_override);
  const sourceType = sanitizeSourceType(entry.source_type);
  const policy = sanitizeSourcePolicy(entry.policy);
  const reviewStatus = sanitizeReviewStatus(entry.review_status);
  const originalityProfile = sanitizeOriginalityProfile(entry.originality_profile);
  const topicFit = sanitizeTopicFitMap(entry.topic_fit);
  const hardBlock = entry.hard_block === true || policy === "blocked";
  const note = String(entry.note || "").trim().slice(0, MAX_NOTE_LENGTH);
  const updatedAt = String(meta.updated_at || entry.updated_at || "").trim() || null;
  const updatedBy = String(meta.updated_by || entry.updated_by || "").trim() || null;
  return {
    domain: normalizedDomain,
    source_type: sourceType,
    policy: hardBlock ? "blocked" : policy,
    review_status: reviewStatus,
    topic_fit: topicFit,
    originality_profile: originalityProfile,
    tier_override: tierOverride,
    authority_override: authorityOverride,
    hard_block: hardBlock,
    note,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

function sanitizeRegistry(rawRegistry) {
  const registry = rawRegistry && typeof rawRegistry === "object" ? rawRegistry : {};
  const domainsRaw = registry.domains && typeof registry.domains === "object" ? registry.domains : {};
  const domains = {};
  for (const [domain, rawEntry] of Object.entries(domainsRaw)) {
    const sanitized = sanitizeRegistryEntry(domain, rawEntry);
    if (!sanitized) continue;
    domains[sanitized.domain] = sanitized;
  }
  return {
    version: DEFAULT_REGISTRY_VERSION,
    updated_at: String(registry.updated_at || "").trim() || null,
    domains,
  };
}

function createSourceRegistryRuntime(options = {}) {
  const fs = options.fs || require("fs");
  const path = options.path || require("path");
  const sourceRegistryPath = String(options.sourceRegistryPath || "").trim() || resolveSignalBriefRuntimePaths({
    appRoot: options.appRoot,
    env: options.env,
    nodeEnv: options.nodeEnv,
  }).sourceRegistryPath;

  function loadSourceRegistry() {
    try {
      const raw = fs.readFileSync(sourceRegistryPath, "utf8");
      return sanitizeRegistry(JSON.parse(raw));
    } catch {
      return {
        version: DEFAULT_REGISTRY_VERSION,
        updated_at: null,
        domains: {},
      };
    }
  }

  function buildRegistryMap(registry = loadSourceRegistry()) {
    return new Map(Object.entries(registry?.domains || {}));
  }

  function writeSourceRegistry(registry) {
    const sanitized = sanitizeRegistry(registry);
    const dir = path.dirname(sourceRegistryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sourceRegistryPath, JSON.stringify(sanitized, null, 2), "utf8");
    return sanitized;
  }

  function listSourceRegistryEntries() {
    return Object.values(loadSourceRegistry().domains)
      .sort((left, right) => String(left?.domain || "").localeCompare(String(right?.domain || "")));
  }

  function getSourceRegistryEntry(domain) {
    const normalized = normalizeSourcePolicyDomain(domain);
    if (!normalized) return null;
    return loadSourceRegistry().domains[normalized] || null;
  }

  function upsertSourceRegistryEntry(input, meta = {}) {
    const normalized = normalizeSourcePolicyDomain(input?.domain);
    if (!normalized) {
      const error = new Error("valid domain required");
      error.code = "invalid_domain";
      throw error;
    }
    const nowIso = String(meta.now || new Date().toISOString());
    const registry = loadSourceRegistry();
    const before = registry.domains[normalized] || null;
    const nextEntry = sanitizeRegistryEntry(normalized, input, {
      updated_at: nowIso,
      updated_by: meta.updated_by || null,
    });
    if (!nextEntry) {
      const error = new Error("invalid source registry entry");
      error.code = "invalid_entry";
      throw error;
    }
    registry.domains[normalized] = nextEntry;
    registry.updated_at = nowIso;
    const saved = writeSourceRegistry(registry);
    return {
      registry: saved,
      before,
      after: saved.domains[normalized] || null,
    };
  }

  function resetSourceRegistryEntry(domain, meta = {}) {
    const normalized = normalizeSourcePolicyDomain(domain);
    if (!normalized) {
      const error = new Error("valid domain required");
      error.code = "invalid_domain";
      throw error;
    }
    const registry = loadSourceRegistry();
    const before = registry.domains[normalized] || null;
    if (!before) {
      return {
        registry,
        before: null,
        after: null,
      };
    }
    delete registry.domains[normalized];
    registry.updated_at = String(meta.now || new Date().toISOString());
    const saved = writeSourceRegistry(registry);
    return {
      registry: saved,
      before,
      after: null,
    };
  }

  return {
    sourceRegistryPath,
    loadSourceRegistry,
    writeSourceRegistry,
    buildRegistryMap,
    listSourceRegistryEntries,
    getSourceRegistryEntry,
    upsertSourceRegistryEntry,
    resetSourceRegistryEntry,
  };
}

module.exports = {
  ALLOWED_ORIGINALITY_PROFILES,
  ALLOWED_REVIEW_STATUSES,
  ALLOWED_SOURCE_POLICIES,
  ALLOWED_SOURCE_TYPES,
  ALLOWED_TOPIC_FIT_BANDS,
  ALLOWED_TIER_OVERRIDES,
  DEFAULT_REGISTRY_VERSION,
  MAX_NOTE_LENGTH,
  ORIGINALITY_PROFILE_VALUES,
  REVIEW_STATUS_VALUES,
  SOURCE_POLICY_RANKING_EFFECTS,
  SOURCE_POLICY_VALUES,
  SOURCE_TYPE_VALUES,
  TIER_OVERRIDE_SCORES,
  TOPIC_FIT_BAND_SCORES,
  TOPIC_FIT_BAND_VALUES,
  clampAuthority,
  createSourceRegistryRuntime,
  normalizeSourcePolicyDomain,
  normalizeSourceTopicToken,
  sanitizeRegistry,
  sanitizeRegistryEntry,
  sanitizeOriginalityProfile,
  sanitizeReviewStatus,
  sanitizeSourcePolicy,
  sanitizeSourceType,
  sanitizeTierOverride,
  sanitizeTopicFitMap,
};
