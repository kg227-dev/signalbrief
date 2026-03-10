const { buildDigestForPersona, splitUserTopics, itemMatchesPersonaTopic } = require("../runtime/pipeline");
const { mean } = require("../runtime/evaluator");

module.exports = {
  id: "01-topic-matching",
  name: "Topic Matching",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const perPersona = {};
    const failures = [];
    const suggestions = [];
    const scores = [];
    let totalDelivered = 0;
    let totalLeaks = 0;

    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime.digestPolicies);
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
      totalDelivered += delivered;
      totalLeaks += leakItems.length;
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
    const leakRate = totalDelivered ? totalLeaks / totalDelivered : 0;
    let status = "pass";
    if (leakRate > 0.01 && leakRate <= 0.03) status = "warn";
    else if (leakRate > 0.03) status = "fail";

    if (status !== "pass") {
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
        target: "Leak rate <= 1% across delivered items",
        leak_rate: Number(leakRate.toFixed(4)),
        delivered_items: totalDelivered,
        leaked_items: totalLeaks,
      },
      confidence: 0.9,
    };
  },
};
