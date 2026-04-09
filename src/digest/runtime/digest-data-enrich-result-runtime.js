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
const INTERPRETATION_CUE_PATTERN = /\b(signals?|shifts?|tightens?|loosens?|resets?|raises?|lowers?|compress(?:es|ing)?|forces?|pushes?|puts?|reprices?|consolidates?|widens?|narrows?|accelerates?|delays?|reshapes?|hardens?|softens?|pulls?|locks?|redirects?|changes?|moves?)\b/i;
const MECHANISM_CONNECTOR_PATTERN = /\b(by|through|via|because|as|which|forcing|driving|tightening|raising|lowering|reducing|increasing)\b/i;
const REQUIRED_LEVER_PATTERN = /\b(pricing|price|margin|margins|capex|competition|competitive|regulation|regulatory|operations|operational)\b/i;
const SYSTEM_ANCHOR_PATTERN = /\b(operator|system|platform|workflow|budget|rule|contract|buyer|seller|merchant|provider|payer|bank|retailer|manufacturer|marketplace|network|procurement|supply chain|facility|grid|distribution|pricing|margin|capex|compliance|operations?)\b/i;
const VAGUE_ACTOR_PATTERN = /\b(users?|people|consumers?|stakeholders?|everyone|market sentiment|sentiment|the market)\b/i;
const THEMATIC_COMMENTARY_PATTERN = /\b(sentiment|theme|narrative|mood|interest|buzz|conversation|discussion)\b/i;
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

function cleanModelText(raw) {
  return String(raw || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
}

function parseJsonArrayLenient(raw) {
  const cleaned = cleanModelText(raw);
  if (!cleaned) return [];
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("[");
    if (start === -1) throw err;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
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

function wordCount(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeComparableText(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function splitClauses(sentence) {
  return String(sentence || "")
    .split(/[,;:]|\s[-–—]\s|[-–—]/)
    .map((segment) => segment.trim())
    .filter((segment) => wordCount(segment) >= 3);
}

function isLikelyTruncatedJson(cleaned) {
  const source = String(cleaned || "");
  if (!source) return false;
  const openBraces = (source.match(/\{/g) || []).length;
  const closeBraces = (source.match(/\}/g) || []).length;
  const openBrackets = (source.match(/\[/g) || []).length;
  const closeBrackets = (source.match(/\]/g) || []).length;
  const quoteCount = (source.match(/"/g) || []).length;
  return openBraces !== closeBraces
    || openBrackets !== closeBrackets
    || (quoteCount % 2) === 1;
}

function classifyParseFailure(raw, validatorReasons = []) {
  const cleaned = cleanModelText(raw);
  if (!cleaned) return "empty_response";
  if (Array.isArray(validatorReasons) && validatorReasons.length > 0) return "validator_mismatch";
  return isLikelyTruncatedJson(cleaned) ? "truncation" : "malformed_json";
}

function parseJsonObjectLenient(raw) {
  const cleaned = cleanModelText(raw);
  if (!cleaned) {
    return {
      ok: false,
      cleaned,
      error: new Error("empty_response"),
      parseFailureType: "empty_response",
    };
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        cleaned,
        error: new Error("json_not_object"),
        parseFailureType: "validator_mismatch",
      };
    }
    return {
      ok: true,
      cleaned,
      value: parsed,
      parseFailureType: null,
    };
  } catch (error) {
    return {
      ok: false,
      cleaned,
      error,
      parseFailureType: classifyParseFailure(cleaned),
    };
  }
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

function normalizeExtractionOutput(candidate = {}) {
  return {
    what_happened: stringOrNull(candidate.what_happened),
    mechanism: stringOrNull(candidate.mechanism),
    who_it_impacts: stringOrNull(candidate.who_it_impacts),
    implication: stringOrNull(candidate.implication),
    confidence: ["high", "medium", "low"].includes(String(candidate.confidence || "").trim().toLowerCase())
      ? String(candidate.confidence).trim().toLowerCase()
      : null,
  };
}

function cloneReasonList(list) {
  return Array.isArray(list) ? list.slice() : [];
}

function validateExtractionOutput(item, candidate = {}) {
  const extraction = normalizeExtractionOutput(candidate);
  const reasons = [];
  const contextText = `${String(item?.headline || "")} ${String(item?.summary || "")}`.trim();
  const fields = ["what_happened", "mechanism", "who_it_impacts", "implication"];
  for (const field of fields) {
    const value = extraction[field];
    if (!value) {
      reasons.push(`missing_${field}`);
      continue;
    }
    if (splitSentences(value).length > 1 || wordCount(value) > 18) {
      reasons.push(`${field}_not_concise`);
    }
  }
  if (!extraction.confidence) reasons.push("invalid_confidence");
  if (extraction.mechanism && overlapRatio(extraction.mechanism, contextText) >= 0.95) {
    reasons.push("mechanism_too_literal");
  }
  return {
    ok: reasons.length === 0,
    reasons,
    output: extraction,
  };
}

function deriveWimBrief(wim) {
  const firstSentence = splitSentences(wim)[0] || "";
  if (!firstSentence) return null;
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, 18);
  if (!words.length) return null;
  const brief = words.join(" ").replace(/[.?!,:;]+$/, "");
  return brief ? `${brief}.` : null;
}

function validateStrategicWriteup(item, candidate = {}) {
  const hardReasons = [];
  const softReasons = [];
  const signalShift = stringOrNull(candidate?.signal_shift)
    || stringOrNull(candidate?.what_happened);
  const implicationType = normalizeImplicationType(candidate?.implication_type);
  const wim = stringOrNull(candidate?.wim);
  const wimBrief = stringOrNull(candidate?.wim_brief) || deriveWimBrief(wim);
  const mechanism = stringOrNull(candidate?.mechanism);
  const candidateTier = String(candidate?.candidate_tier || "").trim().toLowerCase();
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const contextText = `${headline} ${summary}`.trim();

  if (!signalShift) hardReasons.push("missing_signal_shift");
  if (!implicationType) hardReasons.push("invalid_implication_type");
  if (!wim) hardReasons.push("missing_wim");
  if (!wimBrief) softReasons.push("missing_wim_brief");

  if (!wim) {
    return {
      ok: false,
      reasons: [...hardReasons, ...softReasons],
      derivedBrief: wimBrief,
      validation_tier: "hard_fail",
      hard_failure_reasons: hardReasons,
      soft_failure_reasons: softReasons,
      minimum_viable_accept: false,
      accepted_without_repair: false,
      accepted_via_strong_tier_override: false,
    };
  }

  const plain = stripHtml(wim);
  const sentences = splitSentences(plain);
  if (sentences.length < 1) hardReasons.push("too_short");
  if (sentences.length > 2) softReasons.push("too_long");
  const clauseCounts = sentences.map((sentence) => splitClauses(sentence).length);
  if (clauseCounts.some((count) => count > 3)) {
    softReasons.push("sentence_clause_overload");
  }
  const namedAnchor = hasNamedAnchor(plain);
  const systemAnchor = SYSTEM_ANCHOR_PATTERN.test(plain);
  const quantAnchor = QUANT_ANCHOR_PATTERN.test(plain);
  const vagueActor = VAGUE_ACTOR_PATTERN.test(plain);
  const hasActorOrSystemAnchor = systemAnchor || quantAnchor || (namedAnchor && !vagueActor);
  const genericSignal = GENERIC_WIM_PATTERNS.some((pattern) => pattern.test(plain)) || REUSABLE_CATEGORY_PATTERN.test(plain);
  if (SELF_REJECTING_WIM_PATTERN.test(plain)) hardReasons.push("self_rejecting_wim");
  if (vagueActor && !namedAnchor && !systemAnchor) softReasons.push("vague_actor");
  if (THEMATIC_COMMENTARY_PATTERN.test(plain) && !hasActorOrSystemAnchor) {
    softReasons.push("thematic_commentary");
  }
  if (!REQUIRED_LEVER_PATTERN.test(plain)) softReasons.push("missing_lever");
  if (!hasActorOrSystemAnchor) {
    hardReasons.push("missing_operational_anchor");
  }
  const mechanismReferenced = mechanism
    ? overlapRatio(plain, mechanism) >= 0.15
    : MECHANISM_CONNECTOR_PATTERN.test(plain);
  if (!mechanismReferenced) softReasons.push("missing_mechanism");
  const descriptiveOnly = !INTERPRETATION_CUE_PATTERN.test(plain) || overlapRatio(plain, contextText) >= 0.78;
  if (descriptiveOnly) softReasons.push("descriptive_only");

  const hasConcreteImplication = implicationType != null || REQUIRED_LEVER_PATTERN.test(plain);
  const hasConcreteMechanism = mechanismReferenced || MECHANISM_CONNECTOR_PATTERN.test(plain);
  if (genericSignal && !hasConcreteMechanism && !hasConcreteImplication) {
    hardReasons.push("generic_language");
  } else if (genericSignal) {
    softReasons.push("generic_language");
  }

  const hasShippableImplication = implicationType != null
    && (implicationType !== "other" || REQUIRED_LEVER_PATTERN.test(plain));
  const readableEnough = sentences.length >= 1
    && sentences.length <= 2
    && clauseCounts.every((count) => count <= 3)
    && wordCount(plain) <= 42;
  const minimumViableAccept = hardReasons.length === 0
    && hasShippableImplication
    && hasActorOrSystemAnchor
    && !hardReasons.includes("generic_language")
    && readableEnough;

  const softUnique = Array.from(new Set(softReasons.filter((reason) => !hardReasons.includes(reason))));
  const hardUnique = Array.from(new Set(hardReasons));
  const acceptedViaStrongTierOverride = candidateTier === "strong"
    && hardUnique.length === 0
    && softUnique.length > 0
    && minimumViableAccept !== true;
  const acceptedWithoutRepair = minimumViableAccept === true;
  const validationTier = hardUnique.length > 0
    ? "hard_fail"
    : softUnique.length > 0
      ? "soft_fail"
      : "pass";
  const ok = validationTier === "pass"
    || acceptedWithoutRepair
    || acceptedViaStrongTierOverride;

  return {
    ok,
    reasons: [...hardUnique, ...softUnique],
    derivedBrief: wimBrief,
    validation_tier: validationTier,
    hard_failure_reasons: hardUnique,
    soft_failure_reasons: softUnique,
    minimum_viable_accept: minimumViableAccept,
    accepted_without_repair: acceptedWithoutRepair,
    accepted_via_strong_tier_override: acceptedViaStrongTierOverride,
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
      ? {
          ok: true,
          reasons: [],
          derivedBrief: stringOrNull(candidate.wim_brief) || deriveWimBrief(candidate.wim),
          validation_tier: "pass",
          hard_failure_reasons: [],
          soft_failure_reasons: [],
          minimum_viable_accept: true,
        }
      : validateStrategicWriteup(item, candidate);
    const rejected = writeupCheck.ok !== true;
    const normalized = {
      ...item,
      signal_shift: stringOrNull(candidate.signal_shift) || stringOrNull(candidate.what_happened),
      implication_type: normalizeImplicationType(candidate.implication_type),
      wim_brief: rejected ? null : writeupCheck.derivedBrief,
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
      writeup_version: "v3",
      validation_tier: writeupCheck.validation_tier || (writeupCheck.ok ? "pass" : "hard_fail"),
      minimum_viable_accept: writeupCheck.minimum_viable_accept === true,
      hard_failure_reasons: cloneReasonList(writeupCheck.hard_failure_reasons),
      soft_failure_reasons: cloneReasonList(writeupCheck.soft_failure_reasons),
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
  applyBatchWriteupValidation,
  cleanModelText,
  classifyParseFailure,
  deriveWimBrief,
  normalizeBaseScore,
  normalizeEnrichedItems,
  normalizeImplicationType,
  normalizeStrategicValue,
  normalizeStringArray,
  parseJsonArrayLenient,
  parseJsonObjectLenient,
  validateExtractionOutput,
  validateStrategicWriteup,
};
