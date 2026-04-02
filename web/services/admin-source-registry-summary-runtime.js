"use strict";

const { explainSourcePolicy } = require("../../src/digest/domain/storyline-domain-runtime");
const { normalizeTopicToken } = require("../../src/runtime/topic-normalization-runtime");
const { matchesQuery } = require("./admin-source-registry-metrics-runtime");

function summarizePreferredSourceCompatibilityView(inspectStandardTopicBrokerConfig) {
  const snapshot = typeof inspectStandardTopicBrokerConfig === "function"
    ? inspectStandardTopicBrokerConfig()
    : null;
  const config = snapshot?.config;
  if (!config || typeof config !== "object") {
    return {
      path: null,
      runtime_path: null,
      bundled_path: null,
      source_mode: "empty compatibility view",
      used_fallback: false,
      version: 1,
      global: {
        reported: [],
        official: [],
      },
      topic_count: 0,
      total_unique_domains: 0,
      topics: [],
      standard_topic_source: null,
      raw_json: JSON.stringify({}, null, 2),
    };
  }

  const topics = Object.entries(config.topics && typeof config.topics === "object" ? config.topics : {})
    .map(([topicTag]) => {
      const topicSources = (Array.isArray(config.sources) ? config.sources : [])
        .filter((source) => Array.isArray(source?.topic_tags) && source.topic_tags.includes(topicTag))
        .filter((source) => source?.enabled !== false);
      const reported = Array.from(new Set(topicSources
        .filter((source) => source.lane === "publisher_feed")
        .flatMap((source) => Array.isArray(source?.domains) ? source.domains : [])));
      const official = Array.from(new Set(topicSources
        .filter((source) => source.lane === "official")
        .flatMap((source) => Array.isArray(source?.domains) ? source.domains : [])));
      return {
        topic: normalizeTopicToken(topicTag),
        reported,
        official,
        reported_count: reported.length,
        official_count: official.length,
      };
    })
    .filter((entry) => entry.reported_count > 0 || entry.official_count > 0)
    .sort((left, right) => left.topic.localeCompare(right.topic));

  const uniqueDomains = new Set(topics.flatMap((entry) => [...entry.reported, ...entry.official]));
  const sourceMode = String(snapshot?.source_mode || "runtime").trim() || "runtime";
  const standardTopicSource = {
    source_of_truth: "standard_topic_broker",
    source_mode: sourceMode,
    active_path: String(snapshot?.active_path || "").trim() || null,
    runtime_path: String(snapshot?.runtime_path || "").trim() || null,
    bundled_path: String(snapshot?.bundled_path || "").trim() || null,
    topic_count: topics.length,
    topic_keys: topics.map((entry) => entry.topic),
  };
  return {
    path: standardTopicSource.active_path,
    runtime_path: standardTopicSource.runtime_path,
    bundled_path: standardTopicSource.bundled_path,
    source_mode: sourceMode === "bundled" ? "broker_bundled" : "broker_runtime",
    used_fallback: sourceMode === "bundled",
    version: 1,
    global: {
      reported: [],
      official: [],
    },
    topic_count: topics.length,
    total_unique_domains: uniqueDomains.size,
    topics,
    standard_topic_source: standardTopicSource,
    raw_json: JSON.stringify({
      version: 1,
      standard_topic_source: standardTopicSource,
      topics: Object.fromEntries(topics.map((entry) => [entry.topic, {
        reported: entry.reported,
        official: entry.official,
      }])),
    }, null, 2),
  };
}

function summarizeBrokerConfig(inspectStandardTopicBrokerConfig) {
  const snapshot = typeof inspectStandardTopicBrokerConfig === "function"
    ? inspectStandardTopicBrokerConfig()
    : null;
  const config = snapshot?.config;
  if (!config || typeof config !== "object") return null;

  const sources = (Array.isArray(config.sources) ? config.sources : [])
    .map((source) => ({
      id: String(source?.id || "").trim(),
      enabled: source?.enabled !== false,
      tier: Number(source?.tier || 2),
      lane: String(source?.lane || "").trim(),
      topic_tags: Array.isArray(source?.topic_tags) ? source.topic_tags.slice() : [],
      topic_keys: (Array.isArray(source?.topic_tags) ? source.topic_tags : []).map((tag) => normalizeTopicToken(tag)),
      domains: Array.isArray(source?.domains) ? source.domains.slice() : [],
      source_kind: String(source?.source_kind || "").trim(),
      source_family: String(source?.source_family || "").trim(),
      endpoint: String(source?.endpoint || "").trim(),
    }))
    .filter((source) => source.id)
    .sort((left, right) => {
      const leftTopic = String(left.topic_tags[0] || "");
      const rightTopic = String(right.topic_tags[0] || "");
      return leftTopic.localeCompare(rightTopic)
        || String(left.lane || "").localeCompare(String(right.lane || ""))
        || String(left.id || "").localeCompare(String(right.id || ""));
    });

  const topics = Object.entries(config.topics && typeof config.topics === "object" ? config.topics : {})
    .map(([topicTag, entry]) => {
      const topicSources = sources.filter((source) => source.topic_tags.includes(topicTag));
      const reportedDomains = Array.from(new Set(topicSources
        .filter((source) => source.lane === "publisher_feed")
        .flatMap((source) => source.domains || [])));
      const officialDomains = Array.from(new Set(topicSources
        .filter((source) => source.lane === "official")
        .flatMap((source) => source.domains || [])));
      return {
        topic_tag: topicTag,
        topic_key: normalizeTopicToken(topicTag),
        enabled: entry?.enabled !== false,
        lanes: {
          publisher_feed: entry?.lanes?.publisher_feed !== false,
          official: entry?.lanes?.official !== false,
        },
        source_count: topicSources.length,
        enabled_source_count: topicSources.filter((source) => source.enabled !== false).length,
        publisher_feed_source_count: topicSources.filter((source) => source.lane === "publisher_feed").length,
        official_source_count: topicSources.filter((source) => source.lane === "official").length,
        reported_domains: reportedDomains,
        official_domains: officialDomains,
      };
    })
    .sort((left, right) => String(left.topic_key || "").localeCompare(String(right.topic_key || "")));

  return {
    source_of_truth: "standard_topic_broker",
    source_mode: String(snapshot?.source_mode || "runtime").trim() || "runtime",
    active_path: String(snapshot?.active_path || "").trim() || null,
    runtime_path: String(snapshot?.runtime_path || "").trim() || null,
    bundled_path: String(snapshot?.bundled_path || "").trim() || null,
    topic_count: topics.length,
    source_count: sources.length,
    enabled_source_count: sources.filter((source) => source.enabled !== false).length,
    topics,
    sources,
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

module.exports = {
  summarizePreferredSourceCompatibilityView,
  summarizeBrokerConfig,
  buildOverviewRows,
};
