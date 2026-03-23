"use strict";

const { normalizeSourcePolicyDomain } = require("../../runtime/source-policy-registry-runtime");
const {
  MAX_ARTICLE_AGE_HOURS,
  articleAgeTooOld,
  classifyUrlShape,
  extractPublishedDateFromSearchResult,
  isOfficialLikeDomain,
  matchesDomain,
  normalizeSearchResultHeadline,
} = require("./digest-data-fetch-items-runtime");

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_FETCH_BYTES = 256_000;
const DEFAULT_STANDARD_MAX_URLS = 3;
const TECHNOLOGY_MAX_URLS = 5;
const TECHNOLOGY_EXTRA_TRUSTED_DOMAINS = Object.freeze([
  "techcrunch.com",
  "techtarget.com",
  "informationweek.com",
  "datacenterknowledge.com",
  "axios.com",
  "cio.com",
  "ciodive.com",
  "arstechnica.com",
  "wired.com",
  "theinformation.com",
  "nist.gov",
  "bis.gov",
]);
const ARTICLE_TYPE_PATTERN = /\b(article|newsarticle|report|analysisnewsarticle|blogposting)\b/i;
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const TITLE_TAG_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const JSON_LD_PATTERN = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")));
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

function findMetaContent(html, wantedKeys = []) {
  const wanted = new Set((Array.isArray(wantedKeys) ? wantedKeys : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return "";
  const tags = String(html || "").match(META_TAG_PATTERN) || [];
  for (const tag of tags) {
    const attrs = extractAttributes(tag);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").trim().toLowerCase();
    const content = normalizeWhitespace(attrs.content || attrs.value || "");
    if (!key || !content) continue;
    if (wanted.has(key)) return content;
  }
  return "";
}

function findCanonicalUrl(html) {
  const tags = String(html || "").match(LINK_TAG_PATTERN) || [];
  for (const tag of tags) {
    const attrs = extractAttributes(tag);
    const rel = String(attrs.rel || "").trim().toLowerCase();
    const href = String(attrs.href || "").trim();
    if (rel === "canonical" && href) return href;
  }
  return "";
}

function extractTitleTag(html) {
  const match = String(html || "").match(TITLE_TAG_PATTERN);
  return match ? stripTags(match[1]) : "";
}

function safeJsonParse(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function visitJson(value, visitor) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const entry of value) visitJson(entry, visitor);
    return;
  }
  if (typeof value !== "object") return;
  visitor(value);
  for (const nested of Object.values(value)) visitJson(nested, visitor);
}

function extractJsonLdMetadata(html) {
  let headline = "";
  let publishedDate = "";
  let canonicalUrl = "";
  const matches = String(html || "").matchAll(JSON_LD_PATTERN);
  for (const match of matches) {
    const payload = String(match?.[1] || "").trim()
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "");
    if (!payload) continue;
    const parsed = safeJsonParse(payload);
    if (!parsed) continue;
    visitJson(parsed, (node) => {
      const typeValue = Array.isArray(node?.["@type"]) ? node["@type"].join(" ") : String(node?.["@type"] || "");
      const isArticleLike = ARTICLE_TYPE_PATTERN.test(typeValue)
        || Boolean(node?.headline)
        || Boolean(node?.datePublished);
      if (!isArticleLike) return;
      if (!headline && node?.headline) headline = stripTags(node.headline);
      if (!publishedDate && node?.datePublished) {
        const parsedDate = Date.parse(String(node.datePublished || ""));
        if (Number.isFinite(parsedDate)) publishedDate = new Date(parsedDate).toISOString();
      }
      if (!canonicalUrl && node?.url) canonicalUrl = String(node.url || "").trim();
    });
  }
  return {
    headline,
    publishedDate,
    canonicalUrl,
  };
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

function allowedTrustedDomain(domain, opts = {}) {
  const normalizedDomain = normalizeSourcePolicyDomain(domain);
  if (!normalizedDomain) return false;
  const preferredDomains = Array.isArray(opts?.preferredDomains) ? opts.preferredDomains : [];
  const reportedDomains = Array.isArray(opts?.reportedDomains) ? opts.reportedDomains : [];
  const officialDomains = Array.isArray(opts?.officialDomains) ? opts.officialDomains : [];
  const extraDomains = Array.isArray(opts?.extraTrustedDomains) ? opts.extraTrustedDomains : [];
  if (preferredDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) return true;
  if (reportedDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) return true;
  if (officialDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) return true;
  if (extraDomains.some((candidate) => matchesDomain(normalizedDomain, candidate))) return true;
  return isOfficialLikeDomain(normalizedDomain);
}

function candidateScore(searchResult, opts = {}) {
  const url = String(searchResult?.url || "").trim();
  let hostname = "";
  try {
    hostname = normalizeSourcePolicyDomain(new URL(url).hostname);
  } catch {
    hostname = "";
  }
  if (!hostname) return -Infinity;
  let score = 0;
  if (Array.isArray(opts?.preferredDomains) && opts.preferredDomains.some((candidate) => matchesDomain(hostname, candidate))) score += 6;
  if (Array.isArray(opts?.officialDomains) && opts.officialDomains.some((candidate) => matchesDomain(hostname, candidate))) score += 5;
  if (Array.isArray(opts?.reportedDomains) && opts.reportedDomains.some((candidate) => matchesDomain(hostname, candidate))) score += 4;
  if (Array.isArray(opts?.extraTrustedDomains) && opts.extraTrustedDomains.some((candidate) => matchesDomain(hostname, candidate))) score += 3;
  if (isOfficialLikeDomain(hostname)) score += 2;
  if (extractPublishedDateFromSearchResult(searchResult)) score += 1;
  if (normalizeSearchResultHeadline(searchResult?.title || "")) score += 1;
  return score;
}

function selectCandidateSearchResults(searchResults, opts = {}) {
  const maxUrls = Math.max(1, Number(opts?.maxUrls || DEFAULT_STANDARD_MAX_URLS));
  const out = [];
  const seen = new Set();
  for (const result of (Array.isArray(searchResults) ? searchResults : [])
    .filter((entry) => classifyUrlShape(entry?.url) === "article_url")
    .filter((entry) => {
      try {
        return allowedTrustedDomain(new URL(String(entry?.url || "")).hostname, opts);
      } catch {
        return false;
      }
    })
    .map((entry) => ({ entry, score: candidateScore(entry, opts) }))
    .sort((left, right) => right.score - left.score)) {
    const url = String(result?.entry?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(result.entry);
    if (out.length >= maxUrls) break;
  }
  return out;
}

async function defaultFetchUrl(url, opts = {}) {
  const timeoutMs = Math.max(1_000, Number(opts?.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxBytes = Math.max(8_192, Number(opts?.maxBytes || DEFAULT_MAX_FETCH_BYTES));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(url || ""), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "SignalBriefBot/1.0 (+https://getsignalbrief.com)",
      },
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok) {
      return {
        ok: false,
        status: Number(response.status || 0),
        url: String(response.url || url || "").trim(),
        contentType,
        html: "",
      };
    }
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        ok: false,
        status: Number(response.status || 0),
        url: String(response.url || url || "").trim(),
        contentType,
        html: "",
      };
    }
    const html = String(await response.text() || "").slice(0, maxBytes);
    return {
      ok: true,
      status: Number(response.status || 0),
      url: String(response.url || url || "").trim(),
      contentType,
      html,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: String(url || "").trim(),
      contentType: "",
      html: "",
      error: String(error?.message || error || "fetch failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractResolvedMetadata(fetchResult, searchResult) {
  const html = String(fetchResult?.html || "");
  const resolvedUrl = String(fetchResult?.url || searchResult?.url || "").trim();
  const jsonLd = extractJsonLdMetadata(html);
  const canonicalFromHtml = normalizeAbsoluteUrl(
    findCanonicalUrl(html) || findMetaContent(html, ["og:url"]),
    resolvedUrl
  );
  const finalUrl = canonicalFromHtml && classifyUrlShape(canonicalFromHtml) === "article_url"
    ? canonicalFromHtml
    : resolvedUrl;
  const headline = normalizeSearchResultHeadline(
    findMetaContent(html, ["og:title", "twitter:title"])
      || jsonLd.headline
      || extractTitleTag(html)
      || searchResult?.title
  );
  const publishedDate = (() => {
    const raw = findMetaContent(html, [
      "article:published_time",
      "datepublished",
      "publishdate",
      "pubdate",
      "dc.date",
      "dc.date.issued",
      "sailthru.date",
      "parsely-pub-date",
    ]);
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    if (jsonLd.publishedDate) return jsonLd.publishedDate;
    return extractPublishedDateFromSearchResult(searchResult);
  })();
  return {
    finalUrl,
    headline,
    publishedDate,
  };
}

function createDigestSearchEvidenceResolverRuntime(deps = {}) {
  const fetchUrl = typeof deps.fetchUrl === "function" ? deps.fetchUrl : defaultFetchUrl;
  const log = typeof deps.log === "function" ? deps.log : () => {};

  async function resolveSearchEvidenceUrls(searchResults, opts = {}) {
    const topicTag = String(opts?.topicTag || "").trim().toUpperCase();
    const maxAgeHours = Number.isFinite(Number(opts?.maxAgeHours)) ? Number(opts.maxAgeHours) : MAX_ARTICLE_AGE_HOURS;
    const maxUrls = topicTag === "TECHNOLOGY" ? TECHNOLOGY_MAX_URLS : DEFAULT_STANDARD_MAX_URLS;
    const extraTrustedDomains = topicTag === "TECHNOLOGY"
      ? TECHNOLOGY_EXTRA_TRUSTED_DOMAINS.slice()
      : [];
    const selected = selectCandidateSearchResults(searchResults, {
      preferredDomains: Array.isArray(opts?.preferredDomains) ? opts.preferredDomains : [],
      reportedDomains: Array.isArray(opts?.reportedDomains) ? opts.reportedDomains : [],
      officialDomains: Array.isArray(opts?.officialDomains) ? opts.officialDomains : [],
      extraTrustedDomains,
      maxUrls,
    });
    const diagnostics = {
      attempt_count: selected.length,
      success_count: 0,
      parse_failure_count: 0,
      stale_count: 0,
      non_article_drop_count: 0,
      fetch_failure_count: 0,
      resolved_urls: [],
      failed_urls: [],
    };
    const items = [];
    for (const searchResult of selected) {
      const fetchResult = await fetchUrl(searchResult?.url, {
        timeoutMs: opts?.timeoutMs,
        maxBytes: opts?.maxBytes,
      });
      if (!fetchResult?.ok) {
        diagnostics.fetch_failure_count += 1;
        if (diagnostics.failed_urls.length < 5) diagnostics.failed_urls.push(String(searchResult?.url || "").trim() || null);
        continue;
      }
      const metadata = extractResolvedMetadata(fetchResult, searchResult);
      if (!metadata.finalUrl || classifyUrlShape(metadata.finalUrl) !== "article_url") {
        diagnostics.non_article_drop_count += 1;
        continue;
      }
      if (!metadata.headline || !metadata.publishedDate) {
        diagnostics.parse_failure_count += 1;
        if (diagnostics.failed_urls.length < 5) diagnostics.failed_urls.push(String(metadata.finalUrl || searchResult?.url || "").trim() || null);
        continue;
      }
      const sourceDomain = normalizeSourcePolicyDomain(new URL(metadata.finalUrl).hostname);
      const item = {
        headline: metadata.headline,
        summary: normalizeWhitespace(searchResult?.snippet || searchResult?.description || metadata.headline),
        source: sourceDomain,
        source_domain: sourceDomain,
        url: metadata.finalUrl,
        retrieval_original_url: String(searchResult?.url || "").trim() || metadata.finalUrl,
        published_date: metadata.publishedDate,
        tag: topicTag || null,
        retrieved_at: String(opts?.retrievedAt || "").trim() || new Date().toISOString(),
        retrieval_pass: `${String(opts?.passName || "broad").trim() || "broad"}_evidence_resolver`,
        retrieval_from_search_evidence: true,
        retrieval_from_evidence_resolver: true,
        search_result_title: String(searchResult?.title || "").trim() || null,
        preferred_source_available_in_search: Array.isArray(opts?.preferredDomains)
          && opts.preferredDomains.some((candidate) => matchesDomain(sourceDomain, candidate)),
      };
      if (articleAgeTooOld(item, maxAgeHours)) {
        diagnostics.stale_count += 1;
        continue;
      }
      diagnostics.success_count += 1;
      if (diagnostics.resolved_urls.length < 5) diagnostics.resolved_urls.push(item.url);
      items.push(item);
    }
    if (items.length > 0) {
      log(`ℹ️ Resolved ${items.length}/${selected.length} trusted search evidence URL(s) for ${topicTag || "topic"}`);
    }
    return {
      items,
      diagnostics,
    };
  }

  return {
    resolveSearchEvidenceUrls,
  };
}

module.exports = {
  createDigestSearchEvidenceResolverRuntime,
  defaultFetchUrl,
  extractResolvedMetadata,
};
