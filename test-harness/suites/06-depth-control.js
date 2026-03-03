const { buildDigestForPersona } = require("../pipeline");
const { mean } = require("../evaluator");

function safeLength(text) {
  return String(text || "").trim().length;
}

module.exports = {
  id: "06-depth-control",
  name: "Depth Control",

  async run(context) {
    const { personas, dataset, runtime, evaluator } = context;
    const a = personas.find((p) => p.id === "depth_a");
    const b = personas.find((p) => p.id === "depth_b");

    if (!a || !b) {
      return {
        id: this.id,
        name: this.name,
        score: 0,
        score_label: "N/A",
        status: "skip",
        per_persona: {},
        failures: [],
        suggestions: ["Depth test personas missing."],
        details: {},
        confidence: 0.4,
      };
    }

    const briefDigest = buildDigestForPersona(dataset.enriched_items, a, runtime);
    const deepDigest = buildDigestForPersona(dataset.enriched_items, b, runtime);

    const briefByHeadline = new Map(briefDigest.items.map((i) => [i.headline, i]));
    const deepByHeadline = new Map(deepDigest.items.map((i) => [i.headline, i]));
    const sharedHeadlines = [...deepByHeadline.keys()].filter((h) => briefByHeadline.has(h));

    const pairRows = sharedHeadlines.map((headline) => {
      const brief = briefByHeadline.get(headline);
      const deep = deepByHeadline.get(headline);
      const briefText = String(brief?.wim || "");
      const deepText = String(deep?.wim || "");
      const briefChars = safeLength(briefText);
      const deepChars = safeLength(deepText);
      const ratio = briefChars > 0 ? deepChars / briefChars : 0;
      return {
        headline,
        brief_text: briefText,
        deep_text: deepText,
        brief_chars: briefChars,
        deep_chars: deepChars,
        char_ratio: Number(ratio.toFixed(3)),
        brief_sentences: evaluator.sentenceCount(briefText),
        deep_sentences: evaluator.sentenceCount(deepText),
        brief_grade: Number(evaluator.readingGradeLevel(briefText).toFixed(2)),
        deep_grade: Number(evaluator.readingGradeLevel(deepText).toFixed(2)),
      };
    });

    const judgeSample = pairRows.slice(0, Number(runtime.max_depth_pairs || 5));
    const judgedPairs = [];
    for (const row of judgeSample) {
      const judge = await evaluator.judgeDepthPair({
        headline: row.headline,
        brief: row.brief_text,
        deep: row.deep_text,
      });
      judgedPairs.push({ ...row, judge });
    }

    const avgRatio = mean(pairRows.map((r) => r.char_ratio));
    const avgInsight = mean(judgedPairs.map((r) => r.judge.insight_gain));
    const meaningfulPairs = judgedPairs.filter((r) => r.char_ratio >= 2 && r.judge.deep_more_insight && !r.judge.likely_padding).length;
    const meaningfulRatio = judgedPairs.length ? meaningfulPairs / judgedPairs.length : 0;

    const lengthScore = Math.max(0, Math.min(100, (avgRatio / 2.5) * 100));
    const insightScore = Math.max(0, Math.min(100, ((avgInsight - 1) / 4) * 100));
    const meaningfulScore = meaningfulRatio * 100;
    const suiteScore = Number((0.4 * lengthScore + 0.4 * insightScore + 0.2 * meaningfulScore).toFixed(2));
    const lowSample = judgedPairs.length < Math.min(3, Number(runtime.max_depth_pairs || 5));

    let status = "pass";
    if ((avgRatio < 2 || avgInsight < 3.5) && suiteScore >= 55) status = "warn";
    else if (avgRatio < 2 || avgInsight < 3.5) status = "fail";
    if (lowSample && status === "fail") status = "warn";

    const failures = [];
    if (status !== "pass") {
      failures.push({
        issue: `Depth difference is weak (avg ratio ${avgRatio.toFixed(2)}x, avg insight ${avgInsight.toFixed(2)}/5).`,
        evidence: judgedPairs.map((r) => ({
          headline: r.headline,
          ratio: r.char_ratio,
          insight_gain: r.judge.insight_gain,
          padding: r.judge.likely_padding,
        })),
      });
    }
    if (lowSample) {
      suggestions.push("Depth comparison confidence is limited by low overlap; increase selected pool/topic overlap for depth personas.");
    }

    const suggestions = [];
    if (status !== "pass") {
      suggestions.push("Generate depth-specific enrichment prompts instead of truncating deep output for brief mode.");
      suggestions.push("Require deep mode to add at least one extra mechanism or forward-looking signal beyond brief output.");
    }

    return {
      id: this.id,
      name: this.name,
      score: suiteScore,
      score_label: `${suiteScore.toFixed(1)}%`,
      status,
      per_persona: {
        [a.id]: {
          persona: a.name,
          delivered_items: briefDigest.items.length,
          depth: a.preferences.depth,
        },
        [b.id]: {
          persona: b.name,
          delivered_items: deepDigest.items.length,
          depth: b.preferences.depth,
        },
      },
      failures,
      suggestions,
      details: {
        target: "Deep should be ~2-3x longer and higher quality than brief.",
        avg_char_ratio: Number(avgRatio.toFixed(3)),
        avg_insight_gain: Number(avgInsight.toFixed(3)),
        meaningful_ratio: Number(meaningfulRatio.toFixed(3)),
        judged_pairs: judgedPairs.map((r) => ({
          headline: r.headline,
          ratio: r.char_ratio,
          insight_gain: r.judge.insight_gain,
          deep_more_insight: r.judge.deep_more_insight,
          likely_padding: r.judge.likely_padding,
          judged: !!r.judge.judged,
        })),
      },
      confidence: judgedPairs.some((p) => p.judge.judged) ? 0.82 : 0.58,
    };
  },
};
