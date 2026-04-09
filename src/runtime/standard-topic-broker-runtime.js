"use strict";

const path = require("path");

const { MVP_TOPIC_TAGS, isMvpTopic } = require("../platform/config/mvp-topics");
const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");
const { normalizeTopicToken, topicsRelated, canonicalizeMvpTopicTag } = require("./topic-normalization-runtime");
const {
  buildInitialDiagnostics: buildBrokerInitialDiagnostics,
  buildNormalizedItemsForSource: buildBrokerNormalizedItemsForSource,
  defaultFetchEndpoint: brokerDefaultFetchEndpoint,
  mergeTopicDiagnostics: mergeBrokerTopicDiagnostics,
  parseSourceBody: brokerParseSourceBody,
  pickFirstDomain: brokerPickFirstDomain,
  sanitizePatternList: brokerSanitizePatternList,
} = require("./standard-topic-broker-fetch-runtime");
const {
  assignCanonicalTopic,
  chooseBestFitTopicTag,
  normalizeTopicTag,
  scoreBestFitTopicTag,
} = require("./standard-topic-broker-topic-fit-runtime");

const ALLOWED_LANES = new Set(["perplexity_discovery", "publisher_feed", "official"]);
const ALLOWED_SOURCE_KINDS = new Set(["reported_media", "trade_specialist", "primary_official"]);
const ALLOWED_CONTENT_KINDS = new Set(["article", "official_document", "filing"]);
const ALLOWED_PARSERS = new Set(["rss", "atom", "rss_or_atom", "federal_register_api", "html_date_index"]);
const BROKER_OFFICIAL_QUERY_HINT_PATTERN = /\b(rule|rules|rulemaking|filing|filings|approval|approves?|approved|agency|register|proposed|guidance|enforcement|regulation|regulatory|directive|law|laws|compliance)\b/i;
const OFFICIAL_FRIENDLY_TOPIC_TAGS = new Set([
  "LIFE SCIENCES",
  "FINANCIAL SERVICES",
  "ENERGY",
]);

function readJson(fs, filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildBundledConfigPath(options = {}) {
  const appRoot = options.appRoot
    ? path.resolve(String(options.appRoot))
    : path.resolve(__dirname, "..", "..");
  return path.resolve(appRoot, "config", "standard-topic-broker-sources.json");
}

function buildRuntimeConfigPath(options = {}) {
  if (options.standardTopicBrokerSourcesPath) {
    return path.resolve(String(options.standardTopicBrokerSourcesPath));
  }
  return resolveSignalBriefRuntimePaths({
    appRoot: options.appRoot,
    env: options.env,
    nodeEnv: options.nodeEnv,
  }).standardTopicBrokerSourcesPath;
}

function brokerQueryLooksOfficial(queryText) {
  return BROKER_OFFICIAL_QUERY_HINT_PATTERN.test(String(queryText || ""));
}

function sanitizeLaneMap(rawLanes = {}) {
  const out = {};
  for (const lane of ALLOWED_LANES) {
    const entry = rawLanes && typeof rawLanes === "object" ? rawLanes[lane] : null;
    out[lane] = {
      enabled: entry == null || entry.enabled !== false,
    };
  }
  return out;
}

function sanitizeTopicMap(rawTopics = {}) {
  const out = {};
  for (const [rawTag, rawConfig] of Object.entries(rawTopics && typeof rawTopics === "object" ? rawTopics : {})) {
    const tag = normalizeTopicTag(rawTag);
    if (!isMvpTopic(tag)) continue;
    const cfg = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const lanes = cfg.lanes && typeof cfg.lanes === "object" ? cfg.lanes : {};
    out[tag] = {
      enabled: cfg.enabled !== false,
      lanes: {
        publisher_feed: lanes.publisher_feed !== false,
        official: lanes.official !== false,
      },
    };
  }
  return out;
}

function sanitizeFamilies(rawFamilies = {}) {
  const out = {};
  for (const [rawId, rawFamily] of Object.entries(rawFamilies && typeof rawFamilies === "object" ? rawFamilies : {})) {
    const id = String(rawId || "").trim();
    const family = rawFamily && typeof rawFamily === "object" ? rawFamily : {};
    const lane = String(family.lane || "").trim();
    const sourceFamily = String(family.source_family || "").trim().toLowerCase();
    if (!id || !ALLOWED_LANES.has(lane) || !sourceFamily) continue;
    out[id] = {
      lane,
      source_family: sourceFamily,
    };
  }
  return out;
}

function sanitizeSource(source) {
  const entry = source && typeof source === "object" ? source : {};
  const id = String(entry.id || "").trim();
  const lane = String(entry.lane || "").trim();
  const family = String(entry.family || "").trim();
  const sourceKind = String(entry.source_kind || "").trim().toLowerCase();
  const parser = String(entry.parser || "").trim().toLowerCase();
  const contentKind = String(entry.content_kind || "").trim().toLowerCase();
  const endpoint = String(entry.endpoint || "").trim();
  const topicTags = Array.from(new Set((Array.isArray(entry.topic_tags) ? entry.topic_tags : [])
    .map(normalizeTopicTag)
    .filter((tag) => isMvpTopic(tag))));
  const domains = Array.from(new Set((Array.isArray(entry.domains) ? entry.domains : [])
    .map((value) => normalizeSourcePolicyDomain(value))
    .filter(Boolean)));
  if (!id || !ALLOWED_LANES.has(lane) || !ALLOWED_SOURCE_KINDS.has(sourceKind) || !ALLOWED_PARSERS.has(parser) || !ALLOWED_CONTENT_KINDS.has(contentKind) || !endpoint || topicTags.length <= 0) {
    return null;
  }
  // Tier: 1=gold (always trusted), 2=good (reliable trade/official), 3=supplemental.
  // Used by the scoring formula: source_tier weight 0.35.
  const tierRaw = Number(entry.tier);
  const tier = (tierRaw === 1 || tierRaw === 2 || tierRaw === 3) ? tierRaw : 2;

  return {
    id,
    enabled: entry.enabled !== false,
    tier,
    lane,
    topic_tags: topicTags,
    family,
    source_kind: sourceKind,
    source_family: String(entry.source_family || "").trim().toLowerCase() || "",
    domains,
    endpoint,
    parser,
    content_kind: contentKind,
    title_include_patterns: brokerSanitizePatternList(entry.title_include_patterns),
    title_exclude_patterns: brokerSanitizePatternList(entry.title_exclude_patterns),
    url_exclude_patterns: brokerSanitizePatternList(entry.url_exclude_patterns),
    allow_article_like_listing_urls: entry.allow_article_like_listing_urls === true,
  };
}

function sanitizeBrokerConfig(rawConfig = {}) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const families = sanitizeFamilies(config.families);
  const sources = (Array.isArray(config.sources) ? config.sources : [])
    .map(sanitizeSource)
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      source_family: entry.source_family || families[entry.family]?.source_family || (entry.lane === "official" ? "official" : "reported"),
    }));
  return {
    version: Number(config.version || 1) || 1,
    lanes: sanitizeLaneMap(config.lanes),
    topics: sanitizeTopicMap(config.topics),
    families,
    sources,
  };
}

function buildBrokerDomainList(config, topicTag, lane) {
  const normalizedTopicTag = normalizeTopicTag(topicTag);
  const normalizedLane = String(lane || "").trim();
  if (!isMvpTopic(normalizedTopicTag)) return [];
  if (!ALLOWED_LANES.has(normalizedLane)) return [];
  if (!topicLaneEnabled(config, normalizedTopicTag, normalizedLane)) return [];
  const domains = [];
  const seen = new Set();
  for (const source of (Array.isArray(config?.sources) ? config.sources : [])) {
    if (source?.enabled === false) continue;
    if (String(source?.lane || "").trim() !== normalizedLane) continue;
    if (!(Array.isArray(source?.topic_tags) ? source.topic_tags : []).includes(normalizedTopicTag)) continue;
    const candidates = [
      ...(Array.isArray(source?.domains) ? source.domains : []),
      brokerPickFirstDomain(source?.domains, source?.endpoint),
    ];
    for (const candidate of candidates) {
      const domain = normalizeSourcePolicyDomain(candidate);
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
    }
  }
  return domains;
}

function buildBrokerPreferredTopicEntriesFromConfig(configRaw) {
  const config = sanitizeBrokerConfig(configRaw || {});
  const topics = {};
  for (const topicTag of MVP_TOPIC_TAGS) {
    const reported = buildBrokerDomainList(config, topicTag, "publisher_feed");
    const official = buildBrokerDomainList(config, topicTag, "official");
    if (!reported.length && !official.length) continue;
    topics[normalizeTopicToken(topicTag)] = {
      reported,
      official,
    };
  }
  return topics;
}

function buildBrokerPreferredDomainShortlistFromConfig(config, options = {}) {
  const topicTag = normalizeTopicTag(options?.topicTag);
  if (!isMvpTopic(topicTag)) return null;
  const maxDomains = Math.max(1, Number(options?.maxDomains || 20));
  const officialDomains = buildBrokerDomainList(config, topicTag, "official");
  const reportedDomains = buildBrokerDomainList(config, topicTag, "publisher_feed");
  const officialFriendly = OFFICIAL_FRIENDLY_TOPIC_TAGS.has(topicTag) || brokerQueryLooksOfficial(options?.queryText);
  const domains = officialFriendly
    ? Array.from(new Set([...officialDomains, ...reportedDomains]))
    : Array.from(new Set([...reportedDomains, ...officialDomains]));
  return {
    domains: domains.slice(0, maxDomains),
    topic_keys: [normalizeTopicToken(topicTag)],
    official_friendly: officialFriendly,
    source_of_truth: "standard_topic_broker",
  };
}

function buildBrokerPreferredSourceFamilyShortlistsFromConfig(config, options = {}) {
  const topicTag = normalizeTopicTag(options?.topicTag);
  if (!isMvpTopic(topicTag)) return null;
  const maxDomains = Math.max(1, Number(options?.maxDomains || 20));
  const reportedDomains = buildBrokerDomainList(config, topicTag, "publisher_feed").slice(0, maxDomains);
  const officialDomains = buildBrokerDomainList(config, topicTag, "official").slice(0, maxDomains);
  const officialFriendly = OFFICIAL_FRIENDLY_TOPIC_TAGS.has(topicTag) || brokerQueryLooksOfficial(options?.queryText);
  const combinedDomains = officialFriendly
    ? Array.from(new Set([...officialDomains, ...reportedDomains]))
    : Array.from(new Set([...reportedDomains, ...officialDomains]));
  return {
    reported_domains: reportedDomains,
    official_domains: officialDomains,
    global_reported_domains: [],
    global_official_domains: [],
    combined_domains: combinedDomains.slice(0, maxDomains),
    topic_keys: [normalizeTopicToken(topicTag)],
    official_friendly: officialFriendly,
    source_of_truth: "standard_topic_broker",
  };
}

function matchesBrokerPreferredDomain(sourceDomain, candidateDomain) {
  const normalizedSource = normalizeSourcePolicyDomain(sourceDomain);
  const normalizedCandidate = normalizeSourcePolicyDomain(candidateDomain);
  if (!normalizedSource || !normalizedCandidate) return false;
  return normalizedSource === normalizedCandidate || normalizedSource.endsWith(`.${normalizedCandidate}`);
}

function emptyPreferredSourceMatch() {
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

function matchPreferredSourceFromBrokerConfig(configRaw, sourceDomain, topicTag, options = {}) {
  void options;
  const config = sanitizeBrokerConfig(configRaw || {});
  const normalizedSource = normalizeSourcePolicyDomain(sourceDomain);
  const normalizedTopic = normalizeTopicToken(topicTag);
  if (!normalizedSource || !normalizedTopic) return emptyPreferredSourceMatch();

  let bestMatch = null;
  function considerMatch(entry) {
    if (!entry || !entry.matched_domain) return;
    if (!bestMatch || entry.weight > bestMatch.weight || (entry.weight === bestMatch.weight && entry.matched_domain.length > bestMatch.matched_domain.length)) {
      bestMatch = entry;
    }
  }

  for (const candidateTopicTag of MVP_TOPIC_TAGS) {
    const candidateTopicKey = normalizeTopicToken(candidateTopicTag);
    if (!candidateTopicKey) continue;
    if (normalizedTopic !== candidateTopicKey && !topicsRelated(normalizedTopic, candidateTopicKey)) continue;
    const isExact = normalizedTopic === candidateTopicKey;

    for (const domain of buildBrokerDomainList(config, candidateTopicTag, "official")) {
      if (!matchesBrokerPreferredDomain(normalizedSource, domain)) continue;
      considerMatch({
        match: "topic_official",
        kind: "official",
        scope: "domain",
        topics: [candidateTopicKey],
        strength: isExact ? 0.86 : 0.76,
        matched_domain: domain,
        matched_identity: null,
        weight: isExact ? 86 : 76,
      });
    }

    for (const domain of buildBrokerDomainList(config, candidateTopicTag, "publisher_feed")) {
      if (!matchesBrokerPreferredDomain(normalizedSource, domain)) continue;
      considerMatch({
        match: "topic_reported",
        kind: "reported",
        scope: "domain",
        topics: [candidateTopicKey],
        strength: isExact ? 0.74 : 0.64,
        matched_domain: domain,
        matched_identity: null,
        weight: isExact ? 74 : 64,
      });
    }
  }

  return bestMatch ? {
    match: bestMatch.match,
    kind: bestMatch.kind,
    scope: bestMatch.scope,
    topics: bestMatch.topics,
    strength: bestMatch.strength,
    matched_domain: bestMatch.matched_domain,
    matched_identity: null,
  } : emptyPreferredSourceMatch();
}

function topicLaneEnabled(config, topicTag, lane) {
  if (config?.lanes?.[lane]?.enabled === false) return false;
  const topic = config?.topics?.[topicTag];
  if (!topic || topic.enabled === false) return false;
  if (lane === "publisher_feed" || lane === "official") {
    return topic?.lanes?.[lane] !== false;
  }
  return true;
}

function createStandardTopicBrokerRuntime(options = {}) {
  const fs = options.fs || require("fs");
  const log = typeof options.log === "function" ? options.log : () => {};
  const fetchEndpoint = typeof options.fetchEndpoint === "function" ? options.fetchEndpoint : brokerDefaultFetchEndpoint;
  const runtimeConfigPath = buildRuntimeConfigPath(options);
  const bundledConfigPath = String(options.bundledStandardTopicBrokerSourcesPath || "").trim() || buildBundledConfigPath(options);

  function readConfigSnapshot() {
    const runtimeConfig = readJson(fs, runtimeConfigPath);
    if (runtimeConfig) {
      return {
        source_mode: "runtime",
        active_path: runtimeConfigPath,
        runtime_path: runtimeConfigPath,
        bundled_path: bundledConfigPath,
        raw_config: runtimeConfig,
        config: sanitizeBrokerConfig(runtimeConfig),
      };
    }
    const bundledConfig = readJson(fs, bundledConfigPath);
    return {
      source_mode: "bundled",
      active_path: bundledConfigPath,
      runtime_path: runtimeConfigPath,
      bundled_path: bundledConfigPath,
      raw_config: bundledConfig || {},
      config: sanitizeBrokerConfig(bundledConfig || {}),
    };
  }

  function ensureRuntimeConfigDir() {
    const dir = path.dirname(runtimeConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function writeRawBrokerConfig(rawConfig) {
    ensureRuntimeConfigDir();
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");
  }

  function inspectStandardTopicBrokerConfig() {
    return readConfigSnapshot();
  }

  function loadStandardTopicBrokerConfig() {
    return readConfigSnapshot().config;
  }

  function updateBrokerTopicConfig(input = {}) {
    const topicTag = normalizeTopicTag(input?.topicTag || input?.topic);
    if (!isMvpTopic(topicTag)) {
      throw new Error("valid standard-topic broker topic required");
    }

    const snapshot = readConfigSnapshot();
    const before = snapshot?.config?.topics?.[topicTag] || {
      enabled: true,
      lanes: {
        publisher_feed: true,
        official: true,
      },
    };
    const rawConfig = snapshot?.raw_config && typeof snapshot.raw_config === "object"
      ? { ...snapshot.raw_config }
      : {};
    const rawTopics = rawConfig.topics && typeof rawConfig.topics === "object"
      ? { ...rawConfig.topics }
      : {};
    const rawTopic = rawTopics[topicTag] && typeof rawTopics[topicTag] === "object"
      ? rawTopics[topicTag]
      : {};
    const rawLanes = rawTopic.lanes && typeof rawTopic.lanes === "object"
      ? rawTopic.lanes
      : {};

    const nextEnabled = input?.enabled == null
      ? before.enabled !== false
      : input.enabled === true;
    const nextPublisherFeedEnabled = input?.publisher_feed_enabled == null
      ? before?.lanes?.publisher_feed !== false
      : input.publisher_feed_enabled === true;
    const nextOfficialEnabled = input?.official_enabled == null
      ? before?.lanes?.official !== false
      : input.official_enabled === true;

    rawTopics[topicTag] = {
      ...rawTopic,
      enabled: nextEnabled,
      lanes: {
        ...rawLanes,
        publisher_feed: nextPublisherFeedEnabled,
        official: nextOfficialEnabled,
      },
    };
    rawConfig.topics = rawTopics;

    writeRawBrokerConfig(rawConfig);
    const nextSnapshot = readConfigSnapshot();
    return {
      before,
      after: nextSnapshot?.config?.topics?.[topicTag] || null,
      snapshot: nextSnapshot,
    };
  }

  function updateBrokerSourceConfig(input = {}) {
    const sourceId = String(input?.sourceId || input?.source_id || "").trim();
    if (!sourceId) throw new Error("valid broker source id required");

    const nextTier = input?.tier == null ? null : Number(input.tier);
    if (nextTier != null && nextTier !== 1 && nextTier !== 2 && nextTier !== 3) {
      throw new Error("valid broker source tier required");
    }

    const snapshot = readConfigSnapshot();
    const before = (Array.isArray(snapshot?.config?.sources) ? snapshot.config.sources : [])
      .find((source) => String(source?.id || "").trim() === sourceId);
    if (!before) throw new Error("broker source not found");

    const rawConfig = snapshot?.raw_config && typeof snapshot.raw_config === "object"
      ? { ...snapshot.raw_config }
      : {};
    const rawSources = Array.isArray(rawConfig.sources) ? rawConfig.sources.slice() : [];
    const rawSourceIndex = rawSources.findIndex((source) => String(source?.id || "").trim() === sourceId);
    if (rawSourceIndex === -1) throw new Error("broker source not found");
    const rawSource = rawSources[rawSourceIndex] && typeof rawSources[rawSourceIndex] === "object"
      ? rawSources[rawSourceIndex]
      : {};

    rawSources[rawSourceIndex] = {
      ...rawSource,
      enabled: input?.enabled == null ? before.enabled !== false : input.enabled === true,
      tier: nextTier == null ? Number(before.tier || 2) : nextTier,
    };
    rawConfig.sources = rawSources;

    writeRawBrokerConfig(rawConfig);
    const nextSnapshot = readConfigSnapshot();
    return {
      before,
      after: (Array.isArray(nextSnapshot?.config?.sources) ? nextSnapshot.config.sources : [])
        .find((source) => String(source?.id || "").trim() === sourceId) || null,
      snapshot: nextSnapshot,
    };
  }

  function buildPreferredDomainShortlist(options = {}) {
    return buildBrokerPreferredDomainShortlistFromConfig(readConfigSnapshot().config, options);
  }

  function buildPreferredSourceFamilyShortlists(options = {}) {
    return buildBrokerPreferredSourceFamilyShortlistsFromConfig(readConfigSnapshot().config, options);
  }

  function matchPreferredSourceFromConfig(sourceDomain, topicTag, options = {}) {
    return matchPreferredSourceFromBrokerConfig(readConfigSnapshot().config, sourceDomain, topicTag, options);
  }

  async function fetchBrokerCandidates(params = {}) {
    const configSnapshot = readConfigSnapshot();
    const config = configSnapshot.config;
    const topicStates = Array.isArray(params.topicStates) ? params.topicStates : [];
    const activeTopicTags = topicStates
      .map((state) => normalizeTopicTag(state?.topic?.tag))
      .filter((tag) => topicLaneEnabled(config, tag, "publisher_feed") || topicLaneEnabled(config, tag, "official"));
    const diagnostics = buildBrokerInitialDiagnostics(activeTopicTags);
    diagnostics.config_source = configSnapshot.source_mode;
    diagnostics.active_path = configSnapshot.active_path;
    const topicItems = {};
    for (const tag of activeTopicTags) topicItems[tag] = [];
    if (activeTopicTags.length <= 0) {
      return { topicItems, diagnostics };
    }

    const fetchCache = new Map();
    for (const source of config.sources.filter((entry) => entry.enabled !== false)) {
      const sourceTopicTags = source.topic_tags.filter((tag) => activeTopicTags.includes(tag) && topicLaneEnabled(config, tag, source.lane));
      if (sourceTopicTags.length <= 0) continue;
      diagnostics.source_fetch_count += 1;
      let response = fetchCache.get(source.id);
      if (!response) {
        response = await fetchEndpoint(source.endpoint, {
          accept: source.parser === "federal_register_api" ? "application/json,text/plain,*/*" : "*/*",
        });
        fetchCache.set(source.id, response);
      }
      const sourceDiagnostic = {
        id: source.id,
        lane: source.lane,
        topic_tags: sourceTopicTags.slice(),
        endpoint: source.endpoint,
        ok: response?.ok === true,
        status: Number(response?.status || 0),
        parsed_count: 0,
        retained_count: 0,
        stale_count: 0,
        non_article_count: 0,
        validation_drop_count: 0,
        error: String(response?.error || "").trim() || null,
      };
      if (!response?.ok) {
        diagnostics.source_failure_count += 1;
        diagnostics.source_diagnostics.push(sourceDiagnostic);
        for (const tag of sourceTopicTags) {
          diagnostics.topic_diagnostics[tag].errors.push({
            source_id: source.id,
            error: sourceDiagnostic.error || `status ${sourceDiagnostic.status}`,
          });
        }
        continue;
      }

      const parsedEntries = brokerParseSourceBody(source, response);
      const normalized = buildBrokerNormalizedItemsForSource(
        {
          ...source,
          topic_tags: sourceTopicTags,
        },
        parsedEntries,
        {
          assignCanonicalTopic,
          retrievedAt: params.retrievedAt,
          maxAgeHours: params.maxAgeHours,
        }
      );
      sourceDiagnostic.parsed_count = Number(normalized.diagnostics.parsed_count || 0);
      sourceDiagnostic.retained_count = Number(normalized.diagnostics.retained_count || 0);
      sourceDiagnostic.stale_count = Number(normalized.diagnostics.stale_count || 0);
      sourceDiagnostic.non_article_count = Number(normalized.diagnostics.non_article_count || 0);
      sourceDiagnostic.validation_drop_count = Number(normalized.diagnostics.validation_drop_count || 0);
      diagnostics.source_success_count += 1;
      diagnostics.source_diagnostics.push(sourceDiagnostic);
      diagnostics.lane_counts[source.lane] = (diagnostics.lane_counts[source.lane] || 0) + normalized.items.length;
      for (const tag of sourceTopicTags) {
        const itemsForTopic = normalized.items.filter((item) => item.tag === tag);
        topicItems[tag] = (topicItems[tag] || []).concat(itemsForTopic);
        mergeBrokerTopicDiagnostics(diagnostics.topic_diagnostics[tag], source, itemsForTopic);
      }
    }

    for (const tag of Object.keys(topicItems)) {
      const seen = new Set();
      topicItems[tag] = topicItems[tag].filter((item) => {
        const key = String(item?.canonical_url || item?.url || "").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (Object.values(topicItems).some((items) => Array.isArray(items) && items.length > 0)) {
      log(`[standard-broker] produced ${Object.values(topicItems).reduce((sum, items) => sum + items.length, 0)} candidate(s) across ${activeTopicTags.length} topic(s)`);
    }

    return {
      topicItems,
      diagnostics,
    };
  }

  return {
    inspectStandardTopicBrokerConfig,
    loadStandardTopicBrokerConfig,
    updateBrokerTopicConfig,
    updateBrokerSourceConfig,
    buildPreferredDomainShortlist,
    buildPreferredSourceFamilyShortlists,
    matchPreferredSourceFromConfig,
    fetchBrokerCandidates,
  };
}

module.exports = {
  assignCanonicalTopic,
  brokerQueryLooksOfficial,
  buildBrokerPreferredDomainShortlistFromConfig,
  buildBrokerPreferredTopicEntriesFromConfig,
  buildBrokerPreferredSourceFamilyShortlistsFromConfig,
  matchPreferredSourceFromBrokerConfig,
  chooseBestFitTopicTag,
  createStandardTopicBrokerRuntime,
  scoreBestFitTopicTag,
  sanitizeBrokerConfig,
};
