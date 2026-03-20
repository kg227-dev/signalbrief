"use strict";

const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");
const {
  normalizeMatchText,
  normalizeTopicToken,
} = require("../domain/topic-domain-runtime");

const REPEAT_TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "under",
  "with",
  "after",
  "amid",
  "first",
  "full",
  "fy",
  "fy26",
  "news",
  "report",
  "reports",
  "results",
  "sets",
  "update",
  "outlines",
  "announces",
  "announced",
  "expected",
]);

function normalizedHeadlineTokens(item) {
  return tokenizeRepeatText(`${item?.headline || ""} ${item?.summary || ""}`);
}

function orderedUnique(values = []) {
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

function tokenizeRepeatText(value) {
  return orderedUnique(
    normalizeMatchText(value)
      .split(" ")
      .map((token) => String(token || "").trim())
      .filter(Boolean)
      .filter((token) => token.length > 2)
      .filter((token) => !REPEAT_TOKEN_STOPWORDS.has(token))
      .filter((token) => !/^\d+$/.test(token))
  );
}

function headlineFingerprint(text, width = 140) {
  return normalizeMatchText(text).slice(0, width);
}

function normalizeFreshnessValue(value) {
  return normalizeTopicToken(value)
    .replace(/\bpolicy regulatory\b/g, "policy_regulatory")
    .replace(/\bm a\b/g, "m_a")
    .trim();
}

function resolvePrimaryEntityKey(item) {
  if (Array.isArray(item?.entity_keys) && item.entity_keys.length > 0) {
    return normalizeTopicToken(item.entity_keys[0]);
  }
  return normalizeTopicToken(item?.tag || "");
}

function buildFreshnessKey(item = {}) {
  const existing = normalizeFreshnessValue(item?.freshness_key || "");
  if (existing) return existing;

  const entityKeys = orderedUnique(
    (Array.isArray(item?.entity_keys) ? item.entity_keys : [])
      .map((value) => normalizeFreshnessValue(value))
      .filter(Boolean)
  ).slice(0, 2);
  const hintKeys = orderedUnique(
    (Array.isArray(item?.storyline_hints) ? item.storyline_hints : [])
      .map((value) => normalizeFreshnessValue(value))
      .filter(Boolean)
  ).slice(0, 3);
  const flagKeys = orderedUnique(
    (Array.isArray(item?.content_flags) ? item.content_flags : [])
      .map((value) => normalizeFreshnessValue(value))
      .filter(Boolean)
  ).slice(0, 2);
  const headlineTokens = normalizedHeadlineTokens(item)
    .map((value) => normalizeFreshnessValue(value))
    .filter(Boolean)
    .slice(0, 4);
  const tagKey = normalizeFreshnessValue(item?.tag || "");

  return orderedUnique([
    ...entityKeys,
    ...hintKeys,
    ...flagKeys,
    tagKey,
    ...headlineTokens,
  ]).slice(0, 8).join("|");
}

function buildSemanticRepeatSummary(item = {}) {
  const tokens = normalizedHeadlineTokens(item).slice(0, 10);
  const entityKey = resolvePrimaryEntityKey(item);
  const tagKey = normalizeTopicToken(item?.tag || "");
  const freshnessKey = buildFreshnessKey(item);
  const repeatKeyParts = [];
  if (entityKey) repeatKeyParts.push(entityKey);
  repeatKeyParts.push(...tokens.slice(0, 6));
  return {
    urlKey: normalizeCanonicalUrl(item?.url),
    headlineKey: headlineFingerprint(item?.headline),
    storylineKey: String(item?.storyline_key || "").trim(),
    freshnessKey,
    repeatKey: orderedUnique(repeatKeyParts).join("|"),
    entityKey,
    tagKey,
    tokens,
  };
}

function tokenJaccard(leftTokens = [], rightTokens = []) {
  const left = new Set(Array.isArray(leftTokens) ? leftTokens.filter(Boolean) : []);
  const right = new Set(Array.isArray(rightTokens) ? rightTokens.filter(Boolean) : []);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / new Set([...left, ...right]).size;
}

function buildSemanticRepeatIndex(items = []) {
  const recent = [];
  const urlKeys = new Set();
  const headlineKeys = new Set();
  const storylineKeys = new Set();
  const freshnessKeys = new Set();
  const repeatKeys = new Set();

  for (const item of (Array.isArray(items) ? items : [])) {
    const summary = buildSemanticRepeatSummary(item);
    recent.push(summary);
    if (summary.urlKey) urlKeys.add(summary.urlKey);
    if (summary.headlineKey) headlineKeys.add(summary.headlineKey);
    if (summary.storylineKey) storylineKeys.add(summary.storylineKey);
    if (summary.freshnessKey) freshnessKeys.add(summary.freshnessKey);
    if (summary.repeatKey) repeatKeys.add(summary.repeatKey);
  }

  return {
    recent,
    urlKeys,
    headlineKeys,
    storylineKeys,
    freshnessKeys,
    repeatKeys,
  };
}

function summariesLookLikeSameStory(left, right) {
  if (!left || !right) return false;
  if (left.urlKey && right.urlKey && left.urlKey === right.urlKey) return true;
  if (left.headlineKey && right.headlineKey && left.headlineKey === right.headlineKey) return true;
  if (left.storylineKey && right.storylineKey && left.storylineKey === right.storylineKey) return true;
  if (left.freshnessKey && right.freshnessKey && left.freshnessKey === right.freshnessKey) return true;
  if (left.repeatKey && right.repeatKey && left.repeatKey === right.repeatKey) return true;

  const overlap = tokenJaccard(left.tokens, right.tokens);
  const sameEntity = left.entityKey && right.entityKey && left.entityKey === right.entityKey;
  const sameTag = left.tagKey && right.tagKey && left.tagKey === right.tagKey;

  if (sameEntity && overlap >= 0.45) return true;
  if (sameTag && overlap >= 0.72) return true;
  return overlap >= 0.9;
}

function isSemanticRepeatItem(item, repeatIndex) {
  if (!repeatIndex || typeof repeatIndex !== "object") return false;
  const summary = buildSemanticRepeatSummary(item);
  const urlKeys = repeatIndex.urlKeys instanceof Set
    ? repeatIndex.urlKeys
    : new Set(Array.isArray(repeatIndex.urlKeys) ? repeatIndex.urlKeys : []);
  const headlineKeys = repeatIndex.headlineKeys instanceof Set
    ? repeatIndex.headlineKeys
    : new Set(Array.isArray(repeatIndex.headlineKeys) ? repeatIndex.headlineKeys : []);
  const storylineKeys = repeatIndex.storylineKeys instanceof Set
    ? repeatIndex.storylineKeys
    : new Set(Array.isArray(repeatIndex.storylineKeys) ? repeatIndex.storylineKeys : []);
  const freshnessKeys = repeatIndex.freshnessKeys instanceof Set
    ? repeatIndex.freshnessKeys
    : new Set(Array.isArray(repeatIndex.freshnessKeys) ? repeatIndex.freshnessKeys : []);
  const repeatKeys = repeatIndex.repeatKeys instanceof Set
    ? repeatIndex.repeatKeys
    : new Set(Array.isArray(repeatIndex.repeatKeys) ? repeatIndex.repeatKeys : []);

  if (summary.urlKey && urlKeys.has(summary.urlKey)) return true;
  if (summary.headlineKey && headlineKeys.has(summary.headlineKey)) return true;
  if (summary.storylineKey && storylineKeys.has(summary.storylineKey)) return true;
  if (summary.freshnessKey && freshnessKeys.has(summary.freshnessKey)) return true;
  if (summary.repeatKey && repeatKeys.has(summary.repeatKey)) return true;

  const recent = Array.isArray(repeatIndex.recent) ? repeatIndex.recent : [];
  return recent.some((candidate) => summariesLookLikeSameStory(summary, candidate));
}

function excludeSemanticRepeats(items = [], repeatIndex) {
  const kept = [];
  const removed = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (isSemanticRepeatItem(item, repeatIndex)) {
      removed.push(item);
      continue;
    }
    kept.push(item);
  }
  return {
    items: kept,
    removed,
  };
}

module.exports = {
  buildFreshnessKey,
  tokenizeRepeatText,
  buildSemanticRepeatSummary,
  buildSemanticRepeatIndex,
  summariesLookLikeSameStory,
  isSemanticRepeatItem,
  excludeSemanticRepeats,
};
