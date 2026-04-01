"use strict";

const path = require("path");

const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");
const { classifyUrlShape } = require("../digest/runtime/digest-data-fetch-items-runtime");
const { normalizeTopicToken, topicsRelated, canonicalizeMvpTopicTag } = require("./topic-normalization-runtime");

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 512_000;
// MVP topic set: 7 topics. Regulatory coverage now rolls into the closest sector topic;
// surface through sector-specific official sources tagged to their relevant topics.
const PHASE1_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
]);
const ALLOWED_LANES = new Set(["perplexity_discovery", "publisher_feed", "official"]);
const ALLOWED_SOURCE_KINDS = new Set(["reported_media", "trade_specialist", "primary_official"]);
const ALLOWED_CONTENT_KINDS = new Set(["article", "official_document", "filing"]);
const ALLOWED_PARSERS = new Set(["rss", "atom", "rss_or_atom", "federal_register_api", "html_date_index"]);
const MONTH_PATTERN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const HUMAN_DATE_RE = new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2},\\s+\\d{4}\\b`, "ig");
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const RSS_ITEM_PATTERN = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_PATTERN = /<entry\b[\s\S]*?<\/entry>/gi;
const ATOM_LINK_PATTERN = /<link\b[^>]*href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
const BROKER_OFFICIAL_QUERY_HINT_PATTERN = /\b(rule|rules|rulemaking|filing|filings|approval|approves?|approved|agency|register|proposed|guidance|enforcement|regulation|regulatory|directive|law|laws|compliance)\b/i;
const OFFICIAL_FRIENDLY_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "FINANCIAL SERVICES",
  "ENERGY",
]);

/**
 * Pick one canonical topic for an article.
 * Without item context this falls back to the first configured tag, preserving
 * the exported helper contract used by existing tests and tools.
 * @param {string[]} topicTags
 * @param {object} [item]
 * @returns {string|null}
 */
function assignCanonicalTopic(topicTags, item) {
  const candidates = Array.isArray(topicTags) ? topicTags : [];
  if (candidates.length === 0) return null;
  if (!item || typeof item !== "object") return candidates[0];
  return chooseBestFitTopicTag(candidates, item) || candidates[0];
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function maybeDecodeUriComponent(value) {
  const text = String(value || "").trim();
  if (!text || !/%[0-9a-f]{2}/i.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    nbsp: " ",
    quot: "\"",
    lt: "<",
    gt: ">",
    ldquo: "“",
    rdquo: "”",
    lsquo: "‘",
    rsquo: "’",
    hellip: "…",
    ndash: "–",
    mdash: "—",
  };
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, entity) => {
      const key = String(entity || "").toLowerCase();
      return Object.prototype.hasOwnProperty.call(namedEntities, key) ? namedEntities[key] : match;
    });
}

function stripTags(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")));
}

function sanitizePatternList(values) {
  const out = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    const text = String(value || "").trim();
    if (!text) continue;
    out.push(text);
  }
  return out;
}

function buildPatternMatcher(patterns = [], defaultValue = true) {
  const compiled = sanitizePatternList(patterns)
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return (value) => {
    if (compiled.length <= 0) return defaultValue;
    const text = String(value || "").trim();
    return compiled.some((pattern) => pattern.test(text));
  };
}

function toIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidates = [
    text,
    text
      .replace(/\b([A-Z][a-z]{2})\.(?=\s+\d{1,2},\s+\d{4})/g, "$1")
      .replace(/(\d)(am|pm)\b/gi, "$1 $2")
      .replace(/^(?:[A-Z][a-z]{2},\s+)?(\d{2}\/\d{2}\/\d{4})\s+-\s+(\d{1,2}:\d{2})(?::\d{2})?$/, "$1 $2"),
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return "";
}

function findTagValue(block, names) {
  const tags = Array.isArray(names) ? names : [names];
  for (const name of tags) {
    const pattern = new RegExp(`<${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>([\\s\\S]*?)<\\/${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "i");
    const match = String(block || "").match(pattern);
    if (match?.[1]) {
      const value = decodeHtmlEntities(match[1]);
      if (value) return value;
    }
  }
  return "";
}

function extractAttributes(tagText) {
  const attrs = {};
  let match;
  while ((match = ATTRIBUTE_PATTERN.exec(String(tagText || "")))) {
    const key = String(match[1] || "").trim().toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!key) continue;
    attrs[key] = decodeHtmlEntities(value).trim();
  }
  return attrs;
}

function normalizeAbsoluteUrl(candidate, baseUrl) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, String(baseUrl || "").trim() || undefined).toString();
  } catch {
    return "";
  }
}

function extractHrefFromMarkup(rawValue, baseUrl) {
  const markup = maybeDecodeUriComponent(String(rawValue || ""));
  const match = markup.match(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return normalizeAbsoluteUrl(match?.[1] || match?.[2] || match?.[3] || "", baseUrl);
}

function normalizeFeedLink(rawValue, baseUrl) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if (/<a\b/i.test(raw) || /%3ca\b/i.test(raw)) {
    return extractHrefFromMarkup(raw, baseUrl);
  }
  return normalizeAbsoluteUrl(raw, baseUrl);
}

function normalizeTopicTag(value) {
  const raw = String(value || "").trim().toUpperCase();
  return canonicalizeMvpTopicTag(raw) || raw;
}

const BROKER_TOPIC_KEYWORDS = Object.freeze({
  [normalizeTopicToken("HEALTHCARE")]: Object.freeze([
    "healthcare",
    "hospital",
    "health system",
    "medicare",
    "medicaid",
    "payer",
    "provider",
    "physician",
    "clinic",
    "patient",
    "care delivery",
    "reimbursement",
    "medical device",
  ]),
  [normalizeTopicToken("LIFE SCIENCES")]: Object.freeze([
    "life sciences",
    "biotech",
    "biopharma",
    "pharma",
    "pharmaceutical",
    "drug",
    "therapy",
    "therapeutic",
    "clinical trial",
    "trial",
    "phase 1",
    "phase 2",
    "phase 3",
    "biologic",
    "molecule",
  ]),
  [normalizeTopicToken("TECHNOLOGY")]: Object.freeze([
    "technology",
    "software",
    "artificial intelligence",
    "ai",
    "semiconductor",
    "chip",
    "cloud",
    "cyber",
    "privacy",
    "data",
    "platform",
    "app",
    "digital",
    "saas",
  ]),
  [normalizeTopicToken("ENERGY")]: Object.freeze([
    "energy",
    "oil",
    "gas",
    "utility",
    "utilities",
    "power",
    "grid",
    "solar",
    "wind",
    "battery",
    "transmission",
    "pipeline",
    "renewable",
    "nuclear",
    "electricity",
  ]),
  [normalizeTopicToken("FINANCIAL SERVICES")]: Object.freeze([
    "financial services",
    "bank",
    "banking",
    "lender",
    "lending",
    "credit",
    "payments",
    "payment",
    "capital markets",
    "securities",
    "asset manager",
    "fintech",
    "insurance",
    "brokerage",
    "consumer lending",
    "private equity",
  ]),
  [normalizeTopicToken("CONSUMER & RETAIL")]: Object.freeze([
    "consumer",
    "retail",
    "retailer",
    "grocery",
    "restaurant",
    "ecommerce",
    "e commerce",
    "apparel",
    "beauty",
    "brand",
    "shopper",
    "checkout",
    "loyalty program",
    "marketplace",
    "pricing",
  ]),
  [normalizeTopicToken("INDUSTRIALS")]: Object.freeze([
    "industrial",
    "manufacturing",
    "factory",
    "logistics",
    "freight",
    "transportation",
    "aerospace",
    "defense",
    "auto",
    "automotive",
    "airline",
    "rail",
    "supply chain",
  ]),
});

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBrokerWordBoundary(text, token) {
  const haystack = String(text || "").trim();
  const needle = String(token || "").trim();
  if (!haystack || !needle) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`, "i").test(haystack);
}

function matchesBrokerKeyword(text, keyword) {
  const normalizedKeyword = normalizeTopicToken(keyword);
  if (!normalizedKeyword) return false;
  if (String(text || "").includes(normalizedKeyword)) return true;
  const tokens = normalizedKeyword.split(" ").filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => hasBrokerWordBoundary(text, token));
}

function scoreBestFitTopicTag(topicTag, text) {
  const topicToken = normalizeTopicToken(topicTag);
  if (!topicToken || !text) return 0;

  let score = 0;
  if (String(text).includes(topicToken)) score += 8;

  for (const token of topicToken.split(" ").filter(Boolean)) {
    if (token.length <= 2 && !["ai"].includes(token)) continue;
    if (hasBrokerWordBoundary(text, token)) score += 2;
  }

  const keywords = BROKER_TOPIC_KEYWORDS[topicToken] || [];
  for (const keyword of keywords) {
    if (!matchesBrokerKeyword(text, keyword)) continue;
    score += normalizeTopicToken(keyword).includes(" ") ? 4 : 3;
  }

  return score;
}

function chooseBestFitTopicTag(topicTags, item = {}) {
  const candidates = Array.from(new Set((Array.isArray(topicTags) ? topicTags : []).map(normalizeTopicTag).filter(Boolean)));
  if (candidates.length <= 1) return candidates[0] || "";

  const text = normalizeTopicToken([
    item?.headline,
    item?.summary,
    item?.canonical_url,
    item?.url,
  ].filter(Boolean).join(" "));

  let bestTag = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreBestFitTopicTag(candidate, text);
    if (score > bestScore) {
      bestTag = candidate;
      bestScore = score;
    }
  }
  return bestTag;
}

function safeJsonParse(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function pickFirstDomain(domains, endpoint) {
  const fromList = (Array.isArray(domains) ? domains : [])
    .map((value) => normalizeSourcePolicyDomain(value))
    .find(Boolean);
  if (fromList) return fromList;
  try {
    return normalizeSourcePolicyDomain(new URL(String(endpoint || "")).hostname);
  } catch {
    return "";
  }
}

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
    if (!tag || !PHASE1_TOPIC_TAGS.has(tag)) continue;
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
    .filter((tag) => PHASE1_TOPIC_TAGS.has(tag))));
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
    title_include_patterns: sanitizePatternList(entry.title_include_patterns),
    title_exclude_patterns: sanitizePatternList(entry.title_exclude_patterns),
    url_exclude_patterns: sanitizePatternList(entry.url_exclude_patterns),
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
  if (!normalizedTopicTag || !PHASE1_TOPIC_TAGS.has(normalizedTopicTag)) return [];
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
      pickFirstDomain(source?.domains, source?.endpoint),
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
  for (const topicTag of PHASE1_TOPIC_TAGS) {
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
  if (!topicTag || !PHASE1_TOPIC_TAGS.has(topicTag)) return null;
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
  if (!topicTag || !PHASE1_TOPIC_TAGS.has(topicTag)) return null;
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

  for (const candidateTopicTag of PHASE1_TOPIC_TAGS) {
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

function buildInitialDiagnostics(activeTopicTags = []) {
  const topicDiagnostics = {};
  for (const tag of activeTopicTags) {
    topicDiagnostics[tag] = {
      tag,
      enabled: true,
      lane_counts: {
        publisher_feed: 0,
        official: 0,
      },
      source_counts: {},
      source_ids: [],
      item_count: 0,
      article_item_count: 0,
      official_document_count: 0,
      errors: [],
    };
  }
  return {
    enabled: true,
    active_topic_tags: activeTopicTags.slice(),
    config_source: "none",
    lane_counts: {
      publisher_feed: 0,
      official: 0,
    },
    source_fetch_count: 0,
    source_success_count: 0,
    source_failure_count: 0,
    source_diagnostics: [],
    topic_diagnostics: topicDiagnostics,
  };
}

async function defaultFetchEndpoint(url, opts = {}) {
  const timeoutMs = Math.max(1_000, Number(opts?.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxBytes = Math.max(8_192, Number(opts?.maxBytes || DEFAULT_MAX_BYTES));
  const accept = String(opts?.accept || "").trim() || "*/*";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(url || ""), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": "SignalBriefBot/1.0 (+https://getsignalbrief.com)",
      },
    });
    const bodyText = String(await response.text() || "").slice(0, maxBytes);
    return {
      ok: response.ok,
      status: Number(response.status || 0),
      contentType: String(response.headers.get("content-type") || "").toLowerCase(),
      url: String(response.url || url || "").trim(),
      bodyText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      url: String(url || "").trim(),
      bodyText: "",
      error: String(error?.message || error || "fetch failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml, endpointUrl) {
  const items = [];
  for (const block of (String(xml || "").match(RSS_ITEM_PATTERN) || [])) {
    const rawTitle = findTagValue(block, "title");
    const rawDescription = findTagValue(block, ["description", "content:encoded", "summary"]);
    const title = stripTags(rawTitle);
    const link = normalizeFeedLink(findTagValue(block, ["link", "guid"]), endpointUrl)
      || extractHrefFromMarkup(rawTitle, endpointUrl)
      || extractHrefFromMarkup(rawDescription, endpointUrl);
    const publishedDate = toIsoDate(findTagValue(block, ["pubDate", "dc:date", "published", "updated"]));
    const summary = stripTags(rawDescription);
    items.push({ title, url: link, publishedDate, summary });
  }
  return items;
}

function parseAtom(xml, endpointUrl) {
  const items = [];
  for (const block of (String(xml || "").match(ATOM_ENTRY_PATTERN) || [])) {
    const title = stripTags(findTagValue(block, "title"));
    let link = "";
    let match;
    while ((match = ATOM_LINK_PATTERN.exec(block))) {
      const candidate = match[1] || match[2] || match[3] || "";
      if (!candidate) continue;
      link = normalizeAbsoluteUrl(candidate, endpointUrl);
      if (link) break;
    }
    const publishedDate = toIsoDate(findTagValue(block, ["published", "updated"]));
    const summary = stripTags(findTagValue(block, ["summary", "content"]));
    items.push({ title, url: link, publishedDate, summary });
  }
  return items;
}

function parseXmlFeed(xml, endpointUrl) {
  const payload = String(xml || "");
  if (/<feed[\s>]/i.test(payload)) return parseAtom(payload, endpointUrl);
  return parseRss(payload, endpointUrl);
}

function parseFederalRegisterApi(bodyText) {
  const parsed = safeJsonParse(bodyText);
  const rows = Array.isArray(parsed?.results) ? parsed.results : [];
  return rows.map((row) => ({
    title: normalizeWhitespace(row?.title || ""),
    url: normalizeAbsoluteUrl(row?.html_url || row?.public_inspection_pdf_url || row?.pdf_url || "", "https://www.federalregister.gov"),
    publishedDate: toIsoDate(row?.publication_date || row?.display_date || ""),
    summary: normalizeWhitespace(row?.abstract || row?.excerpts || ""),
  }));
}

function findNearbyDate(html, anchorIndex) {
  const start = Math.max(0, Number(anchorIndex || 0) - 240);
  const end = Math.min(String(html || "").length, Number(anchorIndex || 0) + 240);
  const windowText = String(html || "").slice(start, end);
  const humanMatch = windowText.match(HUMAN_DATE_RE);
  if (humanMatch?.[humanMatch.length - 1]) return toIsoDate(humanMatch[humanMatch.length - 1]);
  const isoMatch = windowText.match(ISO_DATE_RE);
  if (isoMatch?.[isoMatch.length - 1]) return toIsoDate(isoMatch[isoMatch.length - 1]);
  return "";
}

function parseHtmlDateIndex(html, endpointUrl) {
  const items = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(String(html || "")))) {
    const attrs = extractAttributes(match[1] || "");
    const href = normalizeAbsoluteUrl(attrs.href || "", endpointUrl);
    const title = stripTags(match[2] || "");
    if (!href || !title || seen.has(href)) continue;
    const publishedDate = findNearbyDate(html, match.index);
    if (!publishedDate) continue;
    seen.add(href);
    items.push({
      title,
      url: href,
      publishedDate,
      summary: title,
    });
  }
  return items;
}

function parseSourceBody(source, response) {
  const parser = String(source?.parser || "").trim().toLowerCase();
  if (parser === "federal_register_api") return parseFederalRegisterApi(response?.bodyText);
  if (parser === "html_date_index") return parseHtmlDateIndex(response?.bodyText, response?.url || source?.endpoint);
  return parseXmlFeed(response?.bodyText, response?.url || source?.endpoint);
}

function buildTitlePatternMatcher(patterns = []) {
  return buildPatternMatcher(patterns, true);
}

function buildTitleExclusionMatcher(patterns = []) {
  return buildPatternMatcher(patterns, false);
}

function buildUrlExclusionMatcher(patterns = []) {
  return buildPatternMatcher(patterns, false);
}

// Headline patterns that indicate non-news content (buying guides, coupon pages,
// deal roundups, index/listing pages). Checked for publisher_feed items only.
const NON_NEWS_HEADLINE_PATTERNS = [
  /promo\s*codes?/i,
  /discount\s*codes?/i,
  /coupon\s*codes?/i,
  /\bbuying\s*guide\b/i,
  /\bprice\s*drop\b/i,
  /\bspring\s*sale\b/i,
  /\bblack\s*friday\b/i,
  /\bcyber\s*monday\b/i,
  /^best\s+.{3,}\s+(?:of|in|\()\s*202\d/i,
  /\bdeals?\b.{0,20}\b(?:are|we|you|actually|:)/i,
  /\bsave\s+(?:on|\$|\d+%)/i,
  /^what.s\s+new\s+(?:for|related\s+to)\b/i,
  /^novel\s+drug\s+approvals?\s+for\s+\d{4}/i,
];

function isNonNewsHeadline(headline) {
  const text = String(headline || "").trim();
  if (!text) return false;
  return NON_NEWS_HEADLINE_PATTERNS.some((pattern) => pattern.test(text));
}

function isLikelyPromotionalHub(headline, summary) {
  const title = normalizeWhitespace(decodeHtmlEntities(headline)).toLowerCase();
  if (!title) return false;
  const body = normalizeWhitespace(decodeHtmlEntities(summary)).toLowerCase();
  const combined = `${title} ${body}`.trim();
  if (!combined) return false;
  return [
    /\bresearch,\s*insights?\s+and\s+data\b/i,
    /\bcan now be found in a new location\b/i,
    /\bnew location on\b/i,
    /\bresource center\b/i,
    /\bcontent hub\b/i,
    /\bsection launch\b/i,
    /\bintroducing\b.+\b(?:hub|section|center|resource|intelligence)\b/i,
  ].some((pattern) => pattern.test(combined));
}

function officialListingUrlLooksArticleLike(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const pathname = String(parsed.pathname || "/").toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : "";
    if (segments.length < 2 || !lastSegment) return false;
    if (
      lastSegment === "news"
      || lastSegment === "latest"
      || lastSegment === "archive"
      || lastSegment === "archives"
      || lastSegment === "stories"
      || lastSegment === "articles"
      || lastSegment === "blog"
      || lastSegment === "blogs"
      || lastSegment === "press"
      || lastSegment === "press-releases"
      || lastSegment === "press-release"
      || lastSegment === "insights"
      || lastSegment === "opinion"
      || lastSegment === "opinions"
      || lastSegment === "authors"
      || lastSegment === "author"
      || lastSegment === "section"
      || lastSegment === "sections"
      || lastSegment === "search"
    ) {
      return false;
    }
    if (parsed.search && !/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv)$/i.test(lastSegment)) return false;
    return true;
  } catch {
    return false;
  }
}

function laneAcceptsShape(source, urlShape, url) {
  if (String(source?.lane || "").trim() === "publisher_feed") {
    return (
      urlShape === "article_url"
      || (
        source?.allow_article_like_listing_urls === true
        && urlShape === "listing_page"
        && officialListingUrlLooksArticleLike(url)
      )
    );
  }
  return (
    urlShape === "article_url"
    || urlShape === "document_file"
    || (urlShape === "listing_page" && officialListingUrlLooksArticleLike(url))
  );
}

function itemAgeTooOldAtTime(item, maxAgeHours, retrievedAt) {
  const limit = Number.isFinite(maxAgeHours) ? maxAgeHours : 48;
  const pubDate = Date.parse(String(item?.published_date || "").trim());
  const referenceTime = Date.parse(String(retrievedAt || "").trim());
  const now = Number.isFinite(referenceTime) ? referenceTime : Date.now();
  if (!Number.isFinite(pubDate)) return true;
  return (now - pubDate) / (60 * 60 * 1000) > limit;
}

function buildNormalizedItemsForSource(source, entries, opts = {}) {
  const items = [];
  const retrievedAt = String(opts?.retrievedAt || "").trim() || new Date().toISOString();
  const maxAgeHours = Number.isFinite(Number(opts?.maxAgeHours)) ? Number(opts.maxAgeHours) : 48;
  const matchesTitle = buildTitlePatternMatcher(source?.title_include_patterns);
  const titleExcluded = buildTitleExclusionMatcher(source?.title_exclude_patterns);
  const urlExcluded = buildUrlExclusionMatcher(source?.url_exclude_patterns);
  const baseDomain = pickFirstDomain(source?.domains, source?.endpoint);
  const baseAuthority = String(source?.lane || "").trim() === "official"
    ? 0.9
    : String(source?.source_family || "").trim() === "specialist"
      ? 0.8
      : 0.76;
  const diagnostics = {
    parsed_count: 0,
    retained_count: 0,
    stale_count: 0,
    non_article_count: 0,
    validation_drop_count: 0,
  };
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    diagnostics.parsed_count += 1;
    const headline = normalizeWhitespace(entry?.title || "");
    const url = normalizeAbsoluteUrl(entry?.url || "", source?.endpoint);
    const canonicalUrl = url;
    const publishedDate = toIsoDate(entry?.publishedDate || entry?.published_date || "");
    const urlShape = classifyUrlShape(url);
    if (!headline || !url || !publishedDate) {
      diagnostics.validation_drop_count += 1;
      continue;
    }
    if (urlExcluded(url)) {
      diagnostics.validation_drop_count += 1;
      continue;
    }
    if (titleExcluded(headline)) {
      diagnostics.validation_drop_count += 1;
      continue;
    }
    if (!laneAcceptsShape(source, urlShape, url)) {
      diagnostics.non_article_count += 1;
      continue;
    }
    if (String(source?.lane || "").trim() === "official" && !matchesTitle(headline)) {
      diagnostics.validation_drop_count += 1;
      continue;
    }
    if (
      String(source?.lane || "").trim() === "publisher_feed"
      && (isNonNewsHeadline(headline) || isLikelyPromotionalHub(headline, entry?.summary || entry?.description || ""))
    ) {
      diagnostics.validation_drop_count += 1;
      continue;
    }
    const sourceDomain = normalizeSourcePolicyDomain((() => {
      try {
        return new URL(url).hostname;
      } catch {
        return baseDomain;
      }
    })()) || baseDomain;
    const itemBase = {
      headline,
      summary: normalizeWhitespace(decodeHtmlEntities(entry?.summary || entry?.description || headline)),
      url,
      canonical_url: canonicalUrl,
      published_date: publishedDate,
      source: sourceDomain,
      source_domain: sourceDomain,
      retrieved_at: retrievedAt,
      retrieval_pass: `broker_${String(source?.lane || "").trim()}`,
      retrieval_lane: String(source?.lane || "").trim(),
      retrieval_origin: String(source?.lane || "").trim() === "official"
        ? "broker_official"
        : "broker_publisher_feed",
      retrieval_source_family: String(source?.source_family || "").trim() || (String(source?.lane || "").trim() === "official" ? "official" : "reported"),
      source_type: String(source?.source_kind || "").trim().toLowerCase(),
      source_policy: "preferred",
      source_authority: Number(baseAuthority.toFixed(3)),
      // source_tier carries the numeric tier (1/2/3) from the registry.
      // Used by scoring formula. Official sources default to tier 1 if not specified.
      source_tier: Number(source?.tier) === 1 || Number(source?.tier) === 2 || Number(source?.tier) === 3
        ? Number(source.tier)
        : (String(source?.lane || "").trim() === "official" ? 1 : 2),
      content_kind: String(source?.content_kind || "article").trim().toLowerCase(),
      broker_source_id: source?.id || null,
      broker_source_family: source?.family || null,
      broker_source_endpoint: source?.endpoint || null,
    };
    if (itemAgeTooOldAtTime(itemBase, maxAgeHours, retrievedAt)) {
      diagnostics.stale_count += 1;
      continue;
    }
    const canonicalTag = assignCanonicalTopic(
      Array.isArray(source?.topic_tags) ? source.topic_tags : [],
      itemBase
    );
    if (canonicalTag) {
      items.push({ ...itemBase, tag: canonicalTag });
      diagnostics.retained_count += 1;
    }
  }
  return {
    items,
    diagnostics,
  };
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

function mergeTopicDiagnostics(topicDiagnostic, source, addedItems = []) {
  const target = topicDiagnostic || {};
  const lane = String(source?.lane || "").trim();
  target.lane_counts = target.lane_counts || {};
  target.lane_counts[lane] = (target.lane_counts[lane] || 0) + addedItems.length;
  target.source_counts = target.source_counts || {};
  target.source_counts[source.id] = (target.source_counts[source.id] || 0) + addedItems.length;
  target.item_count = Number(target.item_count || 0) + addedItems.length;
  target.article_item_count = Number(target.article_item_count || 0) + addedItems.filter((item) => item?.content_kind === "article").length;
  target.official_document_count = Number(target.official_document_count || 0) + addedItems.filter((item) => item?.content_kind !== "article").length;
  target.source_ids = Array.from(new Set([...(Array.isArray(target.source_ids) ? target.source_ids : []), source.id]));
  return target;
}

function createStandardTopicBrokerRuntime(options = {}) {
  const fs = options.fs || require("fs");
  const log = typeof options.log === "function" ? options.log : () => {};
  const fetchEndpoint = typeof options.fetchEndpoint === "function" ? options.fetchEndpoint : defaultFetchEndpoint;
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
    if (!topicTag || !PHASE1_TOPIC_TAGS.has(topicTag)) {
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
    const diagnostics = buildInitialDiagnostics(activeTopicTags);
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

      const parsedEntries = parseSourceBody(source, response);
      const normalized = buildNormalizedItemsForSource(
        {
          ...source,
          topic_tags: sourceTopicTags,
        },
        parsedEntries,
        {
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
        mergeTopicDiagnostics(diagnostics.topic_diagnostics[tag], source, itemsForTopic);
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
