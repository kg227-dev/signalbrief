"use strict";

function sanitizePromptField(value, maxLength) {
  if (value == null) return null;
  return String(value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function mapPromptItem(item = {}) {
  return {
    headline: sanitizePromptField(item?.headline, 220),
    summary: sanitizePromptField(item?.summary, 520),
    tag: sanitizePromptField(item?.tag, 60),
    source: sanitizePromptField(item?.source || item?.source_domain, 100),
    source_tier: sanitizePromptField(item?.source_tier, 20),
    source_type: sanitizePromptField(item?.source_type, 40),
    published_date: sanitizePromptField(item?.published_date || item?.published_at, 40),
    topic_fit: item?.topic_fit != null ? Number(item.topic_fit) : null,
    strategic_value: item?.strategic_value != null ? Number(item.strategic_value) : null,
    failed_writeup_reasons: Array.isArray(item?.failed_writeup_reasons)
      ? item.failed_writeup_reasons.map((reason) => sanitizePromptField(reason, 60)).filter(Boolean)
      : [],
    prior_wim: sanitizePromptField(item?.prior_wim, 520),
    prior_wim_brief: sanitizePromptField(item?.prior_wim_brief, 180),
  };
}

function buildDigestDataExtractionPrompt(item) {
  return `Extract key facts from this article.

Return ONLY valid JSON:

{
  "what_happened": "...",
  "mechanism": "...",
  "who_it_impacts": "...",
  "implication": "...",
  "confidence": "high | medium | low"
}

Rules:
- Be specific and concrete
- Do not generalize
- Do not add information not present
- Keep each field concise (1 clause)
- Focus on mechanism, not description
- No text outside JSON

Article:
${JSON.stringify(mapPromptItem(item), null, 2)}`;
}

function buildDigestDataFormattingRetryPrompt(rawResponse) {
  return `Return ONLY valid JSON. Fix formatting. No extra text.

Previous response:
${String(rawResponse || "").slice(0, 4000)}`;
}

function buildDigestDataWimPrompt(item, extraction) {
  const actor = sanitizePromptField(extraction?.who_it_impacts, 180) || "the named operator or system";
  return `Using the structured inputs below, write a "Why it matters".

Valid patterns:
1. What changed -> mechanism -> implication
2. Observed shift -> implication -> who it impacts

Constraints:
- Maximum 2 sentences
- Maximum 2 clauses per sentence
- Must include a concrete business or strategic implication
- Must include at least one: decision, tradeoff, constraint, or shift in leverage
- Must include at least one concrete lever: pricing, margin, capex, competition, regulation, or operations
- Avoid generic phrases ("this highlights", "this underscores")
- Avoid abstract commentary without a clear operator or system
- Avoid vague actors like "users", "people", "market sentiment", or "the market"
- Prefer concrete mechanisms over summaries
- Prefer clarity over density

Bad example:
"AI sentiment is shifting and companies may need to respond"

Good example:
"AI coding tools are now viewed as a source of fragility, forcing companies to trade off development speed against code reliability and QA overhead"

Return ONLY valid JSON:
{
  "wim": "..."
}

Article:
${JSON.stringify(mapPromptItem(item), null, 2)}

Input:
what_happened: ${sanitizePromptField(extraction?.what_happened, 220) || ""}
mechanism: ${sanitizePromptField(extraction?.mechanism, 220) || ""}
who_it_impacts: ${actor}
implication: ${sanitizePromptField(extraction?.implication, 220) || ""}`;
}

function buildDigestDataWimRepairPrompt(item, extraction, failureReasons = [], priorWim = "") {
  const reasons = Array.isArray(failureReasons) ? failureReasons.filter(Boolean) : [];
  const hasSimplify = reasons.includes("sentence_clause_overload");
  return `Rewrite this "Why it matters" so it passes validation.

If generic:
Rewrite with a concrete business implication and specific actor or system.
If not strategic:
Focus on market, competitive, operational, or capital allocation impact.
If too long:
Reduce to 2 sentences while preserving mechanism and implication.
If missing mechanism:
Make the causal mechanism explicit, not just the outcome.
If overloaded:
Simplify while preserving mechanism and implication.

Hard constraints:
- Return ONLY valid JSON: { "wim": "..." }
- Max 2 sentences
- Max 2 clauses per sentence
- Must include mechanism + implication
- Must include at least one concrete lever: pricing, margin, capex, competition, regulation, or operations
- Must anchor to a concrete actor or system
- No vague actors
- No generic filler

Validation failures to fix:
${JSON.stringify(reasons, null, 2)}

Previous WIM:
${sanitizePromptField(priorWim, 1200) || ""}

Article:
${JSON.stringify(mapPromptItem(item), null, 2)}

Structured extraction:
${JSON.stringify({
  what_happened: sanitizePromptField(extraction?.what_happened, 220),
  mechanism: sanitizePromptField(extraction?.mechanism, 220),
  who_it_impacts: sanitizePromptField(extraction?.who_it_impacts, 220),
  implication: sanitizePromptField(extraction?.implication, 220),
  confidence: sanitizePromptField(extraction?.confidence, 20),
}, null, 2)}

Priority:
${hasSimplify ? "Simplify while preserving mechanism and implication." : "Preserve mechanism and implication while fixing the listed failures."}`;
}

function buildDigestDataWimFallbackPrompt(item, extraction, failureReasons = [], priorWim = "") {
  const reasons = Array.isArray(failureReasons) ? failureReasons.filter(Boolean) : [];
  return `Write a backup "Why it matters" for this item.

This is a recovery pass after earlier writeup failures. Keep the same quality bar, but prioritize returning a concrete, usable business implication.

Hard constraints:
- Return ONLY valid JSON: { "wim": "..." }
- Keep it concise
- Include a clear mechanism
- Include a concrete business, regulatory, operational, competitive, or capital implication
- Anchor to a real operator, company, market, regulator, or system
- Do not mention writeup failures, missing context, providers, or inability to generate
- Do not output placeholders

Prior failures:
${JSON.stringify(reasons, null, 2)}

Previous WIM:
${sanitizePromptField(priorWim, 900) || ""}

Article:
${JSON.stringify(mapPromptItem(item), null, 2)}

Structured extraction:
${JSON.stringify({
  what_happened: sanitizePromptField(extraction?.what_happened, 220),
  mechanism: sanitizePromptField(extraction?.mechanism, 220),
  who_it_impacts: sanitizePromptField(extraction?.who_it_impacts, 220),
  implication: sanitizePromptField(extraction?.implication, 220),
  confidence: sanitizePromptField(extraction?.confidence, 20),
}, null, 2)}`;
}

module.exports = {
  buildDigestDataExtractionPrompt,
  buildDigestDataFormattingRetryPrompt,
  buildDigestDataWimPrompt,
  buildDigestDataWimFallbackPrompt,
  buildDigestDataWimRepairPrompt,
  mapPromptItem,
  sanitizePromptField,
};
