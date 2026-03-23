"use strict";

const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");

const MAX_ARTICLE_AGE_HOURS = 48;
const TITLE_TOKEN_MIN_LENGTH = 4;
const TITLE_STOP_WORDS = new Set([
  "about",
  "amid",
  "after",
  "also",
  "been",
  "from",
  "into",
  "more",
  "most",
  "over",
  "says",
  "that",
  "than",
  "their",
  "them",
  "they",
  "this",
  "will",
  "with",
]);
const URL_SHAPE_KEYS = Object.freeze([
  "article_url",
  "homepage",
  "tag_page",
  "search_page",
  "listing_page",
  "document_file",
  "invalid",
]);
const DOCUMENT_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
]);
const LISTING_SEGMENTS = new Set([
  "news",
  "latest",
  "archive",
  "archives",
  "stories",
  "articles",
  "blog",
  "blogs",
  "press",
  "press-releases",
  "press-release",
  "insights",
  "opinion",
  "opinions",
  "authors",
  "author",
  "section",
  "sections",
]);
const TAG_SEGMENTS = new Set([
  "tag",
  "tags",
  "topic",
  "topics",
  "category",
  "categories",
]);

function createUrlShapeCounts() {
  return URL_SHAPE_KEYS.reduce((counts, key) => {
    counts[key] = 0;
    return counts;
  }, {});
}

function incrementCount(counts, key, amount = 1) {
  const bucket = String(key || "").trim() || "unknown";
  counts[bucket] = (counts[bucket] || 0) + Number(amount || 0);
  return counts;
}

function recordSample(samples, key, entry, maxEntries = 5) {
  if (!samples || !key || !entry) return;
  if (!Array.isArray(samples[key])) samples[key] = [];
  if (samples[key].length >= maxEntries) return;
  samples[key].push(entry);
}

function classifyUrlShape(value) {
  const raw = String(value || "").trim();
  if (!raw) return "invalid";
  try {
    const parsed = new URL(raw);
    const pathname = String(parsed.pathname || "/").toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : "";
    const searchValue = `${pathname} ${parsed.search}`.toLowerCase();
    const extensionIndex = lastSegment.lastIndexOf(".");
    const extension = extensionIndex >= 0 ? lastSegment.slice(extensionIndex) : "";

    if (DOCUMENT_FILE_EXTENSIONS.has(extension)) return "document_file";
    if (pathname === "/" || segments.length === 0) return "homepage";
    if (
      searchValue.includes("/search")
      || searchValue.includes("search?")
      || parsed.searchParams.has("q")
      || parsed.searchParams.has("query")
      || parsed.searchParams.has("search")
    ) {
      return "search_page";
    }
    if (segments.some((segment) => TAG_SEGMENTS.has(segment))) return "tag_page";
    if (
      segments.some((segment) => LISTING_SEGMENTS.has(segment))
      || pathname.includes("/page/")
    ) {
      return "listing_page";
    }
    return "article_url";
  } catch {
    return "invalid";
  }
}

function createConversionFunnel() {
  return {
    search_result_count: 0,
    citation_count: 0,
    search_result_url_shape_counts: createUrlShapeCounts(),
    citation_url_shape_counts: createUrlShapeCounts(),
    provider_empty_payload_count: 0,
    parse_error_count: 0,
    parsed_item_count: 0,
    provider_url_shape_counts: createUrlShapeCounts(),
    normalized_item_count: 0,
    normalized_url_shape_counts: createUrlShapeCounts(),
    evidence_url_replacement_count: 0,
    invalid_item_url_count: 0,
    unsupported_evidence_url_drop_count: 0,
    missing_headline_count: 0,
    missing_published_date_count: 0,
    stale_item_count: 0,
    canonicalization_invalid_url_count: 0,
    duplicate_headline_count: 0,
    duplicate_url_count: 0,
    retained_item_count: 0,
    retained_url_shape_counts: createUrlShapeCounts(),
    samples: {
      search_result_non_article_urls: [],
      provider_non_article_urls: [],
      evidence_resolution_drops: [],
      missing_published_date_items: [],
      stale_items: [],
      duplicate_items: [],
    },
  };
}

function mergeConversionFunnel(target, extra) {
  const base = target && typeof target === "object" ? target : createConversionFunnel();
  const incoming = extra && typeof extra === "object" ? extra : {};
  for (const key of [
    "search_result_count",
    "citation_count",
    "provider_empty_payload_count",
    "parse_error_count",
    "parsed_item_count",
    "normalized_item_count",
    "evidence_url_replacement_count",
    "invalid_item_url_count",
    "unsupported_evidence_url_drop_count",
    "missing_headline_count",
    "missing_published_date_count",
    "stale_item_count",
    "canonicalization_invalid_url_count",
    "duplicate_headline_count",
    "duplicate_url_count",
    "retained_item_count",
  ]) {
    base[key] = Number(base[key] || 0) + Number(incoming[key] || 0);
  }
  for (const key of [
    "search_result_url_shape_counts",
    "citation_url_shape_counts",
    "provider_url_shape_counts",
    "normalized_url_shape_counts",
    "retained_url_shape_counts",
  ]) {
    const counts = incoming[key] && typeof incoming[key] === "object" ? incoming[key] : {};
    for (const shapeKey of URL_SHAPE_KEYS) {
      base[key][shapeKey] = Number(base[key][shapeKey] || 0) + Number(counts[shapeKey] || 0);
    }
  }
  for (const sampleKey of Object.keys(base.samples || {})) {
    const entries = Array.isArray(incoming?.samples?.[sampleKey]) ? incoming.samples[sampleKey] : [];
    for (const entry of entries) recordSample(base.samples, sampleKey, entry);
  }
  return base;
}

function incrementUrlShapeCounts(counts, url, samples = null, sampleKey = "", metadata = null) {
  const shape = classifyUrlShape(url);
  incrementCount(counts, shape, 1);
  if (samples && shape !== "article_url") {
    recordSample(samples, sampleKey, {
      url: String(url || "").trim() || null,
      shape,
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    });
  }
  return shape;
}

function publishedDateTimestamp(item) {
  const pubDate = Date.parse(String(item?.published_date || ""));
  return Number.isFinite(pubDate) ? pubDate : null;
}

function hasVerifiedPublishedDate(item) {
  return publishedDateTimestamp(item) != null;
}

function articleAgeTooOld(item, maxAgeHours) {
  const limit = Number.isFinite(maxAgeHours) ? maxAgeHours : MAX_ARTICLE_AGE_HOURS;
  const now = Date.now();
  const pubDate = publishedDateTimestamp(item);
  if (!Number.isFinite(pubDate)) return true;
  return (now - pubDate) / (60 * 60 * 1000) > limit;
}

function parsePerplexityItems(content) {
  const cleaned = String(content || "")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/^json\s*/i, "")
    .trim();
  const candidates = [cleaned];
  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  if (firstArray !== -1 && lastArray > firstArray) {
    candidates.push(cleaned.slice(firstArray, lastArray + 1));
  }
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject !== -1 && lastObject > firstObject) {
    candidates.push(cleaned.slice(firstObject, lastObject + 1));
  }

  let lastError = null;
  for (const candidate of Array.from(new Set(candidates)).filter(Boolean)) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.items)) return parsed.items;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to parse Perplexity items");
}

function normalizeUrlMatchKey(value, stripSearch = false) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (stripSearch) parsed.search = "";
    return normalizeCanonicalUrl(parsed.toString());
  } catch {
    return normalizeCanonicalUrl(raw);
  }
}

function toEvidenceRecord(url, title = "") {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return {
      url: parsed.toString(),
      hostname: parsed.hostname,
      fullKey: normalizeUrlMatchKey(parsed.toString(), false),
      pathKey: normalizeUrlMatchKey(parsed.toString(), true),
      title: String(title || "").trim(),
    };
  } catch {
    return null;
  }
}

function buildEvidenceRecords(citations, searchResults) {
  const records = [];
  const seen = new Map();

  for (const citation of (Array.isArray(citations) ? citations : [])) {
    const record = toEvidenceRecord(citation);
    const dedupeKey = record?.pathKey || record?.fullKey;
    if (!record || seen.has(dedupeKey)) continue;
    seen.set(dedupeKey, record);
    records.push(record);
  }

  for (const result of (Array.isArray(searchResults) ? searchResults : [])) {
    const record = toEvidenceRecord(result?.url, result?.title);
    if (!record) continue;
    const dedupeKey = record.pathKey || record.fullKey;
    if (seen.has(dedupeKey)) {
      const existing = seen.get(dedupeKey);
      if (existing && !existing.title && record.title) existing.title = record.title;
      continue;
    }
    seen.set(dedupeKey, record);
    records.push(record);
  }

  return records;
}

function tokenizeHeadline(value) {
  return Array.from(new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= TITLE_TOKEN_MIN_LENGTH && !TITLE_STOP_WORDS.has(token))
  ));
}

function scoreTitleMatch(headline, title) {
  const headlineTokens = tokenizeHeadline(headline);
  if (headlineTokens.length === 0) return 0;
  const titleTokens = new Set(tokenizeHeadline(title));
  return headlineTokens.reduce((score, token) => score + (titleTokens.has(token) ? 1 : 0), 0);
}

function selectSameHostEvidence(item, evidenceRecords) {
  if (!Array.isArray(evidenceRecords) || evidenceRecords.length === 0) return null;
  if (evidenceRecords.length === 1) return evidenceRecords[0];

  const scored = evidenceRecords
    .map((record) => ({
      record,
      score: scoreTitleMatch(item?.headline, record?.title),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].record;
}

function resolveEvidenceBackedUrl(item, evidenceRecords) {
  const itemUrl = new URL(String(item?.url || ""));
  const exactFullKey = normalizeUrlMatchKey(itemUrl.toString(), false);
  const exactPathKey = normalizeUrlMatchKey(itemUrl.toString(), true);

  const exactMatch = evidenceRecords.find((record) => (
    (record.fullKey && record.fullKey === exactFullKey)
    || (record.pathKey && record.pathKey === exactPathKey)
  ));
  if (exactMatch) return exactMatch.url;

  const sameHostEvidence = evidenceRecords.filter((record) => record.hostname === itemUrl.hostname);
  const selected = selectSameHostEvidence(item, sameHostEvidence);
  return selected?.url || "";
}

function enrichWithCitationUrls(items, citations, searchResults, topicTag, log, diagnostics = null) {
  if (!Array.isArray(items)) return [];
  const evidenceRecords = buildEvidenceRecords(citations, searchResults);
  return items.map((item) => {
    if (!item?.url || item.url === "#") return { ...item, tag: topicTag };
    try {
      if (evidenceRecords.length === 0) return { ...item, tag: topicTag };
      const resolvedUrl = resolveEvidenceBackedUrl(item, evidenceRecords);
      if (resolvedUrl) {
        if (diagnostics && resolvedUrl !== item.url) {
          diagnostics.evidence_url_replacement_count += 1;
        }
        if (resolvedUrl !== item.url && typeof log === "function") {
          log(`ℹ️ Replaced unsupported ${topicTag} URL with evidence-backed URL: ${item.url} -> ${resolvedUrl}`);
        }
        return { ...item, url: resolvedUrl, tag: topicTag };
      }
    } catch (err) {
      if (diagnostics) diagnostics.invalid_item_url_count += 1;
      if (typeof log === "function") {
        log(`⚠️ Invalid item URL for ${topicTag}: ${err.message}`);
      }
      return null;
    }
    if (diagnostics) {
      diagnostics.unsupported_evidence_url_drop_count += 1;
      recordSample(diagnostics.samples, "evidence_resolution_drops", {
        headline: String(item?.headline || "").trim() || null,
        url: String(item?.url || "").trim() || null,
        shape: classifyUrlShape(item?.url),
      });
    }
    if (typeof log === "function") {
      log(`⚠️ Dropping ${topicTag} item with unsupported evidence URL: ${item.url}`);
    }
    return null;
  }).filter(Boolean);
}

function collectUniqueItems(items, seenHeadline, seenUrl, out, normalizeUrlForDedup, opts = {}) {
  const maxAgeHours = Number.isFinite(Number(opts?.maxAgeHours))
    ? Number(opts.maxAgeHours)
    : MAX_ARTICLE_AGE_HOURS;
  const requireVerifiedPublishedDate = opts?.requireVerifiedPublishedDate !== false;
  const diagnostics = opts?.diagnostics && typeof opts.diagnostics === "object" ? opts.diagnostics : null;
  for (const item of items) {
    if (!item || !item.headline) {
      if (diagnostics) diagnostics.missing_headline_count += 1;
      continue;
    }
    if (requireVerifiedPublishedDate && !hasVerifiedPublishedDate(item)) {
      if (diagnostics) {
        diagnostics.missing_published_date_count += 1;
        recordSample(diagnostics.samples, "missing_published_date_items", {
          headline: String(item?.headline || "").trim() || null,
          url: String(item?.url || "").trim() || null,
        });
      }
      continue;
    }
    if (articleAgeTooOld(item, maxAgeHours)) {
      if (diagnostics) {
        diagnostics.stale_item_count += 1;
        recordSample(diagnostics.samples, "stale_items", {
          headline: String(item?.headline || "").trim() || null,
          url: String(item?.url || "").trim() || null,
          published_date: String(item?.published_date || "").trim() || null,
        });
      }
      continue;
    }
    const headKey = String(item.headline || "").toLowerCase().trim().slice(0, 80);
    if (diagnostics && classifyUrlShape(item?.url) === "invalid" && String(item?.url || "").trim()) {
      diagnostics.canonicalization_invalid_url_count += 1;
    }
    const urlKey = normalizeUrlForDedup(item.url || "");
    if (headKey && seenHeadline.has(headKey)) {
      if (diagnostics) {
        diagnostics.duplicate_headline_count += 1;
        recordSample(diagnostics.samples, "duplicate_items", {
          reason: "duplicate_headline",
          headline: String(item?.headline || "").trim() || null,
          url: String(item?.url || "").trim() || null,
        });
      }
      continue;
    }
    if (urlKey && seenUrl.has(urlKey)) {
      if (diagnostics) {
        diagnostics.duplicate_url_count += 1;
        recordSample(diagnostics.samples, "duplicate_items", {
          reason: "duplicate_url",
          headline: String(item?.headline || "").trim() || null,
          url: String(item?.url || "").trim() || null,
        });
      }
      continue;
    }
    if (headKey) seenHeadline.add(headKey);
    if (urlKey) seenUrl.add(urlKey);
    out.push(item);
    if (diagnostics) {
      diagnostics.retained_item_count += 1;
      incrementUrlShapeCounts(diagnostics.retained_url_shape_counts, item?.url);
    }
    if (out.length >= 3) break;
  }
}

function shouldStopAttempts(topic, collected) {
  if (collected.length >= 3) return true;
  if (!topic?.isCustom && collected.length >= 2) return true;
  if (topic?.isCustom && collected.length >= 2) return true;
  return false;
}

module.exports = {
  parsePerplexityItems,
  enrichWithCitationUrls,
  collectUniqueItems,
  shouldStopAttempts,
  articleAgeTooOld,
  hasVerifiedPublishedDate,
  MAX_ARTICLE_AGE_HOURS,
  classifyUrlShape,
  createConversionFunnel,
  mergeConversionFunnel,
};
