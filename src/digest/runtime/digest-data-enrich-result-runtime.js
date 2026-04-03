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
const FALLBACK_TOPIC_GUIDANCE = Object.freeze({
  "HEALTHCARE": {
    role: "care-delivery leaders",
    levers: "reimbursement, labor cost, and care capacity",
    action: "capacity, reimbursement, and operating plans",
  },
  "LIFE SCIENCES": {
    role: "portfolio and commercial leads",
    levers: "regulatory timing, development risk, and commercial uptake",
    action: "launch timing, regulatory strategy, and portfolio assumptions",
  },
  "TECHNOLOGY": {
    role: "product and infrastructure leaders",
    levers: "product roadmaps, infrastructure demand, and competitive positioning",
    action: "roadmap, capacity, and pricing assumptions",
  },
  "ENERGY": {
    role: "commercial and operations teams",
    levers: "power pricing, project economics, and regulatory exposure",
    action: "project pacing, hedging, and regulatory assumptions",
  },
  "FINANCIAL SERVICES": {
    role: "finance and strategy teams",
    levers: "funding costs, compliance exposure, and revenue mix",
    action: "pricing, balance-sheet, and compliance plans",
  },
  "CONSUMER & RETAIL": {
    role: "merchandising and operating teams",
    levers: "demand, pricing power, inventory, and channel mix",
    action: "inventory, pricing, and channel plans",
  },
  "INDUSTRIALS": {
    role: "operations and supply-chain leaders",
    levers: "capacity, lead times, input costs, and throughput",
    action: "capacity, sourcing, and customer commitments",
  },
});
const INDEX_PAGE_PATTERN = /\b(frequently requested|what'?s new|queryresult|drug-specific and other records|companies that have not submitted)\b/i;
const SAFETY_NOTICE_PATTERN = /\b(alerts customers|warns consumers|recall|hidden drug ingredients|sterility issues|drug safety communication)\b/i;
const COMMENTARY_PATTERN = /(^|[\s"“])opinion:|\b(watch now|best noise-canceling|readers are buying|spring sale|get ready with me|music video|reporter goes up against|excerpt from)\b/i;

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

function truncateWords(value, maxWords) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function extractAnchorEntity(item) {
  const headline = stripHtml(item?.headline || "");
  const source = String(item?.source || item?.source_domain || "").trim();
  const acronymMatch = headline.match(/\b(?:[A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/);
  if (acronymMatch?.[0]) return acronymMatch[0];
  const properMatch = headline.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/);
  if (properMatch?.[0]) return properMatch[0];
  const domainMatch = source.match(/([a-z0-9-]+)\.[a-z]+$/i);
  if (domainMatch?.[1]) {
    return domainMatch[1]
      .split("-")
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return String(item?.tag || "SignalBrief");
}

function classifyFallbackShape(item) {
  const combined = `${stripHtml(item?.headline || "")} ${stripHtml(item?.summary || "")}`;
  if (INDEX_PAGE_PATTERN.test(combined)) return "index_page";
  if (SAFETY_NOTICE_PATTERN.test(combined)) return "safety_notice";
  if (COMMENTARY_PATTERN.test(combined)) return "commentary";
  return "standard";
}

function pickTopicGuidance(item) {
  return FALLBACK_TOPIC_GUIDANCE[String(item?.tag || "").trim().toUpperCase()]
    || {
      role: "operating teams",
      levers: "execution, economics, and competitive positioning",
      action: "near-term operating plans",
    };
}

function buildFallbackStrategicWriteup(item) {
  const guidance = pickTopicGuidance(item);
  const entity = extractAnchorEntity(item);
  const summary = stripHtml(item?.summary || "");
  const headline = stripHtml(item?.headline || "");
  const summaryComparable = normalizeComparableText(summary);
  const headlineComparable = normalizeComparableText(headline);
  const uniqueSummaryLead = summary && summaryComparable !== headlineComparable
    ? splitSentences(summary)[0] || summary
    : "";
  const shape = classifyFallbackShape(item);

  if (shape === "index_page") {
    return {
      wim_brief: truncateWords(`${entity} records page is reference material, not a market-moving signal.`, 18),
      wim: `<strong>${entity} is surfacing a records or compliance index rather than a market-moving story, which keeps the decision value low for ${guidance.levers} over the next 2 quarters.</strong> For ${guidance.role}, treat this as reference material unless it changes regulatory timing or compliance exposure in the next 2 quarters.`,
      implications: `For ${guidance.role}, only escalate this if it changes regulatory timing or compliance exposure for active programs.`,
      watch_next: null,
      writeup_fallback_reason: "index_page",
    };
  }

  if (shape === "safety_notice") {
    return {
      wim_brief: truncateWords(`${entity} safety action matters mainly for compliance, inventory, and near-term commercial risk.`, 18),
      wim: `<strong>${entity} is flagging a targeted safety or enforcement issue, which matters mainly for remediation cost, compliance exposure, and commercial risk in the next 2 quarters.</strong> For ${guidance.role}, isolate supplier, inventory, and customer exposure now because recalls and warning notices can quickly shift demand, cost, and execution plans.`,
      implications: `For ${guidance.role}, identify affected products, inventory, and compliance exposure before the next operating review.`,
      watch_next: null,
      writeup_fallback_reason: "safety_notice",
    };
  }

  if (shape === "commentary") {
    return {
      wim_brief: truncateWords(`${entity} is directional context, not a direct operating catalyst for decision-makers.`, 18),
      wim: `<strong>${entity} is offering commentary rather than announcing a hard-news catalyst, which lowers the immediate signal for ${guidance.levers} over the next 2 quarters.</strong> For ${guidance.role}, use it as directional context for ${guidance.action} only if it reinforces moves already showing up in customer, pricing, or regulatory data.`,
      implications: `For ${guidance.role}, treat this as context for current planning rather than a standalone trigger for action.`,
      watch_next: null,
      writeup_fallback_reason: "commentary",
    };
  }

  const lead = uniqueSummaryLead
    ? truncateWords(uniqueSummaryLead, 22)
    : `${entity} is changing the sector backdrop`;
  const leadSentence = /[.!?]$/.test(lead) ? lead : `${lead}.`;

  return {
    wim_brief: truncateWords(`${entity} raises near-term questions for ${guidance.levers}.`, 18),
    wim: `<strong>${leadSentence} This matters for ${guidance.levers} over the next 2 quarters.</strong> For ${guidance.role}, revisit ${guidance.action} now because this development can change capital, pricing, demand, or compliance assumptions faster than a routine sector update.`,
    implications: `For ${guidance.role}, test current ${guidance.action} against this development before the next planning cycle.`,
    watch_next: null,
    writeup_fallback_reason: "strategic_fallback",
  };
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
    const fallbackWriteup = buildFallbackStrategicWriteup(item);
    const normalized = {
      ...item,
      wim_brief: stringOrNull(candidate.wim_brief) || fallbackWriteup.wim_brief,
      wim: writeupCheck.ok ? stringOrNull(candidate.wim) : fallbackWriteup.wim,
      baseScore,
      strategic_value: normalizeStrategicValue(candidate.strategic_value, baseScore),
      content_flags: normalizeStringArray(candidate.content_flags),
      storyline_hints: normalizeStringArray(candidate.storyline_hints, 4),
      implications: stringOrNull(candidate.implications) || fallbackWriteup.implications,
      watch_next: stringOrNull(candidate.watch_next) || fallbackWriteup.watch_next,
      writeup_origin: writeupCheck.ok ? "model" : "fallback",
      writeup_validation_reasons: writeupCheck.reasons.slice(),
      writeup_fallback_reason: writeupCheck.ok ? null : fallbackWriteup.writeup_fallback_reason,
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
  buildFallbackStrategicWriteup,
};
