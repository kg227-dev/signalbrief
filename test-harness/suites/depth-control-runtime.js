const { buildDigestForPersona, computeTopicMatch } = require("../runtime/pipeline");
const { mean } = require("../runtime/evaluator");

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

function buildRunFlags(runtime, evaluator) {
  const runModel = String(runtime.judge_model || "haiku").toLowerCase();
  const canModelJudge = typeof evaluator.judgeDepthPairWithModel === "function";
  const maxDepthPairs = Number(runtime.max_depth_pairs || 5);
  return {
    allowSonnetAdjudication: runModel === "haiku" && !runtime.no_judge && canModelJudge,
    maxAdjudications: Math.max(0, Math.min(Number(runtime.max_depth_adjudications || 6), maxDepthPairs)),
    targetPairs: Math.max(1, maxDepthPairs),
  };
}

function findDepthPersonas(personas) {
  return {
    briefPersona: personas.find((persona) => persona.id === "depth_a"),
    deepPersona: personas.find((persona) => persona.id === "depth_b"),
  };
}

function buildPairRow(headline, briefText, deepText, evaluator, syntheticBrief) {
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
    synthetic_brief: syntheticBrief,
  };
}

function buildDeepText(item) {
  return [String(item?.wim || ""), String(item?.implications || ""), String(item?.watch_next || "")]
    .filter(Boolean)
    .join(" ");
}

function buildSharedPairRows(briefDigest, deepDigest, evaluator) {
  const briefByHeadline = new Map(briefDigest.items.map((item) => [item.headline, item]));
  const deepByHeadline = new Map(deepDigest.items.map((item) => [item.headline, item]));
  const sharedHeadlines = [...deepByHeadline.keys()].filter((headline) => briefByHeadline.has(headline));
  return sharedHeadlines.map((headline) => {
    const brief = briefByHeadline.get(headline);
    const deep = deepByHeadline.get(headline);
    return buildPairRow(headline, String(brief?.wim || ""), buildDeepText(deep), evaluator, false);
  });
}

function buildFallbackCandidates(deepDigest, dataset) {
  const deepSource = Array.isArray(deepDigest.pre_depth_items) && deepDigest.pre_depth_items.length
    ? deepDigest.pre_depth_items
    : (Array.isArray(deepDigest.scored_items) && deepDigest.scored_items.length ? deepDigest.scored_items : deepDigest.items);
  const fallbackUniverse = Array.isArray(dataset?.enriched_items) ? dataset.enriched_items : [];
  return [...deepSource, ...fallbackUniverse];
}

function appendFallbackRows(pairRows, deepDigest, dataset, briefPersona, deepPersona, evaluator, targetPairs) {
  if (pairRows.length >= targetPairs) return pairRows;

  const seen = new Set(pairRows.map((row) => row.headline));
  const candidates = buildFallbackCandidates(deepDigest, dataset);
  const depthTopics = Array.isArray(briefPersona.topics) && briefPersona.topics.length
    ? briefPersona.topics
    : (Array.isArray(deepPersona.topics) ? deepPersona.topics : []);

  for (const deep of candidates) {
    if (!deep?.headline || seen.has(deep.headline)) continue;
    if (Number(deep?.baseScore || 0) < 6) continue;
    if (depthTopics.length > 0 && computeTopicMatch(deep, depthTopics) < 7) continue;

    const briefText = toBriefText(deep);
    const deepText = buildDeepText(deep);
    if (!briefText && !deepText) continue;
    pairRows.push(buildPairRow(deep.headline, briefText, deepText, evaluator, true));
    seen.add(deep.headline);
    if (pairRows.length >= targetPairs) break;
  }

  return pairRows;
}

function shouldAdjudicate(judge, adjudicatedCount, flags) {
  return (
    flags.allowSonnetAdjudication
    && adjudicatedCount < flags.maxAdjudications
    && judge?.judged
    && Number(judge.insight_gain) >= 2
    && Number(judge.insight_gain) <= 3.5
  );
}

function mergeAdjudicatedJudge(judge, sonnet) {
  return {
    insight_gain: (Number(judge.insight_gain || 0) + Number(sonnet.insight_gain || 0)) / 2,
    deep_more_insight: !!(judge.deep_more_insight || sonnet.deep_more_insight),
    likely_padding: !!(judge.likely_padding && sonnet.likely_padding),
    rationale: `${String(judge.rationale || "")} | Sonnet adjudication: ${String(sonnet.rationale || "")}`.trim(),
    judged: true,
    adjudicated: true,
  };
}

async function judgePairs(pairRows, evaluator, flags) {
  let adjudicatedCount = 0;
  const judgeSample = pairRows.slice(0, flags.targetPairs);
  const judgedPairs = [];

  for (const row of judgeSample) {
    let judge = await evaluator.judgeDepthPair({
      headline: row.headline,
      brief: row.brief_text,
      deep: row.deep_text,
    });

    if (shouldAdjudicate(judge, adjudicatedCount, flags)) {
      const sonnet = await evaluator.judgeDepthPairWithModel(
        {
          headline: row.headline,
          brief: row.brief_text,
          deep: row.deep_text,
        },
        "sonnet"
      );
      if (sonnet?.judged) {
        judge = mergeAdjudicatedJudge(judge, sonnet);
        adjudicatedCount += 1;
      }
    }
    judgedPairs.push({ ...row, judge });
  }

  return { judgedPairs, adjudicatedCount };
}

function computeScores(pairRows, judgedPairs) {
  const avgRatio = mean(pairRows.map((row) => row.char_ratio));
  const avgInsight = mean(judgedPairs.map((row) => row.judge.insight_gain));
  const paddingRate = mean(judgedPairs.map((row) => (row.judge.likely_padding ? 1 : 0)));
  const meaningfulPairs = judgedPairs.filter(
    (row) => row.char_ratio >= 2 && row.judge.deep_more_insight && !row.judge.likely_padding
  ).length;
  const meaningfulRatio = judgedPairs.length ? meaningfulPairs / judgedPairs.length : 0;

  const lengthScore = Math.max(0, Math.min(100, (avgRatio / 2.5) * 100));
  const insightScore = Math.max(0, Math.min(100, ((avgInsight - 1) / 4) * 100));
  const meaningfulScore = meaningfulRatio * 100;
  const paddingPenalty = Math.max(0, (paddingRate - 0.2) * 80);
  const suiteScore = Number(
    Math.max(0, 0.35 * lengthScore + 0.45 * insightScore + 0.2 * meaningfulScore - paddingPenalty).toFixed(2)
  );

  return {
    avgRatio,
    avgInsight,
    paddingRate,
    meaningfulRatio,
    suiteScore,
  };
}

function computeDepthStatusBand(scores, judgedPairs, targetPairs) {
  const lowSample = judgedPairs.length < Math.min(8, targetPairs);
  let status = "pass";
  if ((scores.avgRatio < 2 || scores.avgInsight < 3.5 || scores.paddingRate > 0.2) && scores.suiteScore >= 60) status = "warn";
  else if (scores.avgRatio < 2 || scores.avgInsight < 3.5 || scores.paddingRate > 0.2) status = "fail";
  if (lowSample && status === "fail") status = "warn";
  return { status, lowSample };
}

function evaluateDepthFindings(status, lowSample, scores, judgedPairs) {
  const failures = [];
  const suggestions = [];

  if (status !== "pass") {
    failures.push({
      issue: `Depth quality below target (ratio ${scores.avgRatio.toFixed(2)}x, insight ${scores.avgInsight.toFixed(2)}/5, padding ${(scores.paddingRate * 100).toFixed(1)}%).`,
      evidence: judgedPairs.map((row) => ({
        headline: row.headline,
        ratio: row.char_ratio,
        insight_gain: row.judge.insight_gain,
        padding: row.judge.likely_padding,
        judged: !!row.judge.judged,
      })),
    });
    suggestions.push("Generate depth-specific enrichment prompts instead of truncating deep output for brief mode.");
    suggestions.push("Require deep mode to add at least one extra mechanism or near-term catalyst beyond brief output.");
  }

  if (lowSample) {
    suggestions.push("Depth comparison confidence is limited by low overlap; increase selected pool/topic overlap for depth personas.");
  }

  return { failures, suggestions };
}

function makeDepthSkipPayload(suiteMeta) {
  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
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

function buildDetails(flags, judgedPairs, scores, adjudicatedCount) {
  return {
    target: "Deep should be 2-3x longer, insight >=3.5/5, likely_padding <=20%.",
    sample_count: judgedPairs.length,
    target_pairs: flags.targetPairs,
    synthetic_brief_pairs: judgedPairs.filter((row) => row.synthetic_brief).length,
    sonnet_adjudications: adjudicatedCount,
    avg_char_ratio: Number(scores.avgRatio.toFixed(3)),
    avg_insight_gain: Number(scores.avgInsight.toFixed(3)),
    likely_padding: Number(scores.paddingRate.toFixed(3)),
    meaningful_ratio: Number(scores.meaningfulRatio.toFixed(3)),
    judged_pairs: judgedPairs.map((row) => ({
      headline: row.headline,
      ratio: row.char_ratio,
      insight_gain: row.judge.insight_gain,
      deep_more_insight: row.judge.deep_more_insight,
      likely_padding: row.judge.likely_padding,
      judged: !!row.judge.judged,
      adjudicated: !!row.judge.adjudicated,
      synthetic_brief: !!row.synthetic_brief,
    })),
  };
}

async function runDepthControlSuite(context, suiteMeta) {
  const { personas, dataset, runtime, evaluator } = context;
  const flags = buildRunFlags(runtime, evaluator);
  const { briefPersona, deepPersona } = findDepthPersonas(personas);
  if (!briefPersona || !deepPersona) return makeDepthSkipPayload(suiteMeta);

  const briefDigest = buildDigestForPersona(dataset.enriched_items, briefPersona, runtime.digestPolicies);
  const deepDigest = buildDigestForPersona(dataset.enriched_items, deepPersona, runtime.digestPolicies);
  const pairRows = appendFallbackRows(
    buildSharedPairRows(briefDigest, deepDigest, evaluator),
    deepDigest,
    dataset,
    briefPersona,
    deepPersona,
    evaluator,
    flags.targetPairs
  );
  const { judgedPairs, adjudicatedCount } = await judgePairs(pairRows, evaluator, flags);
  const scores = computeScores(pairRows, judgedPairs);
  const { status, lowSample } = computeDepthStatusBand(scores, judgedPairs, flags.targetPairs);
  const { failures, suggestions } = evaluateDepthFindings(status, lowSample, scores, judgedPairs);

  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
    score: scores.suiteScore,
    score_label: `${scores.suiteScore.toFixed(1)}%`,
    status,
    per_persona: {
      [briefPersona.id]: {
        persona: briefPersona.name,
        delivered_items: briefDigest.items.length,
        depth: briefPersona.preferences.depth,
      },
      [deepPersona.id]: {
        persona: deepPersona.name,
        delivered_items: deepDigest.items.length,
        depth: deepPersona.preferences.depth,
      },
    },
    failures,
    suggestions,
    details: buildDetails(flags, judgedPairs, scores, adjudicatedCount),
    confidence: judgedPairs.some((pair) => pair.judge.judged) ? 0.84 : 0.58,
  };
}

module.exports = {
  runDepthControlSuite,
};
