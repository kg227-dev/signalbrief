"use strict";

const { STANDARD_TOPIC_BROKER_DEFAULTS } = require("../platform/config/provider-defaults");
const { classifyUrlShape } = require("../digest/runtime/digest-data-fetch-items-runtime");
const { normalizeSourcePolicyDomain } = require("./source-policy-registry-runtime");

const MONTH_PATTERN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const HUMAN_DATE_RE = new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2},\\s+\\d{4}\\b`, "ig");
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
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

function safeJsonParse(rawValue) {
  try {
    return JSON.parse(String(rawValue || ""));
  } catch {
    return null;
  }
}

function pickFirstDomain(domains, endpoint) {
  const list = Array.isArray(domains) ? domains : [];
  if (list.length > 0) return normalizeSourcePolicyDomain(list[0]);
  if (endpoint) return normalizeSourcePolicyDomain(new URL(endpoint).hostname);
  return "";
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
  const timeoutMs = Math.max(1_000, Number(opts?.timeoutMs || STANDARD_TOPIC_BROKER_DEFAULTS.timeoutMs));
  const maxBytes = Math.max(8_192, Number(opts?.maxBytes || STANDARD_TOPIC_BROKER_DEFAULTS.maxBytes));
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
    if (parsed.search) {
      const navParams = ["page", "offset", "p", "q", "query", "search", "filter", "category", "tag"];
      if (navParams.some((key) => parsed.searchParams.has(key))) return false;
    }
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
  const assignCanonicalTopic = typeof opts?.assignCanonicalTopic === "function"
    ? opts.assignCanonicalTopic
    : () => null;
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

module.exports = {
  buildInitialDiagnostics,
  buildNormalizedItemsForSource,
  defaultFetchEndpoint,
  mergeTopicDiagnostics,
  parseSourceBody,
  pickFirstDomain,
  sanitizePatternList,
};
