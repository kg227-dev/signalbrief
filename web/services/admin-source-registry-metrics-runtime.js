"use strict";

const {
  explainSourcePolicy,
  isWeakSourceItem,
  normalizeSourceDomain,
} = require("../../src/digest/domain/storyline-domain-runtime");
const {
  inferSourceDomainFromIdentityKey,
  normalizeSourceIdentityKey,
} = require("../../src/runtime/source-policy-registry-runtime");

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
    preferred_win_count: 0,
    specialist_trade_win_count: 0,
    derivative_winner_count: 0,
    platform_identity_ambiguity_count: 0,
    broad_rescue_count: 0,
    preferred_missing_winner_count: 0,
    preferred_weaker_winner_count: 0,
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
    source_identity_key: String(item?.source_identity_key || "").trim() || null,
    source_identity_scope: String(item?.source_identity_scope || "").trim() || null,
    source_identity_label: String(item?.source_identity_label || "").trim() || null,
    source_identity_ambiguous: item?.source_identity_ambiguous === true,
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
    preferred_win_count: entry.preferred_win_count,
    specialist_trade_win_count: entry.specialist_trade_win_count,
    derivative_winner_count: entry.derivative_winner_count,
    platform_identity_ambiguity_count: entry.platform_identity_ambiguity_count,
    broad_rescue_count: entry.broad_rescue_count,
    preferred_missing_winner_count: entry.preferred_missing_winner_count,
    preferred_weaker_winner_count: entry.preferred_weaker_winner_count,
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
      if (item?.won_by_preferred_substitute === true) entry.preferred_win_count += 1;
      if (item?.specialist_trade_outperformed_preferred === true) entry.specialist_trade_win_count += 1;
      if (item?.source_identity_ambiguous === true) entry.platform_identity_ambiguity_count += 1;
      if (item?.broader_retrieval_found_better === true) entry.broad_rescue_count += 1;
      if (String(item?.coverage_gap_status || "").trim() === "preferred_missing") entry.preferred_missing_winner_count += 1;
      if (String(item?.coverage_gap_status || "").trim() === "preferred_weaker") entry.preferred_weaker_winner_count += 1;
      const winnerSelectionReason = String(item?.winner_selection_reason || "").trim();
      const selectionReasonCodes = Array.isArray(item?.selection_reason_codes) ? item.selection_reason_codes : [];
      if (winnerSelectionReason === "best_available_derivative" || selectionReasonCodes.includes("best_available_derivative")) {
        entry.derivative_winner_count += 1;
      }
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

function createTopicCoverageEntry(topic) {
  return {
    topic,
    preferred_missing_count: 0,
    preferred_weaker_count: 0,
    broad_rescue_count: 0,
    domains: new Map(),
    last_seen_at: null,
  };
}

function finalizeTopicCoverageEntry(entry) {
  const exampleDomains = Array.from(entry.domains.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));
  return {
    topic: entry.topic,
    preferred_missing_count: entry.preferred_missing_count,
    preferred_weaker_count: entry.preferred_weaker_count,
    broad_rescue_count: entry.broad_rescue_count,
    example_domains: exampleDomains,
    last_seen_at: entry.last_seen_at,
  };
}

function buildTopicCoverageQueues(rows = []) {
  const topics = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const seenAt = String(row?.run_at_utc || row?.sent_at_utc || "").trim();
    for (const item of (Array.isArray(row?.sent_items) ? row.sent_items : [])) {
      const topic = String(item?.tag || "").trim();
      if (!topic) continue;
      const coverageGapStatus = String(item?.coverage_gap_status || "").trim();
      const broadRescue = item?.broader_retrieval_found_better === true;
      if (coverageGapStatus !== "preferred_missing" && coverageGapStatus !== "preferred_weaker" && !broadRescue) continue;
      if (!topics.has(topic)) topics.set(topic, createTopicCoverageEntry(topic));
      const entry = topics.get(topic);
      if (coverageGapStatus === "preferred_missing") entry.preferred_missing_count += 1;
      if (coverageGapStatus === "preferred_weaker") entry.preferred_weaker_count += 1;
      if (broadRescue) entry.broad_rescue_count += 1;
      const domain = normalizeSourceDomain(item?.source_domain);
      if (domain) entry.domains.set(domain, (entry.domains.get(domain) || 0) + 1);
      if (seenAt && (!entry.last_seen_at || seenAt > entry.last_seen_at)) entry.last_seen_at = seenAt;
    }
  }
  return Array.from(topics.values())
    .map(finalizeTopicCoverageEntry)
    .sort((left, right) => {
      const rightScore = Number(right.preferred_missing_count || 0) * 3
        + Number(right.preferred_weaker_count || 0) * 2
        + Number(right.broad_rescue_count || 0);
      const leftScore = Number(left.preferred_missing_count || 0) * 3
        + Number(left.preferred_weaker_count || 0) * 2
        + Number(left.broad_rescue_count || 0);
      return rightScore - leftScore
        || String(right.last_seen_at || "").localeCompare(String(left.last_seen_at || ""))
        || String(left.topic || "").localeCompare(String(right.topic || ""));
    });
}

function buildCurationQueues(metricsMap, rows = [], limit = 8) {
  const metrics = Array.from(metricsMap.values());
  const specialistCandidates = metrics
    .filter((metric) => Number(metric.specialist_trade_win_count || 0) > 0)
    .map((metric) => {
      const effectivePolicy = explainSourcePolicy(metric.domain);
      return {
        domain: metric.domain,
        specialist_trade_win_count: Number(metric.specialist_trade_win_count || 0),
        broad_rescue_count: Number(metric.broad_rescue_count || 0),
        tracked_sends: Number(metric.send_count || 0),
        top_tags: metric.top_tags || [],
        effective_policy: effectivePolicy,
        reason: "Repeatedly surfaced as a specialist best-fit winner over broader preferred coverage.",
      };
    })
    .sort((left, right) => Number(right.specialist_trade_win_count || 0) - Number(left.specialist_trade_win_count || 0)
      || Number(right.broad_rescue_count || 0) - Number(left.broad_rescue_count || 0)
      || Number(right.tracked_sends || 0) - Number(left.tracked_sends || 0)
      || String(left.domain || "").localeCompare(String(right.domain || "")))
    .slice(0, limit);

  const derivativeWinners = metrics
    .filter((metric) => Number(metric.derivative_winner_count || 0) > 0)
    .map((metric) => ({
      domain: metric.domain,
      derivative_winner_count: Number(metric.derivative_winner_count || 0),
      tracked_sends: Number(metric.send_count || 0),
      top_tags: metric.top_tags || [],
      effective_policy: explainSourcePolicy(metric.domain),
      reason: "Won as the best available derivative-style representation; good candidate for tighter review or better-source expansion.",
    }))
    .sort((left, right) => Number(right.derivative_winner_count || 0) - Number(left.derivative_winner_count || 0)
      || Number(right.tracked_sends || 0) - Number(left.tracked_sends || 0)
      || String(left.domain || "").localeCompare(String(right.domain || "")))
    .slice(0, limit);

  const platformAmbiguity = metrics
    .filter((metric) => Number(metric.platform_identity_ambiguity_count || 0) > 0)
    .map((metric) => ({
      domain: metric.domain,
      platform_identity_ambiguity_count: Number(metric.platform_identity_ambiguity_count || 0),
      tracked_sends: Number(metric.send_count || 0),
      top_tags: metric.top_tags || [],
      effective_policy: explainSourcePolicy(metric.domain),
      reason: "Platform-domain ambiguity still influenced selected items; identity-level review would improve precision.",
    }))
    .sort((left, right) => Number(right.platform_identity_ambiguity_count || 0) - Number(left.platform_identity_ambiguity_count || 0)
      || Number(right.tracked_sends || 0) - Number(left.tracked_sends || 0)
      || String(left.domain || "").localeCompare(String(right.domain || "")))
    .slice(0, limit);

  const topicCoverageGaps = buildTopicCoverageQueues(rows).slice(0, limit);

  return {
    specialist_candidates: specialistCandidates,
    derivative_winners: derivativeWinners,
    platform_ambiguity: platformAmbiguity,
    topic_coverage_gaps: topicCoverageGaps,
  };
}

function buildSourceAuditEntries({ readJsonLineLog, adminActionLog, domain, identityKey, limit = 20 }) {
  if (typeof readJsonLineLog !== "function") return [];
  const normalized = normalizeSourceDomain(domain);
  const normalizedIdentityKey = normalizeSourceIdentityKey(identityKey);
  if (!normalized && !normalizedIdentityKey) return [];
  return readJsonLineLog(adminActionLog, limit * 8)
    .filter((row) => {
      const action = String(row?.action || "").trim();
      if (action !== "source_policy_upsert" && action !== "source_policy_reset") return false;
      if (normalizedIdentityKey) {
        return normalizeSourceIdentityKey(row?.details?.identity_key) === normalizedIdentityKey;
      }
      return normalizeSourceDomain(row?.details?.domain) === normalized
        && !normalizeSourceIdentityKey(row?.details?.identity_key);
    })
    .map((row) => ({
      at: String(row?.at || "").trim() || null,
      actor: String(row?.actor || "").trim() || "unknown",
      action: String(row?.action || "").trim() || "source_policy",
      success: row?.success !== false,
      scope: normalizeSourceIdentityKey(row?.details?.identity_key) ? "identity" : "domain",
      domain: normalizeSourceDomain(row?.details?.domain) || null,
      identity_key: normalizeSourceIdentityKey(row?.details?.identity_key) || null,
      note: String(row?.details?.note || "").trim() || "",
      before: row?.details?.before || null,
      after: row?.details?.after || null,
    }))
    .sort((left, right) => String(right?.at || "").localeCompare(String(left?.at || "")))
    .slice(0, limit);
}

function createEmptyMetricSummary(key) {
  return {
    domain: key,
    send_count: 0,
    weak_source_item_count: 0,
    poor_digest_item_count: 0,
    preferred_win_count: 0,
    specialist_trade_win_count: 0,
    derivative_winner_count: 0,
    platform_identity_ambiguity_count: 0,
    broad_rescue_count: 0,
    preferred_missing_winner_count: 0,
    preferred_weaker_winner_count: 0,
    user_count: 0,
    digest_count: 0,
    avg_sent_authority: null,
    top_tags: [],
    recent_users: [],
    sample_items: [],
    last_seen_at: null,
  };
}

function buildIdentityRecentMetrics(rows = [], domain, identityKey) {
  const normalizedDomain = normalizeSourceDomain(domain) || inferSourceDomainFromIdentityKey(identityKey);
  const normalizedIdentityKey = normalizeSourceIdentityKey(identityKey);
  if (!normalizedDomain || !normalizedIdentityKey) return createEmptyMetricSummary(normalizedIdentityKey || normalizedDomain || "unknown");
  const entry = createMetricEntry(normalizedDomain);
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const digestKey = String(row?.digest_id || row?.run_id || "").trim();
    const userKey = String(row?.user_email || row?.recipient || row?.user_id || "").trim().toLowerCase();
    const items = Array.isArray(row?.sent_items) ? row.sent_items : [];
    const poorDigest = Number(row?.quality_score || 0) < 70
      || String(row?.dominant_failure_mode || "").trim().toLowerCase() === "weak_source";
    for (const item of items) {
      const itemDomain = normalizeSourceDomain(item?.source_domain) || inferSourceDomainFromIdentityKey(item?.source_identity_key);
      const itemIdentityKey = normalizeSourceIdentityKey(item?.source_identity_key);
      if (itemDomain !== normalizedDomain || itemIdentityKey !== normalizedIdentityKey) continue;
      entry.send_count += 1;
      if (userKey) entry.users.add(userKey);
      if (digestKey) entry.digests.add(digestKey);
      if (isWeakSourceItem(item)) entry.weak_source_item_count += 1;
      if (poorDigest) entry.poor_digest_item_count += 1;
      if (item?.won_by_preferred_substitute === true) entry.preferred_win_count += 1;
      if (item?.specialist_trade_outperformed_preferred === true) entry.specialist_trade_win_count += 1;
      if (item?.source_identity_ambiguous === true) entry.platform_identity_ambiguity_count += 1;
      if (item?.broader_retrieval_found_better === true) entry.broad_rescue_count += 1;
      if (String(item?.coverage_gap_status || "").trim() === "preferred_missing") entry.preferred_missing_winner_count += 1;
      if (String(item?.coverage_gap_status || "").trim() === "preferred_weaker") entry.preferred_weaker_winner_count += 1;
      const winnerSelectionReason = String(item?.winner_selection_reason || "").trim();
      const selectionReasonCodes = Array.isArray(item?.selection_reason_codes) ? item.selection_reason_codes : [];
      if (winnerSelectionReason === "best_available_derivative" || selectionReasonCodes.includes("best_available_derivative")) {
        entry.derivative_winner_count += 1;
      }
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
  const summary = finalizeMetricEntry(entry);
  return {
    ...summary,
    identity_key: normalizedIdentityKey,
  };
}

function formatIdentityLabel(identityKey) {
  const normalized = normalizeSourceIdentityKey(identityKey);
  if (!normalized) return "";
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex === -1) return normalized;
  return normalized.slice(separatorIndex + 1);
}

function buildIdentityCandidates(rows = [], domain, registryIdentities = {}) {
  const normalizedDomain = normalizeSourceDomain(domain);
  if (!normalizedDomain) return [];
  const candidates = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const seenAt = String(row?.run_at_utc || row?.sent_at_utc || "").trim() || null;
    for (const item of (Array.isArray(row?.sent_items) ? row.sent_items : [])) {
      const itemDomain = normalizeSourceDomain(item?.source_domain) || inferSourceDomainFromIdentityKey(item?.source_identity_key);
      const identityKey = normalizeSourceIdentityKey(item?.source_identity_key);
      if (itemDomain !== normalizedDomain || !identityKey || identityKey === normalizedDomain) continue;
      if (!candidates.has(identityKey)) {
        candidates.set(identityKey, {
          identity_key: identityKey,
          source_identity_scope: String(item?.source_identity_scope || "").trim() || "identity",
          source_identity_label: String(item?.source_identity_label || "").trim() || formatIdentityLabel(identityKey),
          source_identity_ambiguous: item?.source_identity_ambiguous === true,
          send_count: 0,
          tags: new Map(),
          last_seen_at: null,
        });
      }
      const entry = candidates.get(identityKey);
      entry.send_count += 1;
      entry.source_identity_ambiguous = entry.source_identity_ambiguous || item?.source_identity_ambiguous === true;
      const tag = String(item?.tag || "").trim();
      if (tag) entry.tags.set(tag, (entry.tags.get(tag) || 0) + 1);
      if (seenAt && (!entry.last_seen_at || seenAt > entry.last_seen_at)) entry.last_seen_at = seenAt;
    }
  }
  for (const identityKey of Object.keys(registryIdentities && typeof registryIdentities === "object" ? registryIdentities : {})) {
    if (inferSourceDomainFromIdentityKey(identityKey) !== normalizedDomain) continue;
    if (!candidates.has(identityKey)) {
      candidates.set(identityKey, {
        identity_key: identityKey,
        source_identity_scope: "identity",
        source_identity_label: formatIdentityLabel(identityKey),
        source_identity_ambiguous: false,
        send_count: 0,
        tags: new Map(),
        last_seen_at: null,
      });
    }
  }
  return Array.from(candidates.values())
    .map((entry) => ({
      identity_key: entry.identity_key,
      source_identity_scope: entry.source_identity_scope,
      source_identity_label: entry.source_identity_label,
      source_identity_ambiguous: entry.source_identity_ambiguous,
      send_count: entry.send_count,
      top_tags: Array.from(entry.tags.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
      last_seen_at: entry.last_seen_at,
      direct_override: registryIdentities?.[entry.identity_key] || null,
      effective_policy: explainSourcePolicy(normalizedDomain, null, { sourceIdentityKey: entry.identity_key }),
    }))
    .sort((left, right) => Number(right.send_count || 0) - Number(left.send_count || 0)
      || String(right.last_seen_at || "").localeCompare(String(left.last_seen_at || ""))
      || String(left.identity_key || "").localeCompare(String(right.identity_key || "")));
}

module.exports = {
  matchesQuery,
  refreshEffectiveRegistry,
  buildRecentDomainMetrics,
  buildCurationQueues,
  buildSourceAuditEntries,
  createEmptyMetricSummary,
  buildIdentityRecentMetrics,
  buildIdentityCandidates,
};
