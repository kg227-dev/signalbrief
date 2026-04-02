"use strict";

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

function buildSourceRegistryOverview({
  loadSourceRegistry,
  inspectStandardTopicBrokerConfig,
  buildSourceRegistryMap,
  setAdminSourceRegistry,
  buildRecentDigestsExport,
  query,
  limit = 20,
}) {
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const recent = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ all_time: true })
    : { rows: [] };
  const metricsMap = buildRecentDomainMetrics(recent.rows);
  const { suggestions, overrides } = buildOverviewRows(metricsMap, registry.domains || {}, query, Math.max(1, Number(limit || 20)));
  const curationQueues = buildCurationQueues(metricsMap, recent.rows, Math.max(4, Math.min(12, Number(limit || 20))));
  return {
    generated_at: new Date().toISOString(),
    history_scope: recent?.window?.all_time === true ? "all_time" : "windowed",
    days: recent?.window?.days ?? null,
    query: String(query || "").trim() || null,
    source_registry_path: null,
    preferred_sources: summarizePreferredSourceCompatibilityView(inspectStandardTopicBrokerConfig),
    broker_config: summarizeBrokerConfig(inspectStandardTopicBrokerConfig),
    curation_queues: curationQueues,
    override_count: Object.keys(registry.domains || {}).length,
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
}) {
  const normalizedDomain = normalizeSourceDomain(domain);
  const normalizedIdentityKey = normalizeSourceIdentityKey(identityKey);
  if (!normalizedDomain) return null;
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const recent = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ all_time: true })
    : { rows: [] };
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
    history_scope: recent?.window?.all_time === true ? "all_time" : "windowed",
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
