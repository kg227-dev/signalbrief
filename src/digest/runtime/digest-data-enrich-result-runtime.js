"use strict";

function parseJsonArrayLenient(raw) {
  const cleaned = String(raw || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();

  if (!cleaned) return [];

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("[");
    if (start === -1) throw err;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1));
        }
      }
    }

    throw err;
  }
}

function stringOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBaseScore(value) {
  return typeof value === "number" ? value : 5.0;
}

function normalizeEnrichedItems(items, enriched) {
  return items.map((item, index) => {
    const candidate = enriched[index] || {};
    return {
      ...item,
      wim_brief: stringOrNull(candidate.wim_brief),
      wim: stringOrNull(candidate.wim),
      baseScore: normalizeBaseScore(candidate.baseScore),
      implications: stringOrNull(candidate.implications),
      watch_next: stringOrNull(candidate.watch_next),
    };
  });
}

module.exports = {
  parseJsonArrayLenient,
  normalizeEnrichedItems,
};
