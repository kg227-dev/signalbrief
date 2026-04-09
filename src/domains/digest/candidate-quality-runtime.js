"use strict";

const SOURCE_TIER_ALIASES = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  premium: 1,
  strong: 2,
  standard: 3,
});

function computeItemAgeHours(item, nowMs = Date.now()) {
  const ts = item?.published_date || item?.published_at || item?.date || item?.timestamp;
  if (!ts) return Infinity;
  const publishedMs = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(publishedMs)) return Infinity;
  return Math.max(0, (nowMs - publishedMs) / (1000 * 60 * 60));
}

function splitByFreshnessTiers(items, nowMs = Date.now()) {
  const tier1 = [];
  const tier2 = [];
  const tier3 = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const age = computeItemAgeHours(item, nowMs);
    if (age <= 24) tier1.push(item);
    else if (age <= 48) tier2.push(item);
    else tier3.push(item);
  }
  return { tier1, tier2, tier3 };
}

function normalizeSourceTier(itemOrTier) {
  const rawTier = itemOrTier && typeof itemOrTier === "object" ? itemOrTier.source_tier : itemOrTier;
  const numeric = Number(rawTier);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const alias = SOURCE_TIER_ALIASES[String(rawTier || "").trim().toLowerCase()];
  return alias || null;
}

function isTrustedSourceTier(item) {
  const tier = normalizeSourceTier(item);
  return tier != null && tier <= 2;
}

function countTrustedSourceTier(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => isTrustedSourceTier(item)).length;
}

module.exports = {
  computeItemAgeHours,
  countTrustedSourceTier,
  isTrustedSourceTier,
  normalizeSourceTier,
  splitByFreshnessTiers,
};
