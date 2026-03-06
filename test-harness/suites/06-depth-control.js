const { buildDigestForPersona, computeTopicMatch } = require("../pipeline");
const { mean } = require("../evaluator");

function safeLength(text) {
  return String(text || "").trim().length;
}

function toBriefText(item) {
  const authored = String(item?.wim_brief || "").trim();
  if (authored) return authored;
  const wim = String(item?.wim || "");
  if (!wim.trim()) return "";
  return wim
    .replace(/<strong>(.*?)<\/strong>/s, "$1")
    .split(".")[0]
    .trim()
    .concat(".");
}

module.exports = {
  id: "06-depth-control",
  name: "Depth Control",

  async run(context) {
    const { personas, dataset, runtime, evaluator } = context;
    const allowSonnetAdjudication = String(runtime.judge_model || "haiku").toLowerCase() === "haiku"
      && !runtime.no_judge
      && typeof evaluator.judgeDepthPairWithModel === "function";
    const maxAdjudications = Math.max(0, Math.min(Number(runtime.max_depth_adjudications || 6), Number(runtime.max_depth_pairs || 5)));
    let adjudicatedCount = 0;

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
    const targetPairs = Math.max(1, Number(runtime.max_depth_pairs || 5));

    const pairRows = sharedHeadlines.map((headline) => {
      const brief = briefByHeadline.get(headline);
      const deep = deepByHeadline.get(headline);
      const briefText = String(brief?.wim || "");
      const deepText = [
        String(deep?.wim || ""),
        String(deep?.implications || ""),
        String(deep?.watch_next || ""),
      ].filter(Boolean).join(" ");
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
        synthetic_brief: false,
      };
    });

    if (pairRows.length < targetPairs) {
      const seen = new Set(pairRows.map((row) => row.headline));
      const deepSource = Array.isArray(deepDigest.pre_depth_items) && deepDigest.pre_depth_items.length
        ? deepDigest.pre_depth_items
        : (Array.isArray(deepDigest.scored_items) && deepDigest.scored_items.length
          ? deepDigest.scored_items
          : deepDigest.items);
      const fallbackUniverse = Array.isArray(dataset?.enriched_items) ? dataset.enriched_items : [];
      const candidates = [...deepSource, ...fallbackUniverse];
      const depthTopics = Array.isArray(a.topics) && a.topics.length
        ? a.topics
        : (Array.isArray(b.topics) ? b.topics : []);
      for (const deep of candidates) {
        if (!deep?.headline || seen.has(deep.headline)) continue;
        if (Number(deep?.baseScore || 0) < 6) continue;
        if (depthTopics.length > 0 && computeTopicMatch(deep, depthTopics) < 7) continue;
        const briefText = toBriefText(deep);
        const deepText = [
          String(deep?.wim || ""),
          String(deep?.implications || ""),
          String(deep?.watch_next || ""),
        ].filter(Boolean).join(" ");
        if (!briefText && !deepText) continue;
        const briefChars = safeLength(briefText);
        const deepChars = safeLength(deepText);
        const ratio = briefChars > 0 ? deepChars / briefChars : 0;
        pairRows.push({
          headline: deep.headline,
          brief_text: briefText,
          deep_text: deepText,
          brief_chars: briefChars,
          deep_chars: deepChars,
          char_ratio: Number(ratio.toFixed(3)),
          brief_sentences: evaluator.sentenceCount(briefText),
          deep_sentences: evaluator.sentenceCount(deepText),
          brief_grade: Number(evaluator.readingGradeLevel(briefText).toFixed(2)),
          deep_grade: Number(evaluator.readingGradeLevel(deepText).toFixed(2)),
          synthetic_brief: true,
        });
        seen.add(deep.headline);
        if (pairRows.length >= targetPairs) break;
      }
    }

    const judgeSample = pairRows.slice(0, targetPairs);
    const judgedPairs = [];
    for (const row of judgeSample) {
      let judge = await evaluator.judgeDepthPair({
        headline: row.headline,
        brief: row.brief_text,
        deep: row.deep_text,
      });

      if (
        allowSonnetAdjudication
        && adjudicatedCount < maxAdjudications
        && judge?.judged
        && Number(judge.insight_gain) >= 2
        && Number(judge.insight_gain) <= 3.5
      ) {
        const sonnet = await evaluator.judgeDepthPairWithModel({
          headline: row.headline,
          brief: row.brief_text,
          deep: row.deep_text,
        }, "sonnet");
        if (sonnet?.judged) {
          adjudicatedCount += 1;
          judge = {
            insight_gain: (Number(judge.insight_gain || 0) + Number(sonnet.insight_gain || 0)) / 2,
            deep_more_insight: !!(judge.deep_more_insight || sonnet.deep_more_insight),
            likely_padding: !!(judge.likely_padding && sonnet.likely_padding),
            rationale: `${String(judge.rationale || "")} | Sonnet adjudication: ${String(sonnet.rationale || "")}`.trim(),
            judged: true,
            adjudicated: true,
          };
        }
      }

      judgedPairs.push({ ...row, judge });
    }

    const avgRatio = mean(pairRows.map((r) => r.char_ratio));
    const avgInsight = mean(judgedPairs.map((r) => r.judge.insight_gain));
    const paddingRate = mean(judgedPairs.map((r) => (r.judge.likely_padding ? 1 : 0)));
    const meaningfulPairs = judgedPairs.filter((r) => r.char_ratio >= 2 && r.judge.deep_more_insight && !r.judge.likely_padding).length;
    const meaningfulRatio = judgedPairs.length ? meaningfulPairs / judgedPairs.length : 0;

    const lengthScore = Math.max(0, Math.min(100, (avgRatio / 2.5) * 100));
    const insightScore = Math.max(0, Math.min(100, ((avgInsight - 1) / 4) * 100));
    const meaningfulScore = meaningfulRatio * 100;
    const paddingPenalty = Math.max(0, (paddingRate - 0.2) * 80);
    const suiteScore = Number(Math.max(0, 0.35 * lengthScore + 0.45 * insightScore + 0.2 * meaningfulScore - paddingPenalty).toFixed(2));

    const lowSample = judgedPairs.length < Math.min(8, targetPairs);
    let status = "pass";
    if ((avgRatio < 2 || avgInsight < 3.5 || paddingRate > 0.2) && suiteScore >= 60) status = "warn";
    else if (avgRatio < 2 || avgInsight < 3.5 || paddingRate > 0.2) status = "fail";
    if (lowSample && status === "fail") status = "warn";

    const failures = [];
    const suggestions = [];

    if (status !== "pass") {
      failures.push({
        issue: `Depth quality below target (ratio ${avgRatio.toFixed(2)}x, insight ${avgInsight.toFixed(2)}/5, padding ${(paddingRate * 100).toFixed(1)}%).`,
        evidence: judgedPairs.map((r) => ({
          headline: r.headline,
          ratio: r.char_ratio,
          insight_gain: r.judge.insight_gain,
          padding: r.judge.likely_padding,
          judged: !!r.judge.judged,
        })),
      });

      suggestions.push("Generate depth-specific enrichment prompts instead of truncating deep output for brief mode.");
      suggestions.push("Require deep mode to add at least one extra mechanism or near-term catalyst beyond brief output.");
    }

    if (lowSample) {
      suggestions.push("Depth comparison confidence is limited by low overlap; increase selected pool/topic overlap for depth personas.");
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
        target: "Deep should be 2-3x longer, insight >=3.5/5, likely_padding <=20%.",
        sample_count: judgedPairs.length,
        target_pairs: targetPairs,
        synthetic_brief_pairs: judgedPairs.filter((r) => r.synthetic_brief).length,
        sonnet_adjudications: adjudicatedCount,
        avg_char_ratio: Number(avgRatio.toFixed(3)),
        avg_insight_gain: Number(avgInsight.toFixed(3)),
        likely_padding: Number(paddingRate.toFixed(3)),
        meaningful_ratio: Number(meaningfulRatio.toFixed(3)),
        judged_pairs: judgedPairs.map((r) => ({
          headline: r.headline,
          ratio: r.char_ratio,
          insight_gain: r.judge.insight_gain,
          deep_more_insight: r.judge.deep_more_insight,
          likely_padding: r.judge.likely_padding,
          judged: !!r.judge.judged,
          adjudicated: !!r.judge.adjudicated,
          synthetic_brief: !!r.synthetic_brief,
        })),
      },
      confidence: judgedPairs.some((p) => p.judge.judged) ? 0.84 : 0.58,
    };
  },
};
