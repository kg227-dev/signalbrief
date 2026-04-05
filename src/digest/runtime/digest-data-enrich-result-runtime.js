"use strict";

const IMPLICATION_TYPES = new Set([
  "cost",
  "competition",
  "regulation",
  "workflow",
  "structure",
  "demand",
  "capital",
  "other",
]);

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
  /\bthis is important because\b/i,
];
const REUSABLE_CATEGORY_PATTERN = /\bfor [a-z/& -]{2,50}(?:teams?|operators?|leaders?|companies|businesses), this matters for\b/i;
const BUSINESS_LEVER_PATTERN = /\b(pricing|price|margins?|demand|costs?|capex|valuation|market share|inventory|utilization|reimbursement|credit|funding|deposits?|loans?|load growth|capacity|lead times?|backlog|premium|throughput|traffic|fees?|fee income|spread|yield|workflow|turnover|churn|volume|gmv|burn|cash|opex|labor|mix|assortment|services?|ecosystem|distribution|footprint|conversion|productivity|contribution|share gains?)\b/i;
const COMPETITION_SIGNAL_PATTERN = /\b(competitive set|competition|competitor|rivals?|platform|assortment|bundled|consolidat(?:e|es|ed|ion)|footprint|ecosystem|share gains?)\b/i;
const INTERPRETATION_CUE_PATTERN = /\b(signals?|shifts?|tightens?|loosens?|resets?|raises?|lowers?|compress(?:es|ing)?|forces?|pushes?|puts?|reprices?|consolidates?|widens?|narrows?|accelerates?|delays?|reshapes?|hardens?|softens?|pulls?|locks?|redirects?|changes?|moves?|resets?)\b/i;
const HEDGE_PATTERN = /\b(could|may|might|potentially|possibly|appears to|seems to|suggests that)\b/i;
const JOURNALISM_PATTERN = /\baccording to\b|\bsaid\b|\breported\b/i;
const SELF_REJECTING_WIM_PATTERN = /\bno (?:strategic|operational|business) (?:shift|implication|implications?|value|relevance|decision context)\b|\bno (?:new|clear|obvious|direct) (?:regulatory|market|competitive|strategic) (?:action|event|shift|development)\b|\bthis is (?:an? )?(?:awards?|award announcement|press release|promotional|list|listing|roundup|directory)\b|\bthis (?:article|piece|story|post) (?:does not|doesn't) (?:represent|contain|offer|provide)\b|\bnot (?:a new|an? actionable)\b/i;
const CAPITALIZED_TOKEN_PATTERN = /\b(?:[A-Z]{2,}(?:\s+[A-Z]{2,})*|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
const QUANT_ANCHOR_PATTERN = /[$%]|\b\d[\d,.]*\b|\bQ[1-4]\b|\b(?:day|days|week|weeks|month|months|quarter|quarters|year|years)\b|\bby\s+20\d{2}\b/i;
const TITLE_STOPWORDS = new Set([
  "A",
  "An",
  "And",
  "As",
  "At",
  "But",
  "For",
  "From",
  "If",
  "In",
  "It",
  "Its",
  "Of",
  "On",
  "The",
  "This",
  "That",
  "These",
  "Those",
  "To",
  "Watch",
]);

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

function normalizeComparableText(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeImplicationType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return IMPLICATION_TYPES.has(normalized) ? normalized : null;
}

function hasNamedAnchor(text) {
  const matches = stripHtml(text).match(CAPITALIZED_TOKEN_PATTERN) || [];
  return matches.some((match) => !TITLE_STOPWORDS.has(String(match || "").trim()));
}

function leadingPhraseKey(value, words = 6) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return "";
  return normalized.split(" ").slice(0, words).join(" ");
}

function mergeRejectionReasons(existing, nextReasons) {
  return Array.from(new Set([
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(nextReasons) ? nextReasons : []),
  ]));
}

function validateStrategicWriteup(item, candidate = {}) {
  const reasons = [];
  const signalShift = stringOrNull(candidate?.signal_shift);
  const implicationType = normalizeImplicationType(candidate?.implication_type);
  const wimBrief = stringOrNull(candidate?.wim_brief);
  const wim = stringOrNull(candidate?.wim);
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const contextText = `${headline} ${summary}`.trim();

  if (!signalShift) reasons.push("missing_signal_shift");
  else {
    if (wordCount(signalShift) > 16) reasons.push("signal_shift_too_long");
    if (!hasNamedAnchor(signalShift) && !QUANT_ANCHOR_PATTERN.test(signalShift)) reasons.push("signal_shift_unanchored");
    if (overlapRatio(signalShift, contextText) >= 0.95) reasons.push("signal_shift_too_literal");
  }

  if (!implicationType) reasons.push("invalid_implication_type");

  if (!wimBrief) reasons.push("missing_wim_brief");
  else {
    if (splitSentences(wimBrief).length !== 1) reasons.push("brief_multi_sentence");
    if (wordCount(wimBrief) > 18) reasons.push("brief_too_long");
    if (GENERIC_WIM_PATTERNS.some((pattern) => pattern.test(wimBrief)) || REUSABLE_CATEGORY_PATTERN.test(wimBrief)) {
      reasons.push("brief_generic");
    }
    if (!hasNamedAnchor(wimBrief) && !QUANT_ANCHOR_PATTERN.test(wimBrief) && overlapRatio(wimBrief, contextText) >= 0.72) {
      reasons.push("brief_summary_like");
    }
  }

  if (!wim) {
    reasons.push("missing_wim");
  } else {
    const plain = stripHtml(wim);
    const sentences = splitSentences(plain);
    if (sentences.length < 1) reasons.push("too_short");
    if (sentences.length > 4) reasons.push("too_long");
    if (GENERIC_WIM_PATTERNS.some((pattern) => pattern.test(plain)) || REUSABLE_CATEGORY_PATTERN.test(plain)) {
      reasons.push("generic_language");
    }
    if (!INTERPRETATION_CUE_PATTERN.test(plain)) reasons.push("missing_interpretation");
    const hasLeverSignal = BUSINESS_LEVER_PATTERN.test(plain)
      || (implicationType === "competition" && COMPETITION_SIGNAL_PATTERN.test(plain));
    if (!hasLeverSignal && implicationType !== "regulation" && implicationType !== "workflow" && implicationType !== "other") {
      reasons.push("missing_business_lever");
    }
    if (!(hasNamedAnchor(plain) || QUANT_ANCHOR_PATTERN.test(plain))) reasons.push("missing_story_anchor");
    if (overlapRatio(plain, contextText) >= 0.74) reasons.push("summary_like");
    if (HEDGE_PATTERN.test(plain)) reasons.push("hedged");
    if (JOURNALISM_PATTERN.test(plain) && !INTERPRETATION_CUE_PATTERN.test(plain)) reasons.push("journalistic_tone");
    if (SELF_REJECTING_WIM_PATTERN.test(plain)) reasons.push("self_rejecting_wim");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function normalizeEnrichedItems(items, enriched, opts = {}) {
  const attemptCount = Math.max(1, Number(opts.writeupAttemptCount || 1));
  const passStatus = String(opts.writeupStatusOnPass || "model_pass").trim() || "model_pass";
  const diagnostics = [];
  const normalizedItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const candidate = enriched[index] || {};
    const baseScore = normalizeBaseScore(candidate.baseScore);
    const writeupCheck = opts.validateWriteups === false
      ? { ok: true, reasons: [] }
      : validateStrategicWriteup(item, candidate);
    const rejected = writeupCheck.ok !== true;
    const normalized = {
      ...item,
      signal_shift: stringOrNull(candidate.signal_shift),
      implication_type: normalizeImplicationType(candidate.implication_type),
      wim_brief: rejected ? null : stringOrNull(candidate.wim_brief),
      wim: rejected ? null : stringOrNull(candidate.wim),
      baseScore,
      strategic_value: normalizeStrategicValue(candidate.strategic_value, baseScore),
      content_flags: normalizeStringArray(candidate.content_flags),
      storyline_hints: normalizeStringArray(candidate.storyline_hints, 4),
      implications: null,
      watch_next: null,
      writeup_status: writeupCheck.ok ? passStatus : "failed_dropped",
      writeup_attempt_count: attemptCount,
      writeup_rejection_reasons: writeupCheck.reasons.slice(),
      writeup_version: "v2",
    };
    diagnostics.push({
      index,
      ok: writeupCheck.ok,
      reasons: writeupCheck.reasons.slice(),
    });
    return normalized;
  });

  return {
    items: normalizedItems,
    diagnostics,
  };
}

function applyBatchWriteupValidation(items = []) {
  const out = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
  const seenLeadByTopic = new Map();
  let repeatedPhraseRejectCount = 0;

  for (let index = 0; index < out.length; index += 1) {
    const item = out[index];
    if (!item) continue;
    const tag = String(item?.tag || "").trim().toUpperCase() || "__UNTAGGED__";
    const leadKey = leadingPhraseKey(item?.wim || item?.wim_brief || "");
    if (!leadKey) continue;
    if (!seenLeadByTopic.has(tag)) seenLeadByTopic.set(tag, new Map());
    const seenForTopic = seenLeadByTopic.get(tag);
    const priorIndex = seenForTopic.get(leadKey);
    if (typeof priorIndex === "number") {
      const nextReasons = mergeRejectionReasons(item?.writeup_rejection_reasons, ["repeated_lead_phrase"]);
      out[index] = {
        ...item,
        writeup_status: "failed_dropped",
        writeup_rejection_reasons: nextReasons,
      };
      repeatedPhraseRejectCount += 1;
      continue;
    }
    seenForTopic.set(leadKey, index);
  }

  return {
    items: out,
    repeatedPhraseRejectCount,
  };
}

module.exports = {
  parseJsonArrayLenient,
  normalizeEnrichedItems,
  validateStrategicWriteup,
  applyBatchWriteupValidation,
};
