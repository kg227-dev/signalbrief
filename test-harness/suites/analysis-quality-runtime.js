const { buildDigestForPersona } = require("../runtime/pipeline");
const { mean } = require("../runtime/evaluator");

function selectSourceItems(digest) {
  if (Array.isArray(digest.pre_depth_items) && digest.pre_depth_items.length) {
    return digest.pre_depth_items;
  }
  if (Array.isArray(digest.scored_items)) {
    return digest.scored_items.slice(0, Number(digest.requested_count || 0));
  }
  return digest.items;
}

function collectCandidates(personas, dataset, digestPolicies) {
  const candidates = [];
  for (const persona of personas) {
    const digest = buildDigestForPersona(dataset.enriched_items, persona, digestPolicies);
    const sourceItems = selectSourceItems(digest);
    sourceItems.forEach((item) => {
      if (!item.wim) return;
      candidates.push({
        persona_id: persona.id,
        persona_name: persona.name,
        item,
      });
    });
  }
  return candidates;
}

function buildSamples(candidates, maxSamples) {
  const seen = new Set();
  const samples = [];
  for (const candidate of candidates) {
    const key = `${candidate.persona_id}::${candidate.item.headline}::${candidate.item.wim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(candidate);
    if (samples.length >= maxSamples) break;
  }
  return samples;
}

function buildRunFlags(runtime, evaluator) {
  const runModel = String(runtime.judge_model || "haiku").toLowerCase();
  const supportsModelJudge = typeof evaluator.judgeAnalysisSampleWithModel === "function";
  const noJudge = !!runtime.no_judge;
  return {
    maxSamples: Number(runtime.max_analysis_samples || 12),
    allowSonnetAdjudication: runModel === "haiku" && !noJudge && supportsModelJudge,
    maxAdjudications: Math.max(0, Math.min(Number(runtime.max_sonnet_adjudications || 20), Number(runtime.max_analysis_samples || 12))),
    allowCalibration: runModel === "haiku" && !noJudge && supportsModelJudge,
    calibrationLimit: Math.max(0, Number(runtime.analysis_calibration_samples || 0)),
  };
}

function mergeAdjudicatedScore(score, sonnet) {
  return {
    specificity: (Number(score.specificity || 0) + Number(sonnet.specificity || 0)) / 2,
    strategic_framing: (Number(score.strategic_framing || 0) + Number(sonnet.strategic_framing || 0)) / 2,
    actionability: (Number(score.actionability || 0) + Number(sonnet.actionability || 0)) / 2,
    differentiation: (Number(score.differentiation || 0) + Number(sonnet.differentiation || 0)) / 2,
    brevity_density: (Number(score.brevity_density || 0) + Number(sonnet.brevity_density || 0)) / 2,
    overall: (Number(score.overall || 0) + Number(sonnet.overall || 0)) / 2,
    rationale: `${String(score.rationale || "")} | Sonnet adjudication: ${String(sonnet.rationale || "")}`.trim(),
    judged: true,
    adjudicated: true,
  };
}

function shouldAdjudicate(score, adjudicatedCount, flags) {
  return (
    flags.allowSonnetAdjudication
    && adjudicatedCount < flags.maxAdjudications
    && score?.judged
    && Number(score.overall) >= 3.2
    && Number(score.overall) <= 4.2
  );
}

async function judgeSamples(samples, evaluator, flags) {
  let adjudicatedCount = 0;
  const judgedItems = [];
  for (const sample of samples) {
    let score = await evaluator.judgeAnalysisSample(sample);
    if (shouldAdjudicate(score, adjudicatedCount, flags)) {
      const sonnet = await evaluator.judgeAnalysisSampleWithModel(sample, "sonnet");
      if (sonnet?.judged) {
        score = mergeAdjudicatedScore(score, sonnet);
        adjudicatedCount += 1;
      }
    }
    judgedItems.push({ ...sample, score });
  }
  return { judgedItems, adjudicatedCount };
}

function pickCalibrationRows(judgedItems, calibrationLimit) {
  const ranked = judgedItems
    .map((row, idx) => ({
      idx,
      row,
      boundary_delta: Math.abs(Number(row?.score?.overall || 0) - 4),
    }))
    .sort((a, b) => a.boundary_delta - b.boundary_delta);

  const nearCount = Math.ceil(calibrationLimit / 2);
  return [...ranked.slice(0, nearCount), ...ranked.slice(-Math.floor(calibrationLimit / 2))];
}

async function calibrateRows(judgedItems, evaluator, flags) {
  const calibrationRows = [];
  if (!flags.allowCalibration || flags.calibrationLimit <= 0 || judgedItems.length === 0) {
    return calibrationRows;
  }

  const picks = pickCalibrationRows(judgedItems, flags.calibrationLimit);
  const seen = new Set();
  for (const pick of picks) {
    const sampleRow = pick?.row;
    if (!sampleRow) continue;
    const key = `${sampleRow.persona_id}::${sampleRow.item?.headline || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sonnet = await evaluator.judgeAnalysisSampleWithModel(sampleRow, "sonnet");
    if (!sonnet?.judged) continue;

    const haikuOverall = Number(sampleRow?.score?.overall || 0);
    const sonnetOverall = Number(sonnet.overall || 0);
    const delta = Math.abs(haikuOverall - sonnetOverall);
    calibrationRows.push({
      persona: sampleRow.persona_name,
      headline: sampleRow.item?.headline || "",
      haiku_overall: Number(haikuOverall.toFixed(3)),
      sonnet_overall: Number(sonnetOverall.toFixed(3)),
      abs_delta: Number(delta.toFixed(3)),
      agreement: delta <= 0.75,
    });
    if (calibrationRows.length >= flags.calibrationLimit) break;
  }

  return calibrationRows;
}

function computeDimensionAverages(judgedItems) {
  return {
    specificity: mean(judgedItems.map((item) => item.score.specificity)),
    strategic_framing: mean(judgedItems.map((item) => item.score.strategic_framing)),
    actionability: mean(judgedItems.map((item) => item.score.actionability)),
    differentiation: mean(judgedItems.map((item) => item.score.differentiation)),
    brevity_density: mean(judgedItems.map((item) => item.score.brevity_density)),
    overall: mean(judgedItems.map((item) => item.score.overall)),
  };
}

function computePerPersona(personas, judgedItems) {
  const perPersona = {};
  for (const persona of personas) {
    const mine = judgedItems.filter((item) => item.persona_id === persona.id);
    if (!mine.length) {
      perPersona[persona.id] = {
        persona: persona.name,
        sample_count: 0,
        overall: null,
        score: null,
      };
      continue;
    }
    const avg = mean(mine.map((item) => item.score.overall));
    perPersona[persona.id] = {
      persona: persona.name,
      sample_count: mine.length,
      overall: Number(avg.toFixed(3)),
      score: Number((((avg - 1) / 4) * 100).toFixed(2)),
    };
  }
  return perPersona;
}

function computeAnalysisStatusBand(overall, p25, calibrationRows, calibrationAgreement) {
  let status = "pass";
  if ((overall < 4.0 || p25 < 3.6) && overall >= 3.7 && p25 >= 3.3) status = "warn";
  else if (overall < 4.0 || p25 < 3.6) status = "fail";

  if (status === "pass" && calibrationRows.length >= 3 && calibrationAgreement !== null && calibrationAgreement < 0.55) {
    status = "warn";
  }
  return status;
}

function collectAnalysisFailureDetails(status, overall, p25, p10, dimensionAverages, judgedItems) {
  const failures = [];
  if (status === "pass") return failures;
  failures.push({
    issue: `Analysis quality below gate (mean ${overall.toFixed(2)}/5, p25 ${p25.toFixed(2)}/5; target mean>=4.0 and p25>=3.6).`,
    evidence: {
      dimension_averages: Object.fromEntries(
        Object.entries(dimensionAverages).map(([key, value]) => [key, Number(value.toFixed(3))])
      ),
      sample_count: judgedItems.length,
      p25: Number(p25.toFixed(3)),
      p10: Number(p10.toFixed(3)),
    },
  });
  return failures;
}

function collectAnalysisSuggestions(dimensionAverages, calibrationRows, calibrationAgreement) {
  const suggestions = [];
  const lowDims = Object.entries(dimensionAverages)
    .filter(([key, value]) => key !== "overall" && value < 3.8)
    .map(([key]) => key);

  if (lowDims.includes("specificity")) {
    suggestions.push("Tighten enrichment prompt to require at least one concrete entity/number per WIM paragraph.");
  }
  if (lowDims.includes("actionability")) {
    suggestions.push("Raise priority of implications field in render path so decision-maker actions are explicit in output.");
  }
  if (lowDims.includes("differentiation")) {
    suggestions.push("Add anti-paraphrase guardrails in prompt to penalize headline restatement and require second-order effects.");
  }
  if (calibrationRows.length >= 3 && calibrationAgreement !== null && calibrationAgreement < 0.65) {
    suggestions.push("Haiku/Sonnet calibration agreement is low; escalate borderline analysis samples to Sonnet in certification runs.");
  }

  return suggestions;
}

function buildSuiteDetails({
  flags,
  judgedItems,
  adjudicatedCount,
  p25,
  p10,
  dimensionAverages,
  calibrationRows,
  calibrationDelta,
  calibrationAgreement,
}) {
  return {
    target: "Average overall >= 4.0/5 and P25 >= 3.6/5",
    sample_count: judgedItems.length,
    sonnet_adjudications: adjudicatedCount,
    calibration: {
      enabled: flags.allowCalibration && flags.calibrationLimit > 0,
      sample_count: calibrationRows.length,
      mean_abs_delta: calibrationDelta === null ? null : Number(calibrationDelta.toFixed(3)),
      agreement_rate: calibrationAgreement === null ? null : Number(calibrationAgreement.toFixed(3)),
      rows: calibrationRows,
    },
    p25: Number(p25.toFixed(3)),
    p10: Number(p10.toFixed(3)),
    dimension_averages: Object.fromEntries(
      Object.entries(dimensionAverages).map(([key, value]) => [key, Number(value.toFixed(3))])
    ),
    judged_items: judgedItems.map((row) => ({
      persona: row.persona_name,
      headline: row.item.headline,
      overall: Number(row.score.overall.toFixed(3)),
      judged: !!row.score.judged,
      adjudicated: !!row.score.adjudicated,
    })),
  };
}

function deriveConfidence(judgedItems, calibrationRows, calibrationAgreement) {
  if (!judgedItems.some((item) => item.score.judged)) return 0.55;
  if (calibrationRows.length >= 3 && calibrationAgreement !== null) {
    return Math.max(0.72, Math.min(0.93, 0.72 + calibrationAgreement * 0.21));
  }
  return 0.88;
}

async function runAnalysisQualitySuite(context, suiteMeta) {
  const { personas, dataset, runtime, evaluator } = context;
  const flags = buildRunFlags(runtime, evaluator);
  const candidates = collectCandidates(personas, dataset, runtime.digestPolicies);
  const samples = buildSamples(candidates, flags.maxSamples);
  const { judgedItems, adjudicatedCount } = await judgeSamples(samples, evaluator, flags);
  const calibrationRows = await calibrateRows(judgedItems, evaluator, flags);

  const overallScores = judgedItems.map((item) => Number(item.score.overall)).filter(Number.isFinite);
  const p25 = evaluator.percentile(overallScores, 0.25);
  const p10 = evaluator.percentile(overallScores, 0.1);
  const dimensionAverages = computeDimensionAverages(judgedItems);
  const perPersona = computePerPersona(personas, judgedItems);

  const overall = Number(dimensionAverages.overall.toFixed(3));
  const suiteScore = Number((((overall - 1) / 4) * 100).toFixed(2));
  const calibrationAgreement = calibrationRows.length
    ? mean(calibrationRows.map((row) => (row.agreement ? 1 : 0)))
    : null;
  const calibrationDelta = calibrationRows.length
    ? mean(calibrationRows.map((row) => Number(row.abs_delta || 0)))
    : null;

  const status = computeAnalysisStatusBand(overall, p25, calibrationRows, calibrationAgreement);
  const failures = collectAnalysisFailureDetails(status, overall, p25, p10, dimensionAverages, judgedItems);
  const suggestions = collectAnalysisSuggestions(dimensionAverages, calibrationRows, calibrationAgreement);

  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
    score: suiteScore,
    score_label: `${overall.toFixed(2)}/5`,
    status,
    per_persona: perPersona,
    failures,
    suggestions,
    details: buildSuiteDetails({
      flags,
      judgedItems,
      adjudicatedCount,
      p25,
      p10,
      dimensionAverages,
      calibrationRows,
      calibrationDelta,
      calibrationAgreement,
    }),
    confidence: deriveConfidence(judgedItems, calibrationRows, calibrationAgreement),
  };
}

module.exports = {
  runAnalysisQualitySuite,
};
