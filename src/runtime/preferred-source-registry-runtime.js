"use strict";

const path = require("path");

const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");
const { buildBrokerPreferredTopicEntriesFromConfig } = require("./standard-topic-broker-runtime");
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
const BUILT_IN_PREFERRED_ALIASES = Object.freeze({
  "consumer retail": "consumer",
  "private equity m a": "pe m a",
  "ai technology": "ai tech",
  "policy & regulatory": "policy regulatory",
  "digital transformation": "digital",
  "sustainability esg": "sustainability",
  "talent workforce": "talent",
});
const BUILT_IN_STANDARD_TOPIC_SOURCE_MAP = Object.freeze({
  "healthcare": Object.freeze({
    reported: Object.freeze([
      "statnews.com",
      "endpointsnews.com",
      "modernhealthcare.com",
      "healthcaredive.com",
      "beckershospitalreview.com",
      "pharmavoice.com",
    ]),
    official: Object.freeze(["fda.gov", "cms.gov", "hhs.gov", "nih.gov"]),
  }),
  "financial services": Object.freeze({
    reported: Object.freeze([
      "americanbanker.com",
      "bankingdive.com",
      "paymentsdive.com",
      "risk.net",
    ]),
    official: Object.freeze(["federalreserve.gov", "sec.gov", "occ.treas.gov", "fdic.gov", "cfpb.gov"]),
  }),
  "pe m a": Object.freeze({
    reported: Object.freeze([
      "pitchbook.com",
      "pehub.com",
      "mergermarket.com",
      "globalcompetitionreview.com",
    ]),
    official: Object.freeze(["ftc.gov", "justice.gov", "sec.gov"]),
  }),
  "energy": Object.freeze({
    reported: Object.freeze([
      "utilitydive.com",
      "energydive.com",
      "canarymedia.com",
      "powermag.com",
      "heatmap.news",
      "solarpowerworldonline.com",
    ]),
    official: Object.freeze(["ferc.gov", "eia.gov", "energy.gov", "iea.org"]),
  }),
  "consumer": Object.freeze({
    reported: Object.freeze([
      "retaildive.com",
      "modernretail.co",
      "chainstoreage.com",
      "progressivegrocer.com",
    ]),
    official: Object.freeze(["ftc.gov", "census.gov"]),
  }),
  "life sciences": Object.freeze({
    reported: Object.freeze([
      "statnews.com",
      "endpointsnews.com",
      "fiercebiotech.com",
      "fiercepharma.com",
      "biopharmadive.com",
      "biospace.com",
    ]),
    official: Object.freeze(["fda.gov", "ema.europa.eu", "clinicaltrials.gov"]),
  }),
  "technology": Object.freeze({
    reported: Object.freeze([
      "theinformation.com",
      "semianalysis.com",
      "techcrunch.com",
      "theverge.com",
      "ciodive.com",
      "datacenterknowledge.com",
      "arstechnica.com",
      "wired.com",
    ]),
    official: Object.freeze(["sec.gov", "bis.gov"]),
  }),
  "industrials": Object.freeze({
    reported: Object.freeze([
      "industryweek.com",
      "supplychaindive.com",
      "freightwaves.com",
      "manufacturingdive.com",
    ]),
    official: Object.freeze(["commerce.gov", "transportation.gov", "osha.gov"]),
  }),
  "real estate": Object.freeze({
    reported: Object.freeze([
      "costar.com",
      "bisnow.com",
      "commercialobserver.com",
      "housingwire.com",
    ]),
    official: Object.freeze(["hud.gov", "census.gov", "sec.gov"]),
  }),
  "public sector": Object.freeze({
    reported: Object.freeze([
      "govexec.com",
      "federalnewsnetwork.com",
      "route-fifty.com",
      "nextgov.com",
    ]),
    official: Object.freeze(["govinfo.gov", "federalregister.gov", "regulations.gov", "gao.gov", "gsa.gov"]),
  }),
  "ai tech": Object.freeze({
    reported: Object.freeze([
      "theinformation.com",
      "semianalysis.com",
      "techcrunch.com",
      "theverge.com",
      "arstechnica.com",
      "wired.com",
    ]),
    official: Object.freeze(["bis.gov", "nist.gov", "sec.gov"]),
  }),
  "strategy": Object.freeze({
    reported: Object.freeze([
      "economist.com",
      "axios.com",
      "fortune.com",
      "semafor.com",
    ]),
    official: Object.freeze(["sec.gov"]),
  }),
  "policy regulatory": Object.freeze({
    reported: Object.freeze([
      "govexec.com",
      "federalnewsnetwork.com",
      "route-fifty.com",
      "politico.com",
      "globalcompetitionreview.com",
    ]),
    official: Object.freeze([
      "federalregister.gov",
      "regulations.gov",
      "govinfo.gov",
      "sec.gov",
      "ftc.gov",
      "justice.gov",
      "fda.gov",
      "cms.gov",
      "epa.gov",
      "treasury.gov",
      "bis.gov",
      "ec.europa.eu",
      "eur-lex.europa.eu",
    ]),
  }),
  "sustainability": Object.freeze({
    reported: Object.freeze([
      "trellis.net",
      "esgtoday.com",
      "responsible-investor.com",
      "canarymedia.com",
      "heatmap.news",
      "utilitydive.com",
    ]),
    official: Object.freeze(["epa.gov", "energy.gov", "eia.gov", "ec.europa.eu", "eur-lex.europa.eu", "sec.gov"]),
  }),
  "digital": Object.freeze({
    reported: Object.freeze([
      "ciodive.com",
      "cio.com",
      "informationweek.com",
      "techtarget.com",
      "techcrunch.com",
      "theinformation.com",
    ]),
    official: Object.freeze(["sec.gov"]),
  }),
  "m a advisory": Object.freeze({
    reported: Object.freeze([
      "pitchbook.com",
      "mergermarket.com",
      "pehub.com",
      "globalcompetitionreview.com",
    ]),
    official: Object.freeze(["ftc.gov", "justice.gov", "sec.gov"]),
  }),
  "talent": Object.freeze({
    reported: Object.freeze([
      "shrm.org",
      "hrdive.com",
      "workforce.com",
      "staffingindustry.com",
    ]),
    official: Object.freeze(["bls.gov", "dol.gov", "eeoc.gov", "uscis.gov"]),
  }),
});

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

function sanitizePreferredSourceRegistry(rawRegistry, options = {}) {
  const registry = rawRegistry && typeof rawRegistry === "object" ? rawRegistry : {};
  const embeddedStandardTopicSource = registry?.standard_topic_source
    && typeof registry.standard_topic_source === "object"
    ? registry.standard_topic_source
    : null;
  const embeddedStandardTopicKeys = Array.isArray(embeddedStandardTopicSource?.topic_keys)
    ? registry.standard_topic_source.topic_keys
    : [];
  const aliases = {
    ...sanitizePreferredAliases(BUILT_IN_PREFERRED_ALIASES),
    ...sanitizePreferredAliases(registry.aliases),
  };
  const standardTopicSourceMapRaw = options?.standardTopicSourceMap
    && typeof options.standardTopicSourceMap === "object"
    && !Array.isArray(options.standardTopicSourceMap)
    ? options.standardTopicSourceMap
    : Object.fromEntries(
      embeddedStandardTopicKeys
        .map((topicKey) => [topicKey, registry?.topics?.[topicKey] || null])
        .filter(([, entry]) => entry && typeof entry === "object")
    );
  const includeBuiltInStandardTopicSourceMap = options?.includeBuiltInStandardTopicSourceMap !== false
    && !embeddedStandardTopicSource;
  const standardTopicSourceMeta = options?.standardTopicSourceMeta
    && typeof options.standardTopicSourceMeta === "object"
    ? options.standardTopicSourceMeta
    : embeddedStandardTopicSource;
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
  const standardTopicEntries = {};
  const standardTopicKeys = new Set();

  for (const [rawTopicKey, rawEntry] of Object.entries(standardTopicSourceMapRaw)) {
    const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
    if (!topicKey) continue;
    const sanitizedEntry = sanitizeTopicEntry(rawEntry);
    if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
    standardTopicEntries[topicKey] = mergeTopicEntries(standardTopicEntries[topicKey], sanitizedEntry);
    standardTopicKeys.add(topicKey);
  }

  for (const [rawTopicKey, rawEntry] of Object.entries(topicsRaw)) {
    const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
    if (!topicKey) continue;
    if (standardTopicKeys.has(topicKey)) continue;
    const sanitizedEntry = sanitizeTopicEntry(rawEntry);
    if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
    topics[topicKey] = mergeTopicEntries(topics[topicKey], sanitizedEntry);
  }

  if (includeBuiltInStandardTopicSourceMap) {
    for (const [rawTopicKey, rawEntry] of Object.entries(BUILT_IN_STANDARD_TOPIC_SOURCE_MAP)) {
      const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
      if (!topicKey) continue;
      if (standardTopicKeys.has(topicKey)) continue;
      const sanitizedEntry = sanitizeTopicEntry(rawEntry);
      if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
      topics[topicKey] = mergeTopicEntries(topics[topicKey], sanitizedEntry);
    }
  }

  for (const [topicKey, rawEntry] of Object.entries(standardTopicEntries)) {
    topics[topicKey] = sanitizeTopicEntry(rawEntry);
  }

  for (const [rawTopicKey, rawEntry] of Object.entries(publisherTopicsRaw)) {
    const topicKey = normalizePreferredTopicKey(rawTopicKey, aliases);
    if (!topicKey) continue;
    const sanitizedEntry = sanitizePublisherTopicEntry(rawEntry);
    if (!sanitizedEntry.reported.length && !sanitizedEntry.official.length) continue;
    publishers.topics[topicKey] = mergePublisherTopicEntries(publishers.topics[topicKey], sanitizedEntry);
  }

  const standardTopicSource = standardTopicKeys.size > 0
    ? {
      source_of_truth: "standard_topic_broker",
      source_mode: String(standardTopicSourceMeta?.source_mode || "runtime").trim() || "runtime",
      active_path: String(standardTopicSourceMeta?.active_path || "").trim() || null,
      runtime_path: String(standardTopicSourceMeta?.runtime_path || "").trim() || null,
      bundled_path: String(standardTopicSourceMeta?.bundled_path || "").trim() || null,
      topic_keys: Array.from(standardTopicKeys).sort((left, right) => left.localeCompare(right)),
      topic_count: standardTopicKeys.size,
    }
    : null;

  return {
    version: DEFAULT_PREFERRED_SOURCES_VERSION,
    global: {
      reported: sanitizeDomainList(registry?.global?.reported),
      official: sanitizeDomainList(registry?.global?.official),
    },
    topics,
    publishers,
    aliases,
    standard_topic_source: standardTopicSource,
  };
}

function countPreferredRegistryDomains(registry) {
  const sanitized = sanitizePreferredSourceRegistry(registry);
  const uniqueDomains = new Set([
    ...(sanitized?.global?.reported || []),
    ...(sanitized?.global?.official || []),
    ...Object.values(sanitized?.topics || {}).flatMap((entry) => [
      ...(entry?.reported || []),
      ...(entry?.official || []),
    ]),
  ]);
  return uniqueDomains.size;
}

function countPreferredRegistryPublishers(registry) {
  const sanitized = sanitizePreferredSourceRegistry(registry);
  const uniquePublishers = new Set([
    ...(sanitized?.publishers?.global?.reported || []),
    ...(sanitized?.publishers?.global?.official || []),
    ...Object.values(sanitized?.publishers?.topics || {}).flatMap((entry) => [
      ...(entry?.reported || []),
      ...(entry?.official || []),
    ]),
  ]);
  return uniquePublishers.size;
}

function isPreferredRegistryEmpty(registry) {
  const sanitized = sanitizePreferredSourceRegistry(registry);
  const topicCount = Object.keys(sanitized?.topics || {}).length;
  const publisherTopicCount = Object.keys(sanitized?.publishers?.topics || {}).length;
  return countPreferredRegistryDomains(sanitized) === 0
    && countPreferredRegistryPublishers(sanitized) === 0
    && topicCount === 0
    && publisherTopicCount === 0;
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

function buildPreferredSourceFamilyShortlists(registryRaw, options = {}) {
  const registry = sanitizePreferredSourceRegistry(registryRaw);
  const maxDomains = Math.max(1, Number(options.maxDomains || 20));
  const relevantTopics = resolveRelevantTopicKeys(registry, options.topicTag, options.dueUserTopics);
  const officialFriendly = relevantTopics.some((topicKey) => isOfficialFriendlyPreferredTopic(topicKey))
    || queryLooksOfficial(options.queryText);

  const topicReported = [];
  const topicOfficial = [];
  const globalReported = sanitizeDomainList(registry?.global?.reported || []);
  const globalOfficial = sanitizeDomainList(registry?.global?.official || []);
  const seenTopicReported = new Set();
  const seenTopicOfficial = new Set();

  function pushUnique(target, seen, value) {
    const normalized = normalizeSourcePolicyDomain(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    target.push(normalized);
  }

  for (const topicKey of relevantTopics) {
    const topicEntry = registry?.topics?.[topicKey] || {};
    for (const domain of (topicEntry.reported || [])) pushUnique(topicReported, seenTopicReported, domain);
    for (const domain of (topicEntry.official || [])) pushUnique(topicOfficial, seenTopicOfficial, domain);
  }

  const reportedDomains = uniqueStrings([...topicReported, ...globalReported]).slice(0, maxDomains);
  const officialDomains = uniqueStrings([...topicOfficial, ...globalOfficial]).slice(0, maxDomains);
  const combinedDomains = officialFriendly
    ? uniqueStrings([...officialDomains, ...reportedDomains]).slice(0, maxDomains)
    : uniqueStrings([...reportedDomains, ...officialDomains]).slice(0, maxDomains);

  return {
    reported_domains: reportedDomains,
    official_domains: officialDomains,
    global_reported_domains: globalReported.slice(0, maxDomains),
    global_official_domains: globalOfficial.slice(0, maxDomains),
    combined_domains: combinedDomains,
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
  const runtimePaths = resolveSignalBriefRuntimePaths({
    appRoot: options.appRoot,
    env: options.env,
    nodeEnv: options.nodeEnv,
  });
  const bundledPreferredSourcesPath = String(options.bundledPreferredSourcesPath || "").trim() || path.resolve(
    options.appRoot ? String(options.appRoot) : path.join(__dirname, "..", ".."),
    "config",
    "preferred-sources.json"
  );
  const preferredSourcesPath = String(options.preferredSourcesPath || "").trim() || runtimePaths.preferredSourcesPath;
  const bundledStandardTopicBrokerSourcesPath = String(options.bundledStandardTopicBrokerSourcesPath || "").trim() || path.resolve(
    options.appRoot ? String(options.appRoot) : path.join(__dirname, "..", ".."),
    "config",
    "standard-topic-broker-sources.json"
  );
  const standardTopicBrokerSourcesPath = String(options.standardTopicBrokerSourcesPath || "").trim()
    || runtimePaths.standardTopicBrokerSourcesPath;

  function readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function inspectStandardTopicSourceOverlay() {
    const runtimeConfig = readJson(standardTopicBrokerSourcesPath);
    if (runtimeConfig) {
      return {
        source_of_truth: "standard_topic_broker",
        source_mode: "runtime",
        active_path: standardTopicBrokerSourcesPath,
        runtime_path: standardTopicBrokerSourcesPath,
        bundled_path: bundledStandardTopicBrokerSourcesPath,
        topic_map: buildBrokerPreferredTopicEntriesFromConfig(runtimeConfig),
      };
    }

    const bundledConfig = readJson(bundledStandardTopicBrokerSourcesPath);
    if (bundledConfig) {
      return {
        source_of_truth: "standard_topic_broker",
        source_mode: "bundled",
        active_path: bundledStandardTopicBrokerSourcesPath,
        runtime_path: standardTopicBrokerSourcesPath,
        bundled_path: bundledStandardTopicBrokerSourcesPath,
        topic_map: buildBrokerPreferredTopicEntriesFromConfig(bundledConfig),
      };
    }

    return null;
  }

  function readSanitizedRegistry(filePath, sanitizeOptions = {}) {
    const raw = readJson(filePath);
    if (!raw) return null;
    return sanitizePreferredSourceRegistry(raw, sanitizeOptions);
  }

  function inspectPreferredSourceRegistry() {
    const standardTopicSource = inspectStandardTopicSourceOverlay();
    const sanitizeOptions = standardTopicSource
      ? {
        standardTopicSourceMap: standardTopicSource.topic_map,
        standardTopicSourceMeta: standardTopicSource,
        includeBuiltInStandardTopicSourceMap: false,
      }
      : {};
    const runtimeRegistry = readSanitizedRegistry(preferredSourcesPath, sanitizeOptions);
    if (runtimeRegistry && !isPreferredRegistryEmpty(runtimeRegistry)) {
      return {
        registry: runtimeRegistry,
        source_mode: "runtime",
        active_path: preferredSourcesPath,
        runtime_path: preferredSourcesPath,
        bundled_path: bundledPreferredSourcesPath,
        used_fallback: false,
        standard_topic_source: runtimeRegistry.standard_topic_source || standardTopicSource,
      };
    }
    const bundledRegistry = readSanitizedRegistry(bundledPreferredSourcesPath, sanitizeOptions);
    if (bundledRegistry && !isPreferredRegistryEmpty(bundledRegistry)) {
      return {
        registry: bundledRegistry,
        source_mode: "bundled_fallback",
        active_path: bundledPreferredSourcesPath,
        runtime_path: preferredSourcesPath,
        bundled_path: bundledPreferredSourcesPath,
        used_fallback: true,
        standard_topic_source: bundledRegistry.standard_topic_source || standardTopicSource,
      };
    }
    return {
      registry: sanitizePreferredSourceRegistry({}, sanitizeOptions),
      source_mode: "empty",
      active_path: preferredSourcesPath,
      runtime_path: preferredSourcesPath,
      bundled_path: bundledPreferredSourcesPath,
      used_fallback: runtimeRegistry == null,
      standard_topic_source: standardTopicSource,
    };
  }

  function loadPreferredSourceRegistry() {
    return inspectPreferredSourceRegistry().registry;
  }

  return {
    preferredSourcesPath,
    bundledPreferredSourcesPath,
    standardTopicBrokerSourcesPath,
    bundledStandardTopicBrokerSourcesPath,
    buildPreferredSourceFamilyShortlists: (registry, options = {}) => buildPreferredSourceFamilyShortlists(registry, options),
    inspectPreferredSourceRegistry,
    loadPreferredSourceRegistry,
  };
}

module.exports = {
  DEFAULT_PREFERRED_SOURCES_VERSION,
  OFFICIAL_FRIENDLY_TOPIC_KEYS,
  buildPreferredDomainShortlist,
  buildPreferredSourceFamilyShortlists,
  createPreferredSourceRegistryRuntime,
  isOfficialFriendlyPreferredTopic,
  matchPreferredSourceDomain,
  normalizePreferredTopicKey,
  normalizePreferredPublisherKey,
  queryLooksOfficial,
  sanitizePreferredSourceRegistry,
};
