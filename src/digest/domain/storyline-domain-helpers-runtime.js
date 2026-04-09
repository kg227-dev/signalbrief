"use strict";

const {
  normalizeMatchText,
} = require("../../runtime/topic-normalization-runtime");

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function stripHtml(value) {
  return String(value || "").replace(/<\/?[^>]+>/g, " ");
}

function uniqSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
}

function uniqPreserveOrder(values) {
  const seen = new Set();
  const out = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function tokenSet(value) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function jaccard(aValues, bValues) {
  const a = new Set(Array.isArray(aValues) ? aValues : aValues instanceof Set ? Array.from(aValues) : []);
  const b = new Set(Array.isArray(bValues) ? bValues : bValues instanceof Set ? Array.from(bValues) : []);
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function headlineTrigramOverlap(leftItem, rightItem) {
  const leftWords = normalizeMatchText(leftItem?.headline || "").split(" ").filter((t) => t.length >= 3);
  const rightWords = normalizeMatchText(rightItem?.headline || "").split(" ").filter((t) => t.length >= 3);
  if (leftWords.length < 3 || rightWords.length < 3) return 0;
  const trigrams = (words) => {
    const set = new Set();
    for (let i = 0; i <= words.length - 3; i++) {
      set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    return set;
  };
  return jaccard(trigrams(leftWords), trigrams(rightWords));
}

function appendUniqueCode(list, code) {
  const normalized = String(code || "").trim();
  if (!normalized) return Array.isArray(list) ? list : [];
  const next = Array.isArray(list) ? list.slice() : [];
  if (!next.includes(normalized)) next.push(normalized);
  return next;
}

module.exports = {
  appendUniqueCode,
  clamp,
  headlineTrigramOverlap,
  jaccard,
  stripHtml,
  tokenSet,
  uniqPreserveOrder,
  uniqSorted,
};
