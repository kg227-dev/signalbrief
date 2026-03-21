"use strict";

const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");
const {
  normalizeTopicToken,
  topicsRelated,
} = require("../digest/domain/topic-domain-runtime");

const DEFAULT_PREFERRED_SOURCES_VERSION = 1;
const OFFICIAL_FRIENDLY_TOPIC_KEYS = Object.freeze([
  "policy regulatory",
  "public sector",
  "financial services",
  "healthcare",
  "life sciences",
  "energy",
  "sustainability",
]);
const OFFICIAL_QUERY_HINT_PATTERN = /\b(rule|rules|rulemaking|filing|filings|approval|approves?|approved|agency|register|proposed|guidance|enforcement|regulation|regulatory|directive|law|laws|compliance)\b/i;

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function matchesPreferredDomain(sourceDomain, candidateDomain) {
  const normalizedSource = normalizeSourcePolicyDomain(sourceDomain);
  const normalizedCandidate = normalizeSourcePolicyDomain(candidateDomain);
  if (!normalizedSource || !normalizedCandidate) return false;
  return normalizedSource === normalizedCandidate || normalizedSource.endsWith(`.${normalizedCandidate}`);
}

function sanitizeDomainList(rawValue) {
  const out = [];
  const seen = new Set();
  for (const value of (Array.isArray(rawValue) ? rawValue : [])) {
    const normalized = normalizeSourcePolicyDomain(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sanitizePreferredAliases(rawAliases) {
  const aliases = rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases) ? rawAliases : {};
  const normalized = {};
  for (const [rawAlias, rawTarget] of Object.entries(aliases)) {
    const aliasKey = normalizeTopicToken(rawAlias);
    const targetKey = normalizeTopicToken(rawTarget);
    if (!aliasKey || !targetKey) continue;
    normalized[aliasKey] = targetKey;
  }
  return normalized;
}

function normalizePreferredPublisherKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (!raw.includes(":")) return "";
  const [platform, ...rest] = raw.split(":");
  const normalizedPlatform = normalizeTopicToken(platform).replace(/\s+/g, "");
  const normalizedRest = rest.join(":").trim().toLowerCase();
  if (!normalizedPlatform || !normalizedRest) return "";
  return `${normalizedPlatform}:${normalizedRest}`;
}

function sanitizePublisherList(rawValue) {
  const out = [];
  const seen = new Set();
  for (const value of (Array.isArray(rawValue) ? rawValue : [])) {
    const normalized = normalizePreferredPublisherKey(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizePreferredTopicKey(rawTopic, aliases = {}) {
  const normalized = normalizeTopicToken(rawTopic);
  if (!normalized) return "";
  return aliases[normalized] || normalized;
}

function sanitizeTopicEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
  return {
    reported: sanitizeDomainList(entry.reported),
    official: sanitizeDomainList(entry.official),
  };
}

function sanitizePublisherTopicEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
  return {
    reported: sanitizePublisherList(entry.reported),
    official: sanitizePublisherList(entry.official),
  };
}

function mergeTopicEntries(left = {}, right = {}) {
  return {
    reported: uniqueStrings([...(left.reported || []), ...(right.reported || [])]),
    official: uniqueStrings([...(left.official || []), ...(right.official || [])]),
  };
}

function mergePublisherTopicEntries(left = {}, right = {}) {
  return {
    reported: uniqueStrings([...(left.reported || []), ...(right.reported || [])]),
    official: uniqueStrings([...(left.official || []), ...(right.official || [])]),
  };
}

function sanitizePreferredSourceRegistry(rawRegistry) {
  const registry = rawRegistry && typeof rawRegistry === "object" ? rawRegistry : {};
  const aliases = sanitizePreferredAliases(registry.aliases);
  const topicsRaw = registry.topics && typeof registry.topics === "object" && !Array.isArray(registry.topics)
    ? registry.topics
    : {};
  const publishersRaw = registry.publishers && typeof registry.publishers === "object" && !Array.isArray(registry.publishers)
    ? registry.publishers
    : {};
  const publisherTopicsRaw = publishersRaw.topics && typeof publishersRaw.topics === "object" && !Array.isArray(publishersRaw.topics)
    ? publishersRaw.topics
    : {};
  const topics = {};
  const publishers = {
    global: {
      reported: sanitizePublisherList(publishersRaw?.global?.reported),
      official: sanitizePublisherList(publishersRaw?.global?.official),
    },
    topics: {},
  };

  for (const [rawTopicKey, rawEntry] of Object.entries(topicsRaw)) {
    const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
    if (!topicKey) continue;
    const sanitizedEntry = sanitizeTopicEntry(rawEntry);
    if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
    topics[topicKey] = mergeTopicEntries(topics[topicKey], sanitizedEntry);
  }

  for (const [rawTopicKey, rawEntry] of Object.entries(publisherTopicsRaw)) {
    const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
    if (!topicKey) continue;
    const sanitizedEntry = sanitizePublisherTopicEntry(rawEntry);
    if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
    publishers.topics[topicKey] = mergePublisherTopicEntries(publishers.topics[topicKey], sanitizedEntry);
  }

  return {
    version: DEFAULT_PREFERRED_SOURCES_VERSION,
    global: {
      reported: sanitizeDomainList(registry?.global?.reported),
      official: sanitizeDomainList(registry?.global?.official),
    },
    topics,
    publishers,
    aliases,
  };
}

function resolveRelevantTopicKeys(registry, topicTag, dueUserTopics = []) {
  const aliases = registry?.aliases || {};
  const primaryTopic = normalizePreferredTopicKey(topicTag, aliases);
  const availableTopics = registry?.topics && typeof registry.topics === "object" ? Object.keys(registry.topics) : [];
  const out = [];
  const seen = new Set();

  function addTopic(rawTopic, { allowRelatedToPrimary = false } = {}) {
    const topicKey = normalizePreferredTopicKey(rawTopic, aliases);
    if (!topicKey || seen.has(topicKey)) return;
    if (!availableTopics.includes(topicKey)) return;
    if (allowRelatedToPrimary && primaryTopic && topicKey !== primaryTopic && !topicsRelated(primaryTopic, topicKey)) {
      return;
    }
    seen.add(topicKey);
    out.push(topicKey);
  }

  addTopic(primaryTopic);
  const dueTopics = uniqueStrings(
    (Array.isArray(dueUserTopics) ? dueUserTopics : [])
      .map((topic) => String(topic || ""))
      .filter((topic) => !topic.toLowerCase().startsWith("custom_"))
  );
  if (primaryTopic) {
    for (const topic of dueTopics) addTopic(topic, { allowRelatedToPrimary: true });
  } else {
    for (const topic of dueTopics) addTopic(topic);
  }

  return out;
}

function isOfficialFriendlyPreferredTopic(topicKey) {
  return OFFICIAL_FRIENDLY_TOPIC_KEYS.includes(normalizeTopicToken(topicKey));
}

function queryLooksOfficial(queryText) {
  return OFFICIAL_QUERY_HINT_PATTERN.test(String(queryText || ""));
}

function matchesPreferredPublisher(sourceIdentityKey, candidateIdentityKey) {
  const source = normalizePreferredPublisherKey(sourceIdentityKey);
  const candidate = normalizePreferredPublisherKey(candidateIdentityKey);
  if (!source || !candidate) return false;
  return source === candidate;
}

function buildPreferredDomainShortlist(registryRaw, options = {}) {
  const registry = sanitizePreferredSourceRegistry(registryRaw);
  const maxDomains = Math.max(1, Number(options.maxDomains || 20));
  const relevantTopics = resolveRelevantTopicKeys(registry, options.topicTag, options.dueUserTopics);
  const officialFriendly = relevantTopics.some((topicKey) => isOfficialFriendlyPreferredTopic(topicKey))
    || queryLooksOfficial(options.queryText);
  const domains = [];
  const seen = new Set();
  const pushDomains = (list) => {
    for (const domain of (Array.isArray(list) ? list : [])) {
      const normalized = normalizeSourcePolicyDomain(domain);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      domains.push(normalized);
      if (domains.length >= maxDomains) return true;
    }
    return false;
  };
  const topicLists = relevantTopics.map((topicKey) => ({
    topicKey,
    reported: registry?.topics?.[topicKey]?.reported || [],
    official: registry?.topics?.[topicKey]?.official || [],
  }));

  if (officialFriendly) {
    for (const entry of topicLists) {
      if (pushDomains(entry.official)) break;
    }
    if (domains.length < maxDomains) pushDomains(registry?.global?.official || []);
    if (domains.length < maxDomains) {
      for (const entry of topicLists) {
        if (pushDomains(entry.reported)) break;
      }
    }
    if (domains.length < maxDomains) pushDomains(registry?.global?.reported || []);
  } else {
    for (const entry of topicLists) {
      if (pushDomains(entry.reported)) break;
    }
    if (domains.length < maxDomains) pushDomains(registry?.global?.reported || []);
    if (domains.length < maxDomains) {
      for (const entry of topicLists) {
        if (pushDomains(entry.official)) break;
      }
    }
    if (domains.length < maxDomains) pushDomains(registry?.global?.official || []);
  }

  return {
    domains,
    topic_keys: relevantTopics,
    official_friendly: officialFriendly,
  };
}

function matchPreferredSourceDomain(registryRaw, sourceDomain, topicTag, options = {}) {
  const registry = sanitizePreferredSourceRegistry(registryRaw);
  const normalizedSource = normalizeSourcePolicyDomain(sourceDomain);
  const normalizedIdentity = normalizePreferredPublisherKey(options?.sourceIdentityKey);
  if (!normalizedSource) {
    return {
      match: "none",
      kind: null,
      scope: "none",
      topics: [],
      strength: 0,
      matched_domain: null,
      matched_identity: null,
    };
  }

  const aliases = registry.aliases || {};
  const normalizedTopic = normalizePreferredTopicKey(topicTag, aliases);
  let bestMatch = null;

  function considerMatch(entry) {
    if (!entry || !entry.matched_domain) return;
    if (!bestMatch || entry.weight > bestMatch.weight || (entry.weight === bestMatch.weight && entry.matched_domain.length > bestMatch.matched_domain.length)) {
      bestMatch = entry;
    }
  }

  function considerIdentityMatch(entry) {
    if (!entry || !entry.matched_identity) return;
    if (!bestMatch || entry.weight > bestMatch.weight) {
      bestMatch = entry;
    }
  }

  for (const [topicKey, publisherEntry] of Object.entries(registry?.publishers?.topics || {})) {
    if (!normalizedIdentity) break;
    if (!normalizedTopic || (!topicsRelated(normalizedTopic, topicKey) && normalizedTopic !== topicKey)) continue;
    const isExact = normalizedTopic === topicKey;
    for (const identityKey of (publisherEntry.official || [])) {
      if (!matchesPreferredPublisher(normalizedIdentity, identityKey)) continue;
      considerIdentityMatch({
        match: "topic_official",
        kind: "official",
        scope: "publisher",
        topics: [topicKey],
        strength: isExact ? 0.9 : 0.8,
        matched_domain: normalizedSource,
        matched_identity: identityKey,
        weight: isExact ? 92 : 82,
      });
    }
    for (const identityKey of (publisherEntry.reported || [])) {
      if (!matchesPreferredPublisher(normalizedIdentity, identityKey)) continue;
      considerIdentityMatch({
        match: "topic_reported",
        kind: "reported",
        scope: "publisher",
        topics: [topicKey],
        strength: isExact ? 0.8 : 0.7,
        matched_domain: normalizedSource,
        matched_identity: identityKey,
        weight: isExact ? 82 : 72,
      });
    }
  }

  if (normalizedIdentity) {
    for (const identityKey of (registry?.publishers?.global?.official || [])) {
      if (!matchesPreferredPublisher(normalizedIdentity, identityKey)) continue;
      considerIdentityMatch({
        match: "global_official",
        kind: "official",
        scope: "publisher",
        topics: [],
        strength: 0.56,
        matched_domain: normalizedSource,
        matched_identity: identityKey,
        weight: 58,
      });
    }
    for (const identityKey of (registry?.publishers?.global?.reported || [])) {
      if (!matchesPreferredPublisher(normalizedIdentity, identityKey)) continue;
      considerIdentityMatch({
        match: "global_reported",
        kind: "reported",
        scope: "publisher",
        topics: [],
        strength: 0.42,
        matched_domain: normalizedSource,
        matched_identity: identityKey,
        weight: 44,
      });
    }
  }

  for (const [topicKey, topicEntry] of Object.entries(registry.topics || {})) {
    if (!normalizedTopic || (!topicsRelated(normalizedTopic, topicKey) && normalizedTopic !== topicKey)) continue;
    const isExact = normalizedTopic === topicKey;
    for (const domain of (topicEntry.official || [])) {
      if (!matchesPreferredDomain(normalizedSource, domain)) continue;
      considerMatch({
        match: "topic_official",
        kind: "official",
        scope: "domain",
        topics: [topicKey],
        strength: isExact ? 0.86 : 0.76,
        matched_domain: domain,
        matched_identity: null,
        weight: isExact ? 86 : 76,
      });
    }
    for (const domain of (topicEntry.reported || [])) {
      if (!matchesPreferredDomain(normalizedSource, domain)) continue;
      considerMatch({
        match: "topic_reported",
        kind: "reported",
        scope: "domain",
        topics: [topicKey],
        strength: isExact ? 0.74 : 0.64,
        matched_domain: domain,
        matched_identity: null,
        weight: isExact ? 74 : 64,
      });
    }
  }

  for (const domain of (registry?.global?.official || [])) {
    if (!matchesPreferredDomain(normalizedSource, domain)) continue;
    considerMatch({
      match: "global_official",
      kind: "official",
      scope: "domain",
      topics: [],
      strength: 0.52,
      matched_domain: domain,
      matched_identity: null,
      weight: 52,
    });
  }
  for (const domain of (registry?.global?.reported || [])) {
    if (!matchesPreferredDomain(normalizedSource, domain)) continue;
    considerMatch({
      match: "global_reported",
      kind: "reported",
      scope: "domain",
      topics: [],
      strength: 0.38,
      matched_domain: domain,
      matched_identity: null,
      weight: 38,
    });
  }

  return bestMatch || {
    match: "none",
    kind: null,
    scope: "none",
    topics: [],
    strength: 0,
    matched_domain: null,
    matched_identity: null,
  };
}

function createPreferredSourceRegistryRuntime(options = {}) {
  const fs = options.fs || require("fs");
  const preferredSourcesPath = String(options.preferredSourcesPath || "").trim() || resolveSignalBriefRuntimePaths({
    appRoot: options.appRoot,
    env: options.env,
    nodeEnv: options.nodeEnv,
  }).preferredSourcesPath;

  function loadPreferredSourceRegistry() {
    try {
      const raw = fs.readFileSync(preferredSourcesPath, "utf8");
      return sanitizePreferredSourceRegistry(JSON.parse(raw));
    } catch {
      return sanitizePreferredSourceRegistry({});
    }
  }

  return {
    preferredSourcesPath,
    loadPreferredSourceRegistry,
  };
}

module.exports = {
  DEFAULT_PREFERRED_SOURCES_VERSION,
  OFFICIAL_FRIENDLY_TOPIC_KEYS,
  buildPreferredDomainShortlist,
  createPreferredSourceRegistryRuntime,
  isOfficialFriendlyPreferredTopic,
  matchPreferredSourceDomain,
  normalizePreferredTopicKey,
  normalizePreferredPublisherKey,
  queryLooksOfficial,
  sanitizePreferredSourceRegistry,
};
