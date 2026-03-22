"use strict";

const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");

const MAX_ARTICLE_AGE_HOURS = 72;
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

function articleAgeTooOld(item, maxAgeHours) {
  const limit = Number.isFinite(maxAgeHours) ? maxAgeHours : MAX_ARTICLE_AGE_HOURS;
  const now = Date.now();
  const pubDate = Date.parse(String(item?.published_date || ""));
  if (Number.isFinite(pubDate)) {
    return (now - pubDate) / (60 * 60 * 1000) > limit;
  }
  const retrieved = Date.parse(String(item?.retrieved_at || ""));
  if (Number.isFinite(retrieved)) {
    return (now - retrieved) / (60 * 60 * 1000) > limit;
  }
  return false;
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

function enrichWithCitationUrls(items, citations, searchResults, topicTag, log) {
  if (!Array.isArray(items)) return [];
  const evidenceRecords = buildEvidenceRecords(citations, searchResults);
  return items.map((item) => {
    if (!item?.url || item.url === "#") return { ...item, tag: topicTag };
    try {
      if (evidenceRecords.length === 0) return { ...item, tag: topicTag };
      const resolvedUrl = resolveEvidenceBackedUrl(item, evidenceRecords);
      if (resolvedUrl) {
        if (resolvedUrl !== item.url && typeof log === "function") {
          log(`ℹ️ Replaced unsupported ${topicTag} URL with evidence-backed URL: ${item.url} -> ${resolvedUrl}`);
        }
        return { ...item, url: resolvedUrl, tag: topicTag };
      }
    } catch (err) {
      if (typeof log === "function") {
        log(`⚠️ Invalid item URL for ${topicTag}: ${err.message}`);
      }
      return null;
    }
    if (typeof log === "function") {
      log(`⚠️ Dropping ${topicTag} item with unsupported evidence URL: ${item.url}`);
    }
    return null;
  }).filter(Boolean);
}

function collectUniqueItems(items, seenHeadline, seenUrl, out, normalizeUrlForDedup) {
  for (const item of items) {
    if (!item || !item.headline) continue;
    if (articleAgeTooOld(item, MAX_ARTICLE_AGE_HOURS)) continue;
    const headKey = String(item.headline || "").toLowerCase().trim().slice(0, 80);
    const urlKey = normalizeUrlForDedup(item.url || "");
    if (headKey && seenHeadline.has(headKey)) continue;
    if (urlKey && seenUrl.has(urlKey)) continue;
    if (headKey) seenHeadline.add(headKey);
    if (urlKey) seenUrl.add(urlKey);
    out.push(item);
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
  MAX_ARTICLE_AGE_HOURS,
};
