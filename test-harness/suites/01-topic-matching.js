const { buildDigestForPersona, splitUserTopics, itemMatchesPersonaTopic } = require("../pipeline");
const { mean } = require("../evaluator");

module.exports = {
  id: "01-topic-matching",
  name: "Topic Matching",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const perPersona = {};
    const failures = [];
    const suggestions = [];
    const scores = [];

    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime);
      const { standardTopicsLower, customKeywords } = splitUserTopics(persona.topics || []);

      const leakItems = [];
      let matched = 0;

      for (const item of digest.items) {
        const hit = itemMatchesPersonaTopic(item, standardTopicsLower, customKeywords);
        if (hit.matched) matched += 1;
        else leakItems.push({ headline: item.headline, tag: item.tag });
      }

      const delivered = digest.items.length;
      const accuracy = delivered > 0 ? matched / delivered : 0;
      const score = Number((accuracy * 100).toFixed(2));
      const passed = leakItems.length === 0;
      scores.push(score);

      perPersona[persona.id] = {
        persona: persona.name,
        delivered_items: delivered,
        matched_items: matched,
        leaked_items: leakItems.length,
        leaked_headlines: leakItems,
        score,
        passed,
      };

      if (!passed) {
        failures.push({
          persona: persona.name,
          issue: `Found ${leakItems.length} item(s) outside selected topics.`,
          evidence: leakItems,
        });
      }
    }

    const suiteScore = Number(mean(scores).toFixed(2));
    let status = "pass";
    if (failures.length > 0 && suiteScore >= 90) status = "warn";
    else if (failures.length > 0) status = "fail";

    if (failures.length > 0) {
      suggestions.push(
        "Tighten per-user filter to avoid fallback leakage when topic-matched pool is thin."
      );
      suggestions.push(
        "Track fallback reason in digest logs and cap unrelated top-up items when possible."
      );
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
        target: "100% topic match, 0 leaked items",
      },
      confidence: 0.9,
    };
  },
};
