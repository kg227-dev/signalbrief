const ENRICH_PROMPT_VERSION = "2026-03-03-depth-v6";

function buildEnrichmentPrompt(items) {
  return `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants and business professionals. Your readers work at MBB, Big 4, boutique strategy firms, corporate strategy functions, and PE/investment shops. They work across multiple industries and need to sound informed in client meetings across healthcare, tech, financial services, PE, energy, consumer, and policy. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, return five fields:

1. "wim_brief" — one sentence, max 18 words.
   RULES:
   - Capture only the core strategic punchline for a busy executive.
   - Keep this descriptive only (what changed + why now); do not include role-specific actions or "Watch:" language.
   - No filler, no hedging, no repetition of the headline.
   - Do not use HTML tags in this field.

2. "wim" — a "why it matters" analysis of exactly 2-3 sentences.
   RULES:
   - Use 2 sentences by default; use 3 only when there is a concrete near-term catalyst.
   - First sentence: sharp, specific strategic implication. Wrap in <strong> tags. Make the reader think "I need to bring this up in my client meeting."
   - Second sentence: start with "For <role>," and state a concrete action for that role. Include a causal link ("because", "as", or "which means") plus at least one specific company, regulator, or investor type AND one business lever (pricing, margin, demand, cost, capex, valuation, or market share).
   - Second sentence must introduce at least one NEW fact not in sentence one (new actor, metric, catalyst, or timeline). Do not paraphrase sentence one.
   - Include at least one concrete proper noun in sentence 1 or 2 (company, regulator, buyer segment, or fund type).
   - Include one concrete quantitative anchor when available from the source context (deal value, percentage, timeline, or count). If not available, use a bounded near-term qualifier (for example "next 2 quarters").
   - Third sentence (optional): must start with "Watch:" and name a specific catalyst in the next 2-4 weeks (filing, ruling, earnings call, close date, or vote). Skip only if no concrete catalyst exists.

3. "baseScore" — a number 0.0–10.0 measuring the story's strategic importance and consultant relevance, independent of any user's topic preferences.
   - 8.5–10.0: Major development (landmark M&A, significant policy shift, key earnings miss with broad implications)
   - 7.0–8.4: Notable development (meaningful deal, regulatory move, sector-level change)
   - 5.0–6.9: Moderate interest (incremental update, early-stage signal worth watching)
   - Below 5.0: Routine or narrow-interest item

4. "implications" — one actionable sentence naming a specific role (e.g. "CFO", "deal team", "payer CMO", "PE portfolio team") and the concrete action, question, or client meeting flag this story creates. Return null if it is fully covered by the wim already.

5. "watch_next" — one forward-looking sentence: name the specific signal, filing, earnings call, or regulatory decision to monitor in the next 2–4 weeks. Start with an entity name or date. Return null if this is a one-time development with no near-term pending catalysts.

WHAT TO AVOID (too generic):
❌ "This could have significant implications for the industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)
❌ "This may affect stakeholders over time." (vague hedge)
❌ "Keep an eye on developments." (no actionable signal)

WHAT TO AIM FOR (specific, implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."

Return ONLY a JSON array with the same items plus "wim_brief", "wim", "baseScore", "implications", and "watch_next" fields. No markdown, no explanation.

Items:
${JSON.stringify(items.map((i) => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;
}

function mapEnrichedItems(items, parsed) {
  return (items || []).map((item, idx) => ({
    ...item,
    wim_brief:
      typeof parsed?.[idx]?.wim_brief === "string" && parsed[idx].wim_brief.trim()
        ? parsed[idx].wim_brief.trim()
        : null,
    wim:
      typeof parsed?.[idx]?.wim === "string" && parsed[idx].wim.trim()
        ? parsed[idx].wim.trim()
        : null,
    baseScore: typeof parsed?.[idx]?.baseScore === "number" ? parsed[idx].baseScore : 5.0,
    implications:
      typeof parsed?.[idx]?.implications === "string" && parsed[idx].implications.trim()
        ? parsed[idx].implications.trim()
        : null,
    watch_next:
      typeof parsed?.[idx]?.watch_next === "string" && parsed[idx].watch_next.trim()
        ? parsed[idx].watch_next.trim()
        : null,
  }));
}

module.exports = {
  ENRICH_PROMPT_VERSION,
  buildEnrichmentPrompt,
  mapEnrichedItems,
};
