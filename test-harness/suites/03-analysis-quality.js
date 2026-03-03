const { buildDigestForPersona } = require("../pipeline");
const { mean } = require("../evaluator");

module.exports = {
  id: "03-analysis-quality",
  name: "Analysis Quality",

  async run(context) {
    const { personas, dataset, runtime, evaluator } = context;
    const maxSamples = Number(runtime.max_analysis_samples || 12);

    const candidates = [];
    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime);
      const sourceItems = Array.isArray(digest.pre_depth_items) && digest.pre_depth_items.length
        ? digest.pre_depth_items
        : (Array.isArray(digest.scored_items)
          ? digest.scored_items.slice(0, Number(digest.requested_count || 0))
          : digest.items);
      sourceItems.forEach((item) => {
        if (!item.wim) return;
        candidates.push({
          persona_id: persona.id,
          persona_name: persona.name,
          item,
        });
      });
    }

    const seen = new Set();
    const samples = [];
    for (const c of candidates) {
      const key = `${c.persona_id}::${c.item.headline}::${c.item.wim}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push(c);
      if (samples.length >= maxSamples) break;
    }

    const judgedItems = [];
    for (const sample of samples) {
      const score = await evaluator.judgeAnalysisSample(sample);
      judgedItems.push({ ...sample, score });
    }

    const overallScores = judgedItems.map((x) => Number(x.score.overall)).filter(Number.isFinite);
    const p25 = evaluator.percentile(overallScores, 0.25);
    const p10 = evaluator.percentile(overallScores, 0.1);

    const dimensionAverages = {
      specificity: mean(judgedItems.map((x) => x.score.specificity)),
      strategic_framing: mean(judgedItems.map((x) => x.score.strategic_framing)),
      actionability: mean(judgedItems.map((x) => x.score.actionability)),
      differentiation: mean(judgedItems.map((x) => x.score.differentiation)),
      brevity_density: mean(judgedItems.map((x) => x.score.brevity_density)),
      overall: mean(judgedItems.map((x) => x.score.overall)),
    };

    const perPersona = {};
    for (const persona of personas) {
      const mine = judgedItems.filter((x) => x.persona_id === persona.id);
      if (!mine.length) {
        perPersona[persona.id] = {
          persona: persona.name,
          sample_count: 0,
          overall: null,
          score: null,
        };
        continue;
      }
      const avg = mean(mine.map((x) => x.score.overall));
      perPersona[persona.id] = {
        persona: persona.name,
        sample_count: mine.length,
        overall: Number(avg.toFixed(3)),
        score: Number((((avg - 1) / 4) * 100).toFixed(2)),
      };
    }

    const overall = Number(dimensionAverages.overall.toFixed(3));
    const suiteScore = Number((((overall - 1) / 4) * 100).toFixed(2));

    let status = "pass";
    if ((overall < 4.0 || p25 < 3.6) && overall >= 3.7 && p25 >= 3.3) status = "warn";
    else if (overall < 4.0 || p25 < 3.6) status = "fail";

    const failures = [];
    if (status !== "pass") {
      failures.push({
        issue: `Analysis quality below gate (mean ${overall.toFixed(2)}/5, p25 ${p25.toFixed(2)}/5; target mean>=4.0 and p25>=3.6).`,
        evidence: {
          dimension_averages: Object.fromEntries(
            Object.entries(dimensionAverages).map(([k, v]) => [k, Number(v.toFixed(3))])
          ),
          sample_count: judgedItems.length,
          p25: Number(p25.toFixed(3)),
          p10: Number(p10.toFixed(3)),
        },
      });
    }

    const suggestions = [];
    const lowDims = Object.entries(dimensionAverages)
      .filter(([k, v]) => k !== "overall" && v < 3.8)
      .map(([k]) => k);

    if (lowDims.includes("specificity")) {
      suggestions.push(
        "Tighten enrichment prompt to require at least one concrete entity/number per WIM paragraph."
      );
    }
    if (lowDims.includes("actionability")) {
      suggestions.push(
        "Raise priority of implications field in render path so decision-maker actions are explicit in output."
      );
    }
    if (lowDims.includes("differentiation")) {
      suggestions.push(
        "Add anti-paraphrase guardrails in prompt to penalize headline restatement and require second-order effects."
      );
    }

    return {
      id: this.id,
      name: this.name,
      score: suiteScore,
      score_label: `${overall.toFixed(2)}/5`,
      status,
      per_persona: perPersona,
      failures,
      suggestions,
      details: {
        target: "Average overall >= 4.0/5 and P25 >= 3.6/5",
        sample_count: judgedItems.length,
        p25: Number(p25.toFixed(3)),
        p10: Number(p10.toFixed(3)),
        dimension_averages: Object.fromEntries(
          Object.entries(dimensionAverages).map(([k, v]) => [k, Number(v.toFixed(3))])
        ),
        judged_items: judgedItems.map((row) => ({
          persona: row.persona_name,
          headline: row.item.headline,
          overall: Number(row.score.overall.toFixed(3)),
          judged: !!row.score.judged,
        })),
      },
      confidence: judgedItems.some((x) => x.score.judged) ? 0.88 : 0.55,
    };
  },
};
