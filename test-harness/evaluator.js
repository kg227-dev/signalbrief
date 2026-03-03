const { judgeWithClaudeCached } = require("./cache");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  const arr = (values || []).filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function toRank(values) {
  const pairs = values.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v);
  const ranks = Array(values.length).fill(0);
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].v === pairs[i].v) j++;
    const avgRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[pairs[k].idx] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function pearson(x, y) {
  if (!x.length || x.length !== y.length) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    const xv = x[i] - mx;
    const yv = y[i] - my;
    num += xv * yv;
    dx += xv * xv;
    dy += yv * yv;
  }
  if (!dx || !dy) return 0;
  return num / Math.sqrt(dx * dy);
}

function spearmanCorrelation(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 2) return 0;
  return pearson(toRank(x), toRank(y));
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function sentenceCount(text) {
  const clean = String(text || "").trim();
  if (!clean) return 0;
  return clean.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
}

function syllableCountWord(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const matches = w.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  if (w.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function readingGradeLevel(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const sentences = Math.max(1, sentenceCount(text));
  if (!words.length) return 0;
  const syllables = words.reduce((sum, w) => sum + syllableCountWord(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

function heuristicAnalysisScore(item) {
  const text = String(item?.wim || "");
  const words = wordCount(text);
  const sentences = sentenceCount(text);
  const hasNumber = /\d/.test(text);
  const hasNamedEntityHint = /\b(AI|FDA|FTC|SEC|CFO|CEO|P\&L|earnings|regulatory|portfolio|deal|payer|provider|sponsor)\b/i.test(text);
  const hasActionVerb = /\b(should|need|must|watch|monitor|reprice|stress-test|prioritize|prepare)\b/i.test(text);

  const specificity = clamp((hasNumber ? 4 : 2) + (hasNamedEntityHint ? 1 : 0), 1, 5);
  const strategic_framing = clamp((/\b(implication|strategy|competitive|market|margin|multiple|thesis)\b/i.test(text) ? 4 : 2), 1, 5);
  const actionability = clamp((hasActionVerb ? 4 : 2), 1, 5);
  const differentiation = clamp((words >= 18 ? 3 : 2) + (hasNamedEntityHint ? 1 : 0), 1, 5);
  const brevity_density = clamp((words >= 20 && words <= 85 ? 4 : 2) + (sentences >= 2 ? 1 : 0), 1, 5);
  const overall = mean([specificity, strategic_framing, actionability, differentiation, brevity_density]);

  return {
    specificity,
    strategic_framing,
    actionability,
    differentiation,
    brevity_density,
    overall,
    rationale: "Heuristic fallback score (no live judge result available).",
    judged: false,
  };
}

function normalizeJudgeAnalysisResult(result, fallbackItem) {
  if (!result || typeof result !== "object") return heuristicAnalysisScore(fallbackItem);
  const out = {
    specificity: clamp(Number(result.specificity || 0), 1, 5),
    strategic_framing: clamp(Number(result.strategic_framing || 0), 1, 5),
    actionability: clamp(Number(result.actionability || 0), 1, 5),
    differentiation: clamp(Number(result.differentiation || 0), 1, 5),
    brevity_density: clamp(Number(result.brevity_density || 0), 1, 5),
    overall: clamp(Number(result.overall || 0), 1, 5),
    rationale: String(result.rationale || ""),
    judged: true,
  };
  if (!Number.isFinite(out.overall) || out.overall <= 0) {
    out.overall = mean([
      out.specificity,
      out.strategic_framing,
      out.actionability,
      out.differentiation,
      out.brevity_density,
    ]);
  }
  return out;
}

function normalizeDepthJudgeResult(result, pair) {
  const defaultRes = {
    insight_gain: 2.5,
    deep_more_insight: false,
    likely_padding: true,
    rationale: "Heuristic fallback depth comparison.",
    judged: false,
  };

  if (!result || typeof result !== "object") {
    const deepLen = wordCount(pair.deep || "");
    const briefLen = Math.max(1, wordCount(pair.brief || ""));
    const ratio = deepLen / briefLen;
    return {
      ...defaultRes,
      insight_gain: clamp(1 + ratio, 1, 5),
      deep_more_insight: ratio > 1.7,
      likely_padding: ratio > 1.2 && ratio < 1.7,
    };
  }

  return {
    insight_gain: clamp(Number(result.insight_gain || 0), 1, 5),
    deep_more_insight: !!result.deep_more_insight,
    likely_padding: !!result.likely_padding,
    rationale: String(result.rationale || ""),
    judged: true,
  };
}

async function judgeAnalysisSample(sample, deps) {
  const { appConfig, budget, allowLiveApi, refreshCache, noJudge, costs } = deps;
  if (noJudge) return heuristicAnalysisScore(sample.item);

  const prompt = [
    "You are a strict QA evaluator for SignalBrief consultant-grade analysis.",
    "Score the provided Why-It-Matters text on each dimension from 1 to 5.",
    "Return ONLY JSON with keys: specificity, strategic_framing, actionability, differentiation, brevity_density, overall, rationale.",
    "Rubric guidance:",
    "- specificity: references concrete actors, numbers, mechanisms",
    "- strategic_framing: links to market dynamics, strategy, or competitive implications",
    "- actionability: contains clear decision-maker implication",
    "- differentiation: goes beyond headline restatement",
    "- brevity_density: concise but information-dense",
    "Input:",
    JSON.stringify({
      headline: sample.item?.headline || "",
      summary: sample.item?.summary || "",
      tag: sample.item?.tag || "",
      wim: sample.item?.wim || "",
    }, null, 2),
  ].join("\n");

  try {
    const judged = await judgeWithClaudeCached({
      kind: "analysis_quality_v1",
      payload: {
        headline: sample.item?.headline,
        tag: sample.item?.tag,
        wim: sample.item?.wim,
      },
      prompt,
      maxTokens: 500,
      appConfig,
      budget,
      allowLiveApi,
      refreshCache,
      costs,
    });

    if (judged?.budget) {
      deps.budget.spent = judged.budget.spent;
      deps.budget.remaining = judged.budget.remaining;
      deps.budget.calls = judged.budget.calls;
      deps.budget.cap = judged.budget.cap;
    }

    return normalizeJudgeAnalysisResult(judged.result, sample.item);
  } catch {
    return heuristicAnalysisScore(sample.item);
  }
}

async function judgeDepthPair(pair, deps) {
  const { appConfig, budget, allowLiveApi, refreshCache, noJudge, costs } = deps;
  if (noJudge) return normalizeDepthJudgeResult(null, pair);

  const prompt = [
    "You are evaluating depth quality differences for SignalBrief outputs.",
    "Compare BRIEF vs DEEP versions of the same item.",
    "Return ONLY JSON with keys: insight_gain, deep_more_insight, likely_padding, rationale.",
    "Where insight_gain is 1..5.",
    "Input:",
    JSON.stringify(pair, null, 2),
  ].join("\n");

  try {
    const judged = await judgeWithClaudeCached({
      kind: "depth_compare_v1",
      payload: pair,
      prompt,
      maxTokens: 450,
      appConfig,
      budget,
      allowLiveApi,
      refreshCache,
      costs,
    });

    if (judged?.budget) {
      deps.budget.spent = judged.budget.spent;
      deps.budget.remaining = judged.budget.remaining;
      deps.budget.calls = judged.budget.calls;
      deps.budget.cap = judged.budget.cap;
    }

    return normalizeDepthJudgeResult(judged.result, pair);
  } catch {
    return normalizeDepthJudgeResult(null, pair);
  }
}

function buildEvaluator(deps) {
  return {
    spearmanCorrelation,
    wordCount,
    sentenceCount,
    readingGradeLevel,
    mean,
    judgeAnalysisSample: (sample) => judgeAnalysisSample(sample, deps),
    judgeDepthPair: (pair) => judgeDepthPair(pair, deps),
  };
}

module.exports = {
  clamp,
  mean,
  spearmanCorrelation,
  wordCount,
  sentenceCount,
  readingGradeLevel,
  buildEvaluator,
};
