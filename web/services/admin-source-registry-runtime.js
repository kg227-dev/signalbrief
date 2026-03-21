"use strict";

const {
  explainSourcePolicy,
  isWeakSourceItem,
  normalizeSourceDomain,
} = require("../../src/digest/domain/storyline-domain-runtime");

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesQuery(haystacks, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return haystacks.some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry) {
  const registry = typeof loadSourceRegistry === "function"
    ? loadSourceRegistry()
    : { domains: {} };
  if (typeof setAdminSourceRegistry === "function" && typeof buildSourceRegistryMap === "function") {
    setAdminSourceRegistry(buildSourceRegistryMap(registry));
  }
  return registry;
}

function createMetricEntry(domain) {
  return {
    domain,
    send_count: 0,
    weak_source_item_count: 0,
    poor_digest_item_count: 0,
    users: new Set(),
    digests: new Set(),
    tags: new Map(),
    authority_sum: 0,
    authority_count: 0,
    sample_items: [],
    recent_users: new Map(),
    last_seen_at: null,
  };
}

function pushSample(entry, row, item) {
  entry.sample_items.push({
    date_et: String(row?.date_et || "").trim() || null,
    run_at_utc: String(row?.run_at_utc || row?.sent_at_utc || "").trim() || null,
    recipient: String(row?.user_email || row?.recipient || row?.user_id || "").trim() || null,
    headline: String(item?.headline || "").trim() || null,
    url: String(item?.url || "").trim() || null,
    tag: String(item?.tag || "").trim() || null,
    source_tier: String(item?.source_tier || "").trim() || null,
    source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
    source_type: String(item?.source_type || "").trim() || null,
    source_policy: String(item?.source_policy || "").trim() || null,
    source_review_status: String(item?.source_review_status || "").trim() || null,
  });
}

function finalizeMetricEntry(entry) {
  const topTags = Array.from(entry.tags.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));
  const recentUsers = Array.from(entry.recent_users.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([user, count]) => ({ user, count }));
  const sampleItems = entry.sample_items
    .sort((left, right) => String(right?.run_at_utc || "").localeCompare(String(left?.run_at_utc || "")))
    .slice(0, 8);

  return {
    domain: entry.domain,
    send_count: entry.send_count,
    weak_source_item_count: entry.weak_source_item_count,
    poor_digest_item_count: entry.poor_digest_item_count,
    user_count: entry.users.size,
    digest_count: entry.digests.size,
    avg_sent_authority: entry.authority_count > 0
      ? Number((entry.authority_sum / entry.authority_count).toFixed(3))
      : null,
    top_tags: topTags,
    recent_users: recentUsers,
    sample_items: sampleItems,
    last_seen_at: entry.last_seen_at,
  };
}

function buildRecentDomainMetrics(rows = []) {
  const metrics = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const digestKey = String(row?.digest_id || row?.run_id || "").trim();
    const userKey = String(row?.user_email || row?.recipient || row?.user_id || "").trim().toLowerCase();
    const items = Array.isArray(row?.sent_items) ? row.sent_items : [];
    const poorDigest = Number(row?.quality_score || 0) < 70
      || String(row?.dominant_failure_mode || "").trim().toLowerCase() === "weak_source";

    for (const item of items) {
      const domain = normalizeSourceDomain(item?.source_domain);
      if (!domain) continue;
      if (!metrics.has(domain)) metrics.set(domain, createMetricEntry(domain));
      const entry = metrics.get(domain);
      entry.send_count += 1;
      if (userKey) entry.users.add(userKey);
      if (digestKey) entry.digests.add(digestKey);
      if (isWeakSourceItem(item)) entry.weak_source_item_count += 1;
      if (poorDigest) entry.poor_digest_item_count += 1;
      if (Number.isFinite(Number(item?.source_authority))) {
        entry.authority_sum += Number(item.source_authority);
        entry.authority_count += 1;
      }
      const tag = String(item?.tag || "").trim();
      if (tag) entry.tags.set(tag, (entry.tags.get(tag) || 0) + 1);
      if (userKey) entry.recent_users.set(userKey, (entry.recent_users.get(userKey) || 0) + 1);
      const seenAt = String(row?.run_at_utc || row?.sent_at_utc || "").trim();
      if (seenAt && (!entry.last_seen_at || seenAt > entry.last_seen_at)) entry.last_seen_at = seenAt;
      pushSample(entry, row, item);
    }
  }
  return new Map(Array.from(metrics.entries()).map(([domain, entry]) => [domain, finalizeMetricEntry(entry)]));
}

function buildSourceAuditEntries({ readJsonLineLog, adminActionLog, domain, limit = 20 }) {
  if (typeof readJsonLineLog !== "function") return [];
  const normalized = normalizeSourceDomain(domain);
  if (!normalized) return [];
  return readJsonLineLog(adminActionLog, limit * 8)
    .filter((row) => {
      const action = String(row?.action || "").trim();
      if (action !== "source_policy_upsert" && action !== "source_policy_reset") return false;
      return normalizeSourceDomain(row?.details?.domain) === normalized;
    })
    .map((row) => ({
      at: String(row?.at || "").trim() || null,
      actor: String(row?.actor || "").trim() || "unknown",
      action: String(row?.action || "").trim() || "source_policy",
      success: row?.success !== false,
      note: String(row?.details?.note || "").trim() || "",
      before: row?.details?.before || null,
      after: row?.details?.after || null,
    }))
    .sort((left, right) => String(right?.at || "").localeCompare(String(left?.at || "")))
    .slice(0, limit);
}

function summarizePreferredSourceRegistry({
  loadPreferredSourceRegistry,
  inspectPreferredSourceRegistry,
  preferredSourcesPath,
  bundledPreferredSourcesPath,
}) {
  const snapshot = typeof inspectPreferredSourceRegistry === "function"
    ? inspectPreferredSourceRegistry()
    : null;
  const registry = snapshot?.registry || (typeof loadPreferredSourceRegistry === "function"
    ? loadPreferredSourceRegistry()
    : {});
  const globalReported = Array.isArray(registry?.global?.reported) ? registry.global.reported : [];
  const globalOfficial = Array.isArray(registry?.global?.official) ? registry.global.official : [];
  const topics = Object.entries(registry?.topics && typeof registry.topics === "object" ? registry.topics : {})
    .map(([topic, entry]) => {
      const reported = Array.isArray(entry?.reported) ? entry.reported : [];
      const official = Array.isArray(entry?.official) ? entry.official : [];
      return {
        topic,
        reported,
        official,
        reported_count: reported.length,
        official_count: official.length,
      };
    })
    .sort((left, right) => left.topic.localeCompare(right.topic));
  const uniqueDomains = new Set([
    ...globalReported,
    ...globalOfficial,
    ...topics.flatMap((entry) => [...entry.reported, ...entry.official]),
  ]);
  return {
    path: String(snapshot?.active_path || preferredSourcesPath || "").trim() || null,
    runtime_path: String(snapshot?.runtime_path || preferredSourcesPath || "").trim() || null,
    bundled_path: String(snapshot?.bundled_path || bundledPreferredSourcesPath || "").trim() || null,
    source_mode: String(snapshot?.source_mode || "runtime").trim() || "runtime",
    used_fallback: snapshot?.used_fallback === true,
    version: Number(registry?.version || 1),
    global: {
      reported: globalReported,
      official: globalOfficial,
    },
    topic_count: topics.length,
    total_unique_domains: uniqueDomains.size,
    topics,
    raw_json: JSON.stringify(registry || {}, null, 2),
  };
}

function summarizeSuggestedReason(metric, effectivePolicy) {
  if (effectivePolicy?.hard_block === true) return "Hard-blocked";
  if (effectivePolicy?.review_status === "unreviewed" && Number(metric?.send_count || 0) >= 2) {
    return "Unreviewed source with digest exposure";
  }
  if (effectivePolicy?.source_policy === "review" && Number(metric?.weak_source_item_count || 0) >= 2) {
    return "Review-policy source showing weak exposure";
  }
  if (effectivePolicy?.source_policy === "limited" && Number(metric?.poor_digest_item_count || 0) >= 2) {
    return "Limited-policy source common in weak digests";
  }
  if (Number(metric?.weak_source_item_count || 0) >= 3) return "Frequent weak-source exposure";
  if (Number(metric?.poor_digest_item_count || 0) >= 3) return "Common in weak digests";
  return "Tracked source activity";
}

function buildOverviewRows(metricsMap, registryDomains, query, limit) {
  const suggestions = Array.from(metricsMap.values())
    .map((metric) => {
      const effectivePolicy = explainSourcePolicy(metric.domain);
      const override = registryDomains[metric.domain] || null;
      return {
        ...metric,
        effective_policy: effectivePolicy,
        admin_override: override,
        suggested_reason: summarizeSuggestedReason(metric, effectivePolicy),
      };
    })
    .filter((row) => matchesQuery([
      row.domain,
      row.suggested_reason,
      row.effective_policy?.source_tier,
      row.effective_policy?.source_type,
      row.effective_policy?.source_policy,
      row.effective_policy?.review_status,
      row.admin_override?.note,
      ...(Array.isArray(row.top_tags) ? row.top_tags.map((tag) => tag.tag) : []),
    ], query))
    .sort((left, right) => {
      const weakDelta = Number(right.weak_source_item_count || 0) - Number(left.weak_source_item_count || 0);
      if (weakDelta !== 0) return weakDelta;
      const poorDelta = Number(right.poor_digest_item_count || 0) - Number(left.poor_digest_item_count || 0);
      if (poorDelta !== 0) return poorDelta;
      const sendDelta = Number(right.send_count || 0) - Number(left.send_count || 0);
      if (sendDelta !== 0) return sendDelta;
      return String(left.domain || "").localeCompare(String(right.domain || ""));
    })
    .slice(0, limit);

  const overrides = Object.values(registryDomains)
    .map((entry) => ({
      ...entry,
      effective_policy: explainSourcePolicy(entry.domain),
      recent_metrics: metricsMap.get(entry.domain) || null,
    }))
    .filter((row) => matchesQuery([
      row.domain,
      row.tier_override,
      row.source_type,
      row.policy,
      row.review_status,
      row.note,
      row.effective_policy?.source_tier,
      row.effective_policy?.source_policy,
    ], query))
    .sort((left, right) => {
      if ((left.hard_block === true) !== (right.hard_block === true)) return left.hard_block === true ? -1 : 1;
      return String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
        || String(left.domain || "").localeCompare(String(right.domain || ""));
    })
    .slice(0, limit);

  return { suggestions, overrides };
}

function buildSourceRegistryOverview({
  loadSourceRegistry,
  loadPreferredSourceRegistry,
  inspectPreferredSourceRegistry,
  buildSourceRegistryMap,
  setAdminSourceRegistry,
  buildRecentDigestsExport,
  preferredSourcesPath,
  bundledPreferredSourcesPath,
  query,
  limit = 20,
}) {
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const recent = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ all_time: true })
    : { rows: [] };
  const metricsMap = buildRecentDomainMetrics(recent.rows);
  const { suggestions, overrides } = buildOverviewRows(metricsMap, registry.domains || {}, query, Math.max(1, Number(limit || 20)));
  return {
    generated_at: new Date().toISOString(),
    history_scope: recent?.window?.all_time === true ? "all_time" : "windowed",
    days: recent?.window?.days ?? null,
    query: String(query || "").trim() || null,
    source_registry_path: null,
    preferred_sources: summarizePreferredSourceRegistry({
      loadPreferredSourceRegistry,
      inspectPreferredSourceRegistry,
      preferredSourcesPath,
      bundledPreferredSourcesPath,
    }),
    override_count: Object.keys(registry.domains || {}).length,
    suggestion_count: suggestions.length,
    overrides,
    suggestions,
  };
}

function buildSourceRegistryDomainDetail({
  domain,
  loadSourceRegistry,
  buildSourceRegistryMap,
  setAdminSourceRegistry,
  buildRecentDigestsExport,
  readJsonLineLog,
  adminActionLog,
}) {
  const normalizedDomain = normalizeSourceDomain(domain);
  if (!normalizedDomain) return null;
  const registry = refreshEffectiveRegistry(loadSourceRegistry, buildSourceRegistryMap, setAdminSourceRegistry);
  const recent = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ all_time: true })
    : { rows: [] };
  const metricsMap = buildRecentDomainMetrics(recent.rows);
  const effectivePolicy = explainSourcePolicy(normalizedDomain);
  const recentMetrics = metricsMap.get(normalizedDomain) || {
    domain: normalizedDomain,
    send_count: 0,
    weak_source_item_count: 0,
    poor_digest_item_count: 0,
    user_count: 0,
    digest_count: 0,
    avg_sent_authority: null,
    top_tags: [],
    recent_users: [],
    sample_items: [],
    last_seen_at: null,
  };
  return {
    generated_at: new Date().toISOString(),
    history_scope: recent?.window?.all_time === true ? "all_time" : "windowed",
    days: recent?.window?.days ?? null,
    domain: normalizedDomain,
    effective_policy: effectivePolicy,
    admin_override: effectivePolicy?.admin_override || null,
    direct_override: registry.domains?.[normalizedDomain] || null,
    recent_metrics: recentMetrics,
    audit_entries: buildSourceAuditEntries({
      readJsonLineLog,
      adminActionLog,
      domain: normalizedDomain,
      limit: 20,
    }),
  };
}

module.exports = {
  buildRecentDomainMetrics,
  summarizePreferredSourceRegistry,
  buildSourceRegistryDomainDetail,
  buildSourceRegistryOverview,
  buildSourceAuditEntries,
  isWeakSourceItem,
  refreshEffectiveRegistry,
};
