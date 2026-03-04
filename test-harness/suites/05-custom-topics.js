const { buildDigestForPersona, normalizeCustomKeyword } = require("../pipeline");
const { mean } = require("../evaluator");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countKeywordHits(items, keyword) {
  const kw = normalizeCustomKeyword(keyword);
  if (!kw) return 0;
  return (items || []).filter((item) => {
    const text = normalizeText([item?.tag, item?.headline, item?.summary].filter(Boolean).join(" "));
    return text.includes(kw);
  }).length;
}

function extractPersonaKeywords(persona) {
  const fromCustomField = Array.isArray(persona?.custom_topics) ? persona.custom_topics : [];
  const fromTopics = Array.isArray(persona?.topics) ? persona.topics : [];
  return [...new Set([...fromCustomField, ...fromTopics]
    .filter((t) => String(t || "").startsWith("custom_"))
    .map(normalizeCustomKeyword)
    .filter(Boolean))];
}

function isCustomPersona(persona) {
  return extractPersonaKeywords(persona).length > 0;
}

module.exports = {
  id: "05-custom-topics",
  name: "Custom Topics",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const allCustomPersonas = (personas || []).filter(isCustomPersona);
    const customLimit = Math.max(0, Number(runtime.custom_persona_limit || 0));
    const customPersonas = customLimit > 0 ? allCustomPersonas.slice(0, customLimit) : allCustomPersonas;
    const generalist = personas.find((p) => p.id === "generalist") || personas[0];

    if (!customPersonas.length || !generalist) {
      return {
        id: this.id,
        name: this.name,
        score: 0,
        score_label: "N/A",
        status: "skip",
        per_persona: {},
        failures: [],
        suggestions: ["Missing required personas (at least one custom persona and one baseline persona)."],
        details: {},
        confidence: 0.4,
      };
    }

    const baselineDigest = buildDigestForPersona(dataset.enriched_items, generalist, runtime);

    const perPersona = {};
    const allKeywordRows = [];
    let personasWithAnyHit = 0;
    for (const persona of customPersonas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime);
      const keywords = extractPersonaKeywords(persona);
      const baselineItems = baselineDigest.items.slice(0, Math.max(1, digest.items.length));

      const rows = keywords.map((kw) => {
        const customHits = countKeywordHits(digest.items, kw);
        const baselineHits = countKeywordHits(baselineItems, kw);
        return {
          keyword: kw,
          custom_hits: customHits,
          baseline_hits: baselineHits,
          incremental_hits: customHits - baselineHits,
        };
      });
      allKeywordRows.push(...rows.map((row) => ({ persona_id: persona.id, ...row })));

      const keywordCoverage = rows.length ? rows.filter((k) => k.custom_hits >= 1).length / rows.length : 0;
      const personaHasHit = rows.some((k) => k.custom_hits >= 1);
      if (personaHasHit) personasWithAnyHit += 1;

      perPersona[persona.id] = {
        persona: persona.name,
        delivered_items: digest.items.length,
        keyword_count: rows.length,
        keyword_coverage: Number(keywordCoverage.toFixed(3)),
        keywords: rows,
      };
    }

    const totalKeywords = allKeywordRows.length;
    const keywordsWithHit = allKeywordRows.filter((k) => k.custom_hits >= 1).length;
    const keywordsWithUplift = allKeywordRows.filter((k) => k.incremental_hits > 0).length;
    const coverage = totalKeywords ? keywordsWithHit / totalKeywords : 0;
    const personaCoverage = customPersonas.length ? personasWithAnyHit / customPersonas.length : 0;
    const upliftRate = totalKeywords ? keywordsWithUplift / totalKeywords : 0;
    const avgHits = mean(allKeywordRows.map((k) => k.custom_hits));

    const score = Math.max(
      0,
      Math.min(100, coverage * 55 + personaCoverage * 30 + upliftRate * 15)
    );

    let status = "pass";
    if ((coverage < 0.6 || personaCoverage < 0.67) && coverage >= 0.45 && personaCoverage >= 0.5) status = "warn";
    else if (coverage < 0.45 || personaCoverage < 0.5) status = "fail";

    const failures = [];
    if (status !== "pass") {
      failures.push({
        issue: `Custom-topic coverage below target (keyword coverage ${(coverage * 100).toFixed(1)}%, persona coverage ${(personaCoverage * 100).toFixed(1)}%).`,
        evidence: {
          custom_personas: customPersonas.length,
          total_keywords: totalKeywords,
          keywords_with_hit: keywordsWithHit,
          personas_with_any_hit: personasWithAnyHit,
          low_coverage_personas: Object.entries(perPersona)
            .filter(([, row]) => row.keyword_coverage < 0.5)
            .map(([id, row]) => ({ id, persona: row.persona, keyword_coverage: row.keyword_coverage })),
        },
      });
    }

    const suggestions = [];
    if (status !== "pass") {
      suggestions.push("Expand custom keyword synonym mapping (e.g., stem/alias list) before matching headline and summary text.");
      suggestions.push("Reserve at least one final slot for highest-confidence custom match when user has custom topics.");
    }
    if (upliftRate < 0.4) {
      suggestions.push("Custom-topic uplift versus baseline is weak; audit custom fetch query templates and tag normalization.");
    }

    return {
      id: this.id,
      name: this.name,
      score: Number(score.toFixed(2)),
      score_label: `${Number(score).toFixed(1)}%`,
      status,
      per_persona: perPersona,
      failures,
      suggestions,
      details: {
        target: "Keyword hit coverage >=60%, persona coverage >=67%, and positive uplift over baseline.",
        sample_count: totalKeywords,
        custom_persona_count: customPersonas.length,
        baseline_persona: generalist.name,
        keyword_coverage: Number(coverage.toFixed(3)),
        persona_coverage: Number(personaCoverage.toFixed(3)),
        uplift_rate: Number(upliftRate.toFixed(3)),
        avg_hits_per_keyword: Number(avgHits.toFixed(3)),
        keyword_rows: allKeywordRows,
        custom_fetch_topics_seen: dataset.custom_fetch_topics || [],
        custom_topics_behavior: {
          does: [
            "Stores custom topics as custom_<slug>.",
            "Fetches up to 5 custom Perplexity queries per run.",
            "Matches custom keywords in headline/summary during per-user filter.",
          ],
          does_not: [
            "Guarantee one item per custom keyword in final trimmed digest.",
            "Persist dedicated custom-topic weighting beyond generic topic_weights matching.",
          ],
        },
      },
      confidence: Math.max(0.65, Math.min(0.95, 0.65 + Math.min(0.3, totalKeywords * 0.01))),
    };
  },
};
