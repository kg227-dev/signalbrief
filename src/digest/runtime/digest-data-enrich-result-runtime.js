"use strict";

const GENERIC_WIM_PATTERNS = [
  /\bcould have (?:significant )?implications\b/i,
  /\bmay affect\b/i,
  /\bworth watching\b/i,
  /\bmonitor developments\b/i,
  /\bthis highlights\b/i,
  /\bthis underscores\b/i,
  /\bstakeholders\b/i,
  /\bindustry broadly\b/i,
  /\bkeep an eye on\b/i,
];
const BUSINESS_LEVER_PATTERN = /\b(pricing|price|margin|demand|cost|capex|valuation|market share|inventory|utilization|reimbursement|credit|funding|deposits?|loans?|load growth|capacity|lead times?|backlog|premium|throughput|traffic|fee income|spread|yield)\b/i;
const ROLE_SENTENCE_PATTERN = /(^|[.!?]\s+)For [A-Za-z][A-Za-z/& -]{1,40},/;
const PROPER_NOUN_PATTERN = /\b(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/;
const QUANT_ANCHOR_PATTERN = /[$%]|\b\d[\d,.]*\b|\bnext\s+\d+\s+(?:day|days|week|weeks|month|months|quarter|quarters)\b|\bQ[1-4]\b|\bby\s+20\d{2}\b/i;

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

function normalizeStrategicValue(value, fallbackBaseScore = 5) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(1, numeric));
  return Math.max(0, Math.min(1, Number(fallbackBaseScore || 0) / 10));
}

function normalizeStringArray(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function overlapRatio(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function splitSentences(value) {
  return stripHtml(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function validateStrategicWriteup(item, candidate = {}) {
  const reasons = [];
  const wim = stringOrNull(candidate?.wim);
  if (!wim) {
    reasons.push("missing_wim");
    return { ok: false, reasons };
  }

  const plain = stripHtml(wim);
  const sentences = splitSentences(plain);
  const contextText = `${item?.headline || ""} ${item?.summary || ""}`.trim();

  if (sentences.length < 2) reasons.push("too_short");
  if (!BUSINESS_LEVER_PATTERN.test(plain)) reasons.push("missing_business_lever");
  if (!ROLE_SENTENCE_PATTERN.test(plain)) reasons.push("missing_role_sentence");
  if (!(PROPER_NOUN_PATTERN.test(plain) || QUANT_ANCHOR_PATTERN.test(plain))) reasons.push("missing_anchor");
  if (GENERIC_WIM_PATTERNS.some((pattern) => pattern.test(plain))) reasons.push("generic_language");
  if (overlapRatio(plain, contextText) >= 0.72) reasons.push("summary_like");

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function normalizeEnrichedItems(items, enriched, opts = {}) {
  const diagnostics = [];
  return items.map((item, index) => {
    const candidate = enriched[index] || {};
    const baseScore = normalizeBaseScore(candidate.baseScore);
    const writeupCheck = opts.validateWriteups === true
      ? validateStrategicWriteup(item, candidate)
      : { ok: true, reasons: [] };
    const normalized = {
      ...item,
      wim_brief: stringOrNull(candidate.wim_brief),
      wim: writeupCheck.ok ? stringOrNull(candidate.wim) : null,
      baseScore,
      strategic_value: normalizeStrategicValue(candidate.strategic_value, baseScore),
      content_flags: normalizeStringArray(candidate.content_flags),
      storyline_hints: normalizeStringArray(candidate.storyline_hints, 4),
      implications: stringOrNull(candidate.implications),
      watch_next: stringOrNull(candidate.watch_next),
    };
    diagnostics.push({
      index,
      ok: writeupCheck.ok,
      reasons: writeupCheck.reasons.slice(),
      had_wim_brief: normalized.wim_brief != null,
    });
    return normalized;
  });
}

module.exports = {
  parseJsonArrayLenient,
  normalizeEnrichedItems,
  validateStrategicWriteup,
};
