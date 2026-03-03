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

module.exports = {
  id: "05-custom-topics",
  name: "Custom Topics",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const customPersona = personas.find((p) => p.id === "custom_keyword");
    const generalist = personas.find((p) => p.id === "generalist");

    if (!customPersona || !generalist) {
      return {
        id: this.id,
        name: this.name,
        score: 0,
        score_label: "N/A",
        status: "skip",
        per_persona: {},
        failures: [],
        suggestions: ["Missing required personas (custom_keyword/generalist)."],
        details: {},
        confidence: 0.4,
      };
    }

    const customDigest = buildDigestForPersona(dataset.enriched_items, customPersona, runtime);
    const generalistDigest = buildDigestForPersona(dataset.enriched_items, generalist, runtime);

    const keywords = (customPersona.custom_topics || customPersona.topics || [])
      .filter((t) => String(t).startsWith("custom_"))
      .map(normalizeCustomKeyword);

    const perKeyword = keywords.map((kw) => {
      const customHits = countKeywordHits(customDigest.items, kw);
      const baselineHits = countKeywordHits(generalistDigest.items, kw);
      return {
        keyword: kw,
        custom_hits: customHits,
        baseline_hits: baselineHits,
        incremental_hits: customHits - baselineHits,
      };
    });

    const keywordsWithHit = perKeyword.filter((k) => k.custom_hits >= 1).length;
    const avgHits = mean(perKeyword.map((k) => k.custom_hits));
    const coverage = keywords.length ? keywordsWithHit / keywords.length : 0;
    const score = Math.max(0, Math.min(100, coverage * 80 + Math.min(20, avgHits * 10)));

    let status = "pass";
    if (coverage < 1 && coverage >= 0.67) status = "warn";
    else if (coverage < 0.67) status = "fail";

    const failures = [];
    if (status !== "pass") {
      failures.push({
        issue: `Custom keyword coverage ${keywordsWithHit}/${keywords.length} below target (>=1 hit per keyword).`,
        evidence: perKeyword,
      });
    }

    const suggestions = [];
    if (status !== "pass") {
      suggestions.push("Increase custom fetch query specificity and include synonyms in custom topic expansion.");
      suggestions.push("Consider prioritizing matched custom-tag items after relevance scoring before final trim.");
    }

    return {
      id: this.id,
      name: this.name,
      score: Number(score.toFixed(2)),
      score_label: `${Number(score).toFixed(1)}%`,
      status,
      per_persona: {
        [customPersona.id]: {
          persona: customPersona.name,
          delivered_items: customDigest.items.length,
          keywords: perKeyword,
          score: Number(score.toFixed(2)),
          passed: status === "pass",
        },
      },
      failures,
      suggestions,
      details: {
        target: "At least 1 matching item per custom keyword",
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
      confidence: 0.88,
    };
  },
};
