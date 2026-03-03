const { buildDigestForPersona, countAdjacencyViolations, tagDistribution } = require("../pipeline");
const { mean } = require("../evaluator");

module.exports = {
  id: "04-diversity",
  name: "Diversity",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const perPersona = {};
    const failures = [];
    const suggestions = [];
    const scores = [];

    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime);
      const total = digest.items.length;
      const tagCounts = tagDistribution(digest.items);
      const uniqueTags = Object.keys(tagCounts).length;
      const adjacencyViolations = countAdjacencyViolations(digest.items);
      const maxTagCount = Object.values(tagCounts).reduce((a, b) => Math.max(a, b), 0);
      const dominance = total ? maxTagCount / total : 1;

      const diversityIndex = total ? uniqueTags / total : 0;
      const adjacencyScore = total > 1 ? Math.max(0, 1 - adjacencyViolations / (total - 1)) : 1;
      const dominanceScore = Math.max(0, Math.min(1, 1 - Math.max(0, dominance - 0.4) / 0.6));
      const score = (0.5 * diversityIndex + 0.3 * adjacencyScore + 0.2 * dominanceScore) * 100;

      const targetUnique = total >= 10 ? 5 : Math.min(4, total);
      const passed = adjacencyViolations === 0 && uniqueTags >= targetUnique && dominance <= 0.4;

      perPersona[persona.id] = {
        persona: persona.name,
        delivered_items: total,
        unique_tags: uniqueTags,
        diversity_index: Number(diversityIndex.toFixed(3)),
        adjacency_violations: adjacencyViolations,
        max_tag_share: Number(dominance.toFixed(3)),
        score: Number(score.toFixed(2)),
        passed,
      };

      scores.push(score);

      if (!passed) {
        failures.push({
          persona: persona.name,
          issue: `Diversity target missed (unique tags ${uniqueTags}, adjacency violations ${adjacencyViolations}, max share ${(dominance * 100).toFixed(1)}%).`,
          evidence: tagCounts,
        });
      }
    }

    const suiteScore = Number(mean(scores).toFixed(2));
    let status = "pass";
    if (suiteScore < 80 && suiteScore >= 60) status = "warn";
    else if (suiteScore < 60) status = "fail";

    if (status !== "pass") {
      suggestions.push("Update selectItems ordering to penalize repeated tags and promote underrepresented tags.");
      suggestions.push("Add optional per-source cap to reduce repetitive tag-source clustering.");
    }

    return {
      id: this.id,
      name: this.name,
      score: suiteScore,
      score_label: `${suiteScore.toFixed(1)}%`,
      status,
      per_persona: perPersona,
      failures,
      suggestions,
      details: {
        target: "No adjacent same-tag items, >=5 unique tags for 10-item digests, <=40% tag dominance",
      },
      confidence: 0.92,
    };
  },
};
