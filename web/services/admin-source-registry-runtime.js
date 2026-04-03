"use strict";

const fs = require("fs");
const path = require("path");

const { explainSourcePolicy, normalizeSourceDomain } = require("../../src/digest/domain/storyline-domain-runtime");
const { normalizeSourceIdentityKey } = require("../../src/runtime/source-policy-registry-runtime");
const {
  refreshEffectiveRegistry,
  buildRecentDomainMetrics,
  buildCurationQueues,
  buildSourceAuditEntries,
  createEmptyMetricSummary,
  buildIdentityRecentMetrics,
  buildIdentityCandidates,
} = require("./admin-source-registry-metrics-runtime");
const {
  summarizePreferredSourceCompatibilityView,
  summarizeBrokerConfig,
  buildOverviewRows,
} = require("./admin-source-registry-summary-runtime");

const ROLLING_7D_RANGE = Object.freeze({
  mode: "rolling_7d",
  scope: "rolling_7d",
  label: "Rolling last 7 days",
  description: "Sent items only from the trailing 7-day window ending today ET.",
  sent_only: true,
  start_date_et: null,
  end_date_et: null,
});
const VALIDATION_WEEK_1_RANGE = Object.freeze({
  mode: "validation_week_1",
  scope: "validation_week_1",
  label: "Validation Week 1",
  description: "Sent items only from March 28, 2026 through April 3, 2026 ET.",
  sent_only: true,
  start_date_et: "2026-03-28",
  end_date_et: "2026-04-03",
});
const ALL_TRACKED_HISTORY_RANGE = Object.freeze({
  mode: "all_tracked_history",
  scope: "all_time",
  label: "All tracked history",
  description: "Sent items only across all tracked digest history.",
  sent_only: true,
  start_date_et: null,
  end_date_et: null,
});
const VALIDATION_REVIEW_DOC_REL = "docs/planning/reduced-scope-mvp-validation/source-registry-manual-review.md";
const VALIDATION_REVIEW_DOC_PATH = path.resolve(__dirname, "../../", VALIDATION_REVIEW_DOC_REL);

function normalizeHistoryMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === ALL_TRACKED_HISTORY_RANGE.mode) return ALL_TRACKED_HISTORY_RANGE.mode;
  if (normalized === VALIDATION_WEEK_1_RANGE.mode) return VALIDATION_WEEK_1_RANGE.mode;
  return ROLLING_7D_RANGE.mode;
}

function buildHistoryWindow(mode, recentWindow, rows) {
  const normalizedMode = normalizeHistoryMode(mode);
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  if (normalizedMode === ALL_TRACKED_HISTORY_RANGE.mode) {
    return {
      ...ALL_TRACKED_HISTORY_RANGE,
      start_date_et: String(recentWindow?.start_date_et || "").trim() || null,
      end_date_et: String(recentWindow?.end_date_et || "").trim() || null,
      row_count: rowCount,
    };
  }
  if (normalizedMode === VALIDATION_WEEK_1_RANGE.mode) {
    return {
      ...VALIDATION_WEEK_1_RANGE,
      row_count: rowCount,
    };
  }
  return {
    ...ROLLING_7D_RANGE,
    start_date_et: String(recentWindow?.start_date_et || "").trim() || null,
    end_date_et: String(recentWindow?.end_date_et || "").trim() || null,
    row_count: rowCount,
  };
}

function filterRecentRowsForHistoryMode(rows, mode) {
  const historyMode = normalizeHistoryMode(mode);
  const list = Array.isArray(rows) ? rows : [];
  if (historyMode === ALL_TRACKED_HISTORY_RANGE.mode || historyMode === ROLLING_7D_RANGE.mode) return list.slice();
  return list.filter((row) => {
    const dateEt = String(row?.date_et || "").trim();
    return !!dateEt && dateEt >= VALIDATION_WEEK_1_RANGE.start_date_et && dateEt <= VALIDATION_WEEK_1_RANGE.end_date_et;
  });
}

function normalizeReviewDisposition(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "investigate") return "investigate";
  if (normalized === "replace") return "replace";
  if (normalized === "keep disabled") return "keep_disabled";
  return "keep";
}

function summarizeValidationBrokerSource(source) {
  if (!source || typeof source !== "object") return null;
  const filterCount = Math.max(
    0,
    Number(source?.title_include_pattern_count || 0)
    + Number(source?.title_exclude_pattern_count || 0)
    + Number(source?.url_exclude_pattern_count || 0)
  );
  return {
    id: String(source?.id || "").trim() || null,
    enabled: source?.enabled !== false,
    tier: Number(source?.tier || 2),
    lane: String(source?.lane || "").trim() || null,
    topic_keys: Array.isArray(source?.topic_keys) ? source.topic_keys.slice() : [],
    domains: Array.isArray(source?.domains) ? source.domains.slice() : [],
    filter_count: filterCount,
  };
}

function parseValidationBrokerReviewMarkdown(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const items = [];
  let currentTopic = "";
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentTopic = String(headingMatch[1] || "").trim();
      continue;
    }
    const sourceMatch = line.match(/^- `([^`]+)` \(`([^`]+)`\) — `([^`]+)` — `([^`]+)` — (.+)$/);
    if (sourceMatch) {
      const disposition = String(sourceMatch[4] || "").trim();
      items.push({
        topic: currentTopic || "Unscoped",
        source_id: String(sourceMatch[1] || "").trim(),
        domain: String(sourceMatch[2] || "").trim().toLowerCase() || null,
        roster_state: String(sourceMatch[3] || "").trim() || null,
        disposition,
        disposition_key: normalizeReviewDisposition(disposition),
        note: String(sourceMatch[5] || "").trim() || "",
      });
      continue;
    }
    const topicOnlyMatch = line.match(/^- `([^`]+)` — `([^`]+)` — `([^`]+)` — (.+)$/);
    if (!topicOnlyMatch) continue;
    const disposition = String(topicOnlyMatch[3] || "").trim();
    items.push({
      topic: currentTopic || "Unscoped",
      source_id: String(topicOnlyMatch[1] || "").trim(),
      domain: null,
      roster_state: String(topicOnlyMatch[2] || "").trim() || null,
      disposition,
      disposition_key: normalizeReviewDisposition(disposition),
      note: String(topicOnlyMatch[4] || "").trim() || "",
    });
  }
  return items;
}

function buildValidationReview(brokerConfig) {
  let markdown = "";
  try {
    markdown = fs.readFileSync(VALIDATION_REVIEW_DOC_PATH, "utf8");
  } catch {
    markdown = "";
  }
  const brokerSourcesById = new Map(
    (Array.isArray(brokerConfig?.sources) ? brokerConfig.sources : [])
      .map((source) => [String(source?.id || "").trim(), summarizeValidationBrokerSource(source)])
      .filter(([sourceId]) => !!sourceId)
  );
  const actionableItems = parseValidationBrokerReviewMarkdown(markdown)
    .filter((item) => item.disposition_key !== "keep")
    .map((item) => ({
      ...item,
      broker_source: brokerSourcesById.get(item.source_id) || null,
    }));
  const counts = actionableItems.reduce((acc, item) => {
    const key = item.disposition_key;
    acc[key] = Math.max(0, Number(acc[key] || 0)) + 1;
    return acc;
  }, {
    investigate: 0,
    replace: 0,
    keep_disabled: 0,
  });
  return {
    source_path: VALIDATION_REVIEW_DOC_REL,
    scope: "active broker roster manual review",
    review_count: actionableItems.length,
    counts,
    items: actionableItems,
  };
}

function buildSourceRegistryOverview({
  loadSourceRegistry,
  inspectStandardTopicBrokerConfig,
  buildSourceRegistryMap,
  setAdminSourceRegistry,
  buildRecentDigestsExport,
  sourceRegistryPath,
  historyMode,
  query,
  limit = 20,
}) {
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const brokerConfig = summarizeBrokerConfig(inspectStandardTopicBrokerConfig);
  const preferredSources = summarizePreferredSourceCompatibilityView(inspectStandardTopicBrokerConfig);
  const normalizedHistoryMode = normalizeHistoryMode(historyMode);
  const recentExport = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport(
      normalizedHistoryMode === ALL_TRACKED_HISTORY_RANGE.mode
        ? { all_time: true }
        : (normalizedHistoryMode === ROLLING_7D_RANGE.mode ? { days: 7 } : { all_time: true })
    )
    : { rows: [] };
  const historyWindow = buildHistoryWindow(normalizedHistoryMode, recentExport?.window || null, filterRecentRowsForHistoryMode(recentExport?.rows, normalizedHistoryMode));
  const recent = {
    ...(recentExport || {}),
    rows: filterRecentRowsForHistoryMode(recentExport?.rows, normalizedHistoryMode),
    window: {
      all_time: historyWindow.mode === ALL_TRACKED_HISTORY_RANGE.mode,
      days: historyWindow.mode === ALL_TRACKED_HISTORY_RANGE.mode ? null : 7,
      start_date_et: historyWindow.start_date_et,
      end_date_et: historyWindow.end_date_et,
    },
  };
  const metricsMap = buildRecentDomainMetrics(recent.rows);
  const { suggestions, overrides } = buildOverviewRows(metricsMap, registry.domains || {}, query, Math.max(1, Number(limit || 20)));
  const curationQueues = buildCurationQueues(metricsMap, recent.rows, Math.max(4, Math.min(12, Number(limit || 20))));
  const governanceDomainCount = Object.keys(registry.domains || {}).length;
  const governanceIdentityCount = Object.keys(registry.identities || {}).length;
  const governanceActivePath = String(sourceRegistryPath || brokerConfig?.active_path || "").trim() || null;
  return {
    generated_at: new Date().toISOString(),
    history_mode: historyWindow.mode,
    history_scope: historyWindow.scope,
    history_scope_label: historyWindow.label,
    history_window: historyWindow,
    days: recent?.window?.days ?? null,
    query: String(query || "").trim() || null,
    source_registry_path: null,
    preferred_sources: preferredSources,
    broker_config: brokerConfig,
    validation_review: buildValidationReview(brokerConfig),
    governance_registry: {
      source_of_truth: "standard_topic_broker.governance",
      source_mode: String(brokerConfig?.source_mode || "runtime").trim() || "runtime",
      active_path: governanceActivePath,
      domain_count: governanceDomainCount,
      identity_count: governanceIdentityCount,
      updated_at: String(registry.updated_at || "").trim() || null,
      is_effectively_empty: governanceDomainCount <= 0 && governanceIdentityCount <= 0,
    },
    curation_queues: curationQueues,
    override_count: governanceDomainCount,
    suggestion_count: suggestions.length,
    overrides,
    suggestions,
  };
}

function buildSourceRegistryDomainDetail({
  domain,
  identityKey,
  loadSourceRegistry,
  buildSourceRegistryMap,
  setAdminSourceRegistry,
  buildRecentDigestsExport,
  readJsonLineLog,
  adminActionLog,
  historyMode,
}) {
  const normalizedDomain = normalizeSourceDomain(domain);
  const normalizedIdentityKey = normalizeSourceIdentityKey(identityKey);
  if (!normalizedDomain) return null;
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const normalizedHistoryMode = normalizeHistoryMode(historyMode);
  const recentExport = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport(
      normalizedHistoryMode === ALL_TRACKED_HISTORY_RANGE.mode
        ? { all_time: true }
        : (normalizedHistoryMode === ROLLING_7D_RANGE.mode ? { days: 7 } : { all_time: true })
    )
    : { rows: [] };
  const historyWindow = buildHistoryWindow(normalizedHistoryMode, recentExport?.window || null, filterRecentRowsForHistoryMode(recentExport?.rows, normalizedHistoryMode));
  const recent = {
    ...(recentExport || {}),
    rows: filterRecentRowsForHistoryMode(recentExport?.rows, normalizedHistoryMode),
    window: {
      all_time: historyWindow.mode === ALL_TRACKED_HISTORY_RANGE.mode,
      days: historyWindow.mode === ALL_TRACKED_HISTORY_RANGE.mode ? null : 7,
      start_date_et: historyWindow.start_date_et,
      end_date_et: historyWindow.end_date_et,
    },
  };
  const metricsMap = buildRecentDomainMetrics(recent.rows);
  const effectivePolicy = explainSourcePolicy(
    normalizedDomain,
    null,
    normalizedIdentityKey ? { sourceIdentityKey: normalizedIdentityKey } : undefined
  );
  const domainRecentMetrics = metricsMap.get(normalizedDomain) || createEmptyMetricSummary(normalizedDomain);
  const identityCandidates = buildIdentityCandidates(recent.rows, normalizedDomain, registry.identities || {});
  const selectedIdentity = normalizedIdentityKey
    ? (identityCandidates.find((candidate) => candidate.identity_key === normalizedIdentityKey) || {
      identity_key: normalizedIdentityKey,
      source_identity_scope: "identity",
      source_identity_label: normalizedIdentityKey,
      source_identity_ambiguous: false,
      send_count: 0,
      top_tags: [],
      last_seen_at: null,
      direct_override: registry.identities?.[normalizedIdentityKey] || null,
      effective_policy: effectivePolicy,
    })
    : null;
  const recentMetrics = metricsMap.get(normalizedDomain) || {
    ...createEmptyMetricSummary(normalizedDomain),
  };
  return {
    generated_at: new Date().toISOString(),
    history_mode: historyWindow.mode,
    history_scope: historyWindow.scope,
    history_scope_label: historyWindow.label,
    history_window: historyWindow,
    days: recent?.window?.days ?? null,
    domain: normalizedDomain,
    selected_scope: normalizedIdentityKey ? "identity" : "domain",
    selected_identity_key: normalizedIdentityKey || null,
    selected_identity: selectedIdentity,
    identity_candidates: identityCandidates,
    effective_policy: effectivePolicy,
    admin_override: effectivePolicy?.admin_override || null,
    direct_override: normalizedIdentityKey
      ? (registry.identities?.[normalizedIdentityKey] || null)
      : (registry.domains?.[normalizedDomain] || null),
    recent_metrics: normalizedIdentityKey
      ? buildIdentityRecentMetrics(recent.rows, normalizedDomain, normalizedIdentityKey)
      : recentMetrics,
    domain_recent_metrics: domainRecentMetrics,
    audit_entries: buildSourceAuditEntries({
      readJsonLineLog,
      adminActionLog,
      domain: normalizedDomain,
      identityKey: normalizedIdentityKey || null,
      limit: 20,
    }),
  };
}

module.exports = {
  buildRecentDomainMetrics,
  buildCurationQueues,
  summarizePreferredSourceCompatibilityView,
  summarizeBrokerConfig,
  buildSourceRegistryDomainDetail,
  buildSourceRegistryOverview,
  buildSourceAuditEntries,
  refreshEffectiveRegistry,
};
