"use strict";

const fs = require("fs");
const path = require("path");
const {
  writeJsonAtomic,
  readJson,
  updateManifest,
  markPhaseComplete,
} = require("./manifest-runtime");
const { callClaude } = require("./generator-runtime");

const CATASTROPHIC_TAGS = new Set(["WRONG_IMPLICATION", "OVERCONFIDENT", "NOT_GROUNDED_IN_ARTICLE"]);

function computeOverallScore(scores) {
  const dims = ["specificity", "insightDepth", "strategicRelevance", "nonRedundancy", "clarityTightness"];
  const sum = dims.reduce(function(acc, k) { return acc + (scores[k] || 0); }, 0);
  return Math.round((sum / dims.length) * 10) / 10;
}

function buildJudgePrompt(rubric, item, generatedWim, inputMode) {
  const excerptLine = (inputMode === "enhanced" && item.excerpt)
    ? `\nExcerpt: ${String(item.excerpt).slice(0, 500)}`
    : "";

  const criteriaText = rubric.passFail.criteria.map(function(c, i) { return `${i + 1}. ${c}`; }).join("\n");
  const dimsText = rubric.scoreDimensions.map(function(d) { return `- ${d.key} (${d.label}): 1-5`; }).join("\n");
  const tagsText = rubric.failureTags.join(", ");
  const catTags = (rubric.catastrophicCriteria && rubric.catastrophicCriteria.tags || []).join(", ");

  return `You are evaluating a "Why It Matters" (WIM) writeup for SignalBrief, a sector intelligence briefing for strategy professionals.

Article:
Headline: ${item.headline || ""}
Summary: ${item.summary || ""}${excerptLine}

WIM under evaluation:
"${generatedWim}"

PASS/FAIL CRITERIA — ALL must be true for a PASS:
${criteriaText}

SCORE DIMENSIONS — rate each 1-5:
${dimsText}

FAILURE TAGS — apply all that fit:
${tagsText}

CATASTROPHIC tags (always mean FAIL and set isCatastrophicFailure=true): ${catTags}

Return ONLY a JSON object with exactly these fields:
{
  "passFail": "pass" or "fail",
  "scores": { "specificity": N, "insightDepth": N, "strategicRelevance": N, "nonRedundancy": N, "clarityTightness": N },
  "failureTags": [],
  "isCatastrophicFailure": true or false,
  "primaryFailureReason": "one sentence if fail, null if pass",
  "judgeRationale": "one sentence explaining the main reason for pass or fail"
}
No markdown, no explanation outside the JSON object.`;
}

function parseJudgeResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { obj = JSON.parse(match[0]); } catch (_2) { return null; }
  }

  const failureTags = Array.isArray(obj.failureTags) ? obj.failureTags : [];
  const hasCatastrophicTag = failureTags.some(function(t) { return CATASTROPHIC_TAGS.has(t); });

  return {
    passFail: obj.passFail === "pass" ? "pass" : "fail",
    scores: {
      specificity: Number(obj.scores && obj.scores.specificity) || 1,
      insightDepth: Number(obj.scores && obj.scores.insightDepth) || 1,
      strategicRelevance: Number(obj.scores && obj.scores.strategicRelevance) || 1,
      nonRedundancy: Number(obj.scores && obj.scores.nonRedundancy) || 1,
      clarityTightness: Number(obj.scores && obj.scores.clarityTightness) || 1,
    },
    failureTags,
    isCatastrophicFailure: hasCatastrophicTag || obj.isCatastrophicFailure === true,
    primaryFailureReason: obj.primaryFailureReason || null,
    judgeRationale: obj.judgeRationale || null,
  };
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function runJudgePhase(opts) {
  const { runDir, rubricPath, judgeModel, limit, overwrite, apiKey, goldSetOnly } = opts;

  const judgedPath = path.join(runDir, "judged.json");
  if (!overwrite && fs.existsSync(judgedPath)) {
    throw new Error(`judged.json already exists in ${runDir}. Use --overwrite=true to overwrite.`);
  }

  const rubric = JSON.parse(fs.readFileSync(rubricPath, "utf8"));
  const generated = readJson(path.join(runDir, "generated.json"));
  const dataset = readJson(path.join(runDir, "dataset.json"));
  const goldSet = readJson(path.join(runDir, "gold-set.json"));

  const goldIds = new Set((goldSet.items || []).map(function(g) { return g.id; }));
  const itemById = {};
  for (const item of dataset.items) { itemById[item.id] = item; }

  let rows = generated.rows || [];
  if (goldSetOnly) rows = rows.filter(function(r) { return goldIds.has(r.id); });
  if (limit) rows = rows.slice(0, limit);

  const model = judgeModel || "claude-sonnet-4-6";
  const judgedRows = [];

  for (const row of rows) {
    const item = itemById[row.id];
    if (!item || !row.generatedWim) {
      judgedRows.push(Object.assign({}, row, {
        judgeModel: model,
        rubricVersion: rubric.rubricVersion,
        passFail: "fail",
        overallScore: 1.0,
        scores: { specificity: 1, insightDepth: 1, strategicRelevance: 1, nonRedundancy: 1, clarityTightness: 1 },
        failureTags: ["GENERIC"],
        isCatastrophicFailure: false,
        primaryFailureReason: "WIM was not generated.",
        judgeRationale: "Generation failed or returned null.",
        judgedAt: new Date().toISOString(),
      }));
      continue;
    }

    const prompt = buildJudgePrompt(rubric, item, row.generatedWim, row.inputMode);
    let judgeResult = null;

    try {
      const response = await callClaude(apiKey, model, prompt, 600, 0.1);
      const text = (response && response.content && response.content[0] && response.content[0].text) || "";
      judgeResult = parseJudgeResponse(text);
    } catch (err) {
      process.stderr.write(`[wim-eval] judge error ${row.id} ${row.variant} ${row.inputMode}: ${err.message}\n`);
    }

    if (!judgeResult) {
      judgeResult = {
        passFail: "fail",
        scores: { specificity: 1, insightDepth: 1, strategicRelevance: 1, nonRedundancy: 1, clarityTightness: 1 },
        failureTags: ["GENERIC"],
        isCatastrophicFailure: false,
        primaryFailureReason: "Judge model failed to return valid JSON.",
        judgeRationale: "Parse error.",
      };
    }

    judgedRows.push(Object.assign({}, row, {
      judgeModel: model,
      rubricVersion: rubric.rubricVersion,
      passFail: judgeResult.passFail,
      overallScore: computeOverallScore(judgeResult.scores),
      scores: judgeResult.scores,
      failureTags: judgeResult.failureTags,
      isCatastrophicFailure: judgeResult.isCatastrophicFailure,
      primaryFailureReason: judgeResult.primaryFailureReason,
      judgeRationale: judgeResult.judgeRationale,
      judgedAt: new Date().toISOString(),
    }));

    await sleep(150);
  }

  writeJsonAtomic(judgedPath, { rows: judgedRows });
  updateManifest(runDir, { judgeModel: model, rubricVersion: rubric.rubricVersion });
  markPhaseComplete(runDir, "judge");

  return { rows: judgedRows };
}

module.exports = {
  computeOverallScore,
  buildJudgePrompt,
  parseJudgeResponse,
  runJudgePhase,
};
