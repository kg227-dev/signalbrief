const { buildDigestForPersona } = require("../runtime/pipeline");
const { mean } = require("../runtime/evaluator");

module.exports = {
  id: "07-item-count",
  name: "Item Count",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const perPersona = {};
    const failures = [];
    const suggestions = [];

    const checks = [];
    const capNotices = [];

    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime.digestPolicies);
      const requested = Number(digest.requested_count || 0);
      const expected = Math.min(requested, Number(digest.pre_trim_count || 0));
      const delivered = Number(digest.delivered_count || 0);
      const passed = delivered === expected;

      checks.push(passed ? 100 : 0);

      if (requested > Number(runtime.defaultItemCount || 7)) {
        capNotices.push({
          persona: persona.name,
          requested,
          global_selection_cap: Number(runtime.defaultItemCount || 7),
        });
      }

      perPersona[persona.id] = {
        persona: persona.name,
        requested_count: requested,
        pre_trim_count: Number(digest.pre_trim_count || 0),
        expected_count: expected,
        delivered_count: delivered,
        passed,
      };

      if (!passed) {
        failures.push({
          persona: persona.name,
          issue: `Delivered ${delivered} items, expected ${expected}.`,
        });
      }
    }

    const suiteScore = Number(mean(checks).toFixed(2));
    let status = failures.length === 0 ? "pass" : "fail";

    if (status === "pass" && capNotices.length > 0) {
      status = "warn";
      suggestions.push(
        "Requested 10-item digests are constrained by global selection cap (digest.itemCount)."
      );
    }

    if (failures.length > 0) {
      suggestions.push("Validate items_per_digest against available candidate pool before render.");
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
        target: "Delivered count equals expected count for every persona.",
        global_selection_cap: Number(runtime.defaultItemCount || 7),
        cap_notices: capNotices,
      },
      confidence: 0.95,
    };
  },
};
