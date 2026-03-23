"use strict";

const path = require("path");

const { resolveSignalBriefRuntimePaths } = require("./runtime-state-paths-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");
const { classifyUrlShape } = require("../digest/runtime/digest-data-fetch-items-runtime");

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 512_000;
const PHASE1_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "POLICY×REGULATORY",
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
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
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
  return String(value || "").trim().toUpperCase();
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

function readSanitizedJson(fs, filePath) {
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
  return {
    id,
    enabled: entry.enabled !== false,
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
  const compiled = sanitizePatternList(patterns)
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return (headline) => {
    if (compiled.length <= 0) return true;
    const text = String(headline || "").trim();
    return compiled.some((pattern) => pattern.test(text));
  };
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
    return urlShape === "article_url";
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
    if (!laneAcceptsShape(source, urlShape, url)) {
      diagnostics.non_article_count += 1;
      continue;
    }
    if (String(source?.lane || "").trim() === "official" && !matchesTitle(headline)) {
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
      summary: normalizeWhitespace(entry?.summary || entry?.description || headline),
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
      source_tier: String(source?.lane || "").trim() === "official" ? "strong" : "strong",
      content_kind: String(source?.content_kind || "article").trim().toLowerCase(),
      broker_source_id: source?.id || null,
      broker_source_family: source?.family || null,
      broker_source_endpoint: source?.endpoint || null,
    };
    if (itemAgeTooOldAtTime(itemBase, maxAgeHours, retrievedAt)) {
      diagnostics.stale_count += 1;
      continue;
    }
    for (const tag of (Array.isArray(source?.topic_tags) ? source.topic_tags : [])) {
      items.push({
        ...itemBase,
        tag,
      });
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
    const runtimeConfig = readSanitizedJson(fs, runtimeConfigPath);
    if (runtimeConfig) {
      return {
        source_mode: "runtime",
        active_path: runtimeConfigPath,
        runtime_path: runtimeConfigPath,
        bundled_path: bundledConfigPath,
        config: sanitizeBrokerConfig(runtimeConfig),
      };
    }
    const bundledConfig = readSanitizedJson(fs, bundledConfigPath);
    return {
      source_mode: "bundled",
      active_path: bundledConfigPath,
      runtime_path: runtimeConfigPath,
      bundled_path: bundledConfigPath,
      config: sanitizeBrokerConfig(bundledConfig || {}),
    };
  }

  function inspectStandardTopicBrokerConfig() {
    return readConfigSnapshot();
  }

  function loadStandardTopicBrokerConfig() {
    return readConfigSnapshot().config;
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
    fetchBrokerCandidates,
  };
}

module.exports = {
  createStandardTopicBrokerRuntime,
  sanitizeBrokerConfig,
};
