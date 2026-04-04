"use strict";

const fs = require("fs");
const path = require("path");
const {
  readJson,
  readManifest,
  markPhaseComplete,
} = require("./manifest-runtime");

function formatPct(rate, count, total) {
  return `${Math.round(rate * 100)}% (${count}/${total})`;
}

function computeAggregates(rows, baselineVariant, compareVariant) {
  baselineVariant = baselineVariant || "baseline";

  const variants = Array.from(new Set(rows.map(function(r) { return r.variant; })));
  const topics = Array.from(new Set(rows.map(function(r) { return r.topic; })));
  const inputModes = Array.from(new Set(rows.map(function(r) { return r.inputMode; })));

  function statsForFilter(filterFn) {
    const subset = rows.filter(filterFn);
    const total = subset.length;
    const passCount = subset.filter(function(r) { return r.passFail === "pass"; }).length;
    const passRate = total > 0 ? passCount / total : 0;
    const avgScore = total > 0
      ? Math.round((subset.reduce(function(s, r) { return s + (r.overallScore || 0); }, 0) / total) * 10) / 10
      : 0;
    const catastrophicCount = subset.filter(function(r) { return r.isCatastrophicFailure; }).length;
    const genericClicheCount = subset.filter(function(r) {
      const tags = r.failureTags || [];
      return tags.includes("GENERIC") || tags.includes("CATEGORY_CLICHE");
    }).length;
    const genericClicheRate = total > 0 ? genericClicheCount / total : 0;
    return { total, passCount, passRate, avgScore, catastrophicCount, genericClicheCount, genericClicheRate };
  }

  const byVariant = {};
  for (const v of variants) {
    byVariant[v] = statsForFilter(function(r) { return r.variant === v; });
  }

  const byTopic = {};
  for (const topic of topics) {
    byTopic[topic] = {};
    for (const v of variants) {
      byTopic[topic][v] = statsForFilter(function(r) { return r.topic === topic && r.variant === v; });
    }
  }

  const byInputMode = {};
  for (const mode of inputModes) {
    byInputMode[mode] = {};
    for (const v of variants) {
      byInputMode[mode][v] = statsForFilter(function(r) { return r.inputMode === mode && r.variant === v; });
    }
  }

  const byGoldSet = {};
  for (const v of variants) {
    byGoldSet[v] = statsForFilter(function(r) { return r.inGoldSet && r.variant === v; });
  }

  const consistency = {};
  for (const topic of topics) {
    consistency[topic] = {};
    for (const v of variants) {
      const subset = rows.filter(function(r) { return r.topic === topic && r.variant === v; });
      if (subset.length < 2) { consistency[topic][v] = null; continue; }
      const scores = subset.map(function(r) { return r.overallScore || 0; });
      const mean = scores.reduce(function(s, x) { return s + x; }, 0) / scores.length;
      const variance = scores.reduce(function(s, x) { return s + Math.pow(x - mean, 2); }, 0) / scores.length;
      consistency[topic][v] = Math.round(Math.sqrt(variance) * 100) / 100;
    }
  }

  const failureTagCounts = {};
  for (const v of variants) {
    const tagMap = {};
    rows
      .filter(function(r) { return r.variant === v && r.failureTags && r.failureTags.length > 0; })
      .forEach(function(r) {
        (r.failureTags || []).forEach(function(t) { tagMap[t] = (tagMap[t] || 0) + 1; });
      });
    failureTagCounts[v] = tagMap;
  }

  return { variants, topics, inputModes, byVariant, byTopic, byInputMode, byGoldSet, consistency, failureTagCounts };
}

function buildReportCsv(judgedRows, datasetItems, baselineVariant) {
  baselineVariant = baselineVariant || "baseline";
  const itemById = {};
  for (const item of datasetItems) { itemById[item.id] = item; }

  const baselineScoreMap = {};
  judgedRows.filter(function(r) { return r.variant === baselineVariant; }).forEach(function(r) {
    baselineScoreMap[`${r.id}:${r.inputMode}`] = { overallScore: r.overallScore, passFail: r.passFail };
  });

  const header = [
    "id", "date", "topic", "source_domain", "url", "variant", "promptVersion", "inputMode",
    "judgeModel", "rubricVersion", "passFail", "overallScore",
    "specificity", "insightDepth", "strategicRelevance", "nonRedundancy", "clarityTightness",
    "failureTags", "isCatastrophicFailure", "primaryFailureReason",
    "inGoldSet", "isBaseline", "compareAgainst", "scoreDeltaVsBaseline", "passDeltaVsBaseline",
    "generatedWim",
  ].join(",");

  function esc(v) {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    return s;
  }

  const lines = [header];
  for (const row of judgedRows) {
    const item = itemById[row.id] || {};
    const isBaseline = row.variant === baselineVariant;
    const baseKey = `${row.id}:${row.inputMode}`;
    const baseRef = baselineScoreMap[baseKey];
    const scoreDelta = baseRef ? Math.round((row.overallScore - baseRef.overallScore) * 10) / 10 : "";
    const passDelta = baseRef ? (row.passFail === "pass" ? 1 : 0) - (baseRef.passFail === "pass" ? 1 : 0) : "";
    lines.push([
      esc(row.id), esc(item.date || row.id.split(":")[0]), esc(row.topic), esc(item.source_domain), esc(item.url),
      esc(row.variant), esc(row.promptVersion), esc(row.inputMode),
      esc(row.judgeModel), esc(row.rubricVersion), esc(row.passFail), esc(row.overallScore),
      esc(row.scores && row.scores.specificity), esc(row.scores && row.scores.insightDepth),
      esc(row.scores && row.scores.strategicRelevance), esc(row.scores && row.scores.nonRedundancy),
      esc(row.scores && row.scores.clarityTightness),
      esc((row.failureTags || []).join("|")), esc(row.isCatastrophicFailure), esc(row.primaryFailureReason),
      esc(item.inGoldSet), esc(isBaseline), esc(isBaseline ? "" : baselineVariant),
      esc(scoreDelta), esc(passDelta), esc(row.generatedWim),
    ].join(","));
  }
  return lines.join("\n");
}

function buildHumanReviewCsv(judgedRows, datasetItems, baselineVariant, compareVariant) {
  baselineVariant = baselineVariant || "baseline";
  const itemById = {};
  for (const item of datasetItems) { itemById[item.id] = item; }

  const goldIds = new Set(judgedRows.filter(function(r) { return r.inGoldSet; }).map(function(r) { return r.id; }));

  const goldByItem = {};
  for (const id of goldIds) {
    goldByItem[id] = {};
    for (const row of judgedRows) {
      if (row.id !== id) continue;
      if (row.variant !== baselineVariant && row.variant !== compareVariant) continue;
      if (!goldByItem[id][row.variant] || row.inputMode === "minimal") {
        goldByItem[id][row.variant] = row;
      }
    }
  }

  function esc(v) {
    if (v == null) return "";
    const s = String(v).replace(/\r?\n/g, " ");
    return `"${s.replace(/"/g, '""')}"`;
  }

  const header = "id,topic,headline,label_a_is,wim_a,wim_b,winner,preferred_reason_tag,notes";
  const lines = [header];

  for (const id of Array.from(goldIds).sort()) {
    const baseRow = goldByItem[id] && goldByItem[id][baselineVariant];
    const compRow = goldByItem[id] && goldByItem[id][compareVariant];
    if (!baseRow && !compRow) continue;

    const item = itemById[id] || {};
    const hashBit = id.charCodeAt(id.length - 1) % 2;
    const labelAIs = hashBit === 0 ? baselineVariant : compareVariant;
    const wimA = labelAIs === baselineVariant
      ? (baseRow && baseRow.generatedWim || "")
      : (compRow && compRow.generatedWim || "");
    const wimB = labelAIs === baselineVariant
      ? (compRow && compRow.generatedWim || "")
      : (baseRow && baseRow.generatedWim || "");

    lines.push([
      esc(id), esc(item.topic), esc(item.headline), esc(labelAIs),
      esc(wimA), esc(wimB), "", "", "",
    ].join(","));
  }
  return lines.join("\n");
}

function buildSummaryMd(agg, manifest, judgedRows, datasetItems, rubric) {
  const baseV = manifest.compareAgainst || "baseline";
  const variants = agg.variants;
  const topics = agg.topics;

  function pct(rate, count, total) { return formatPct(rate, count, total); }

  function checkGates(v) {
    const s = agg.byVariant[v] || {};
    const ship = (rubric && rubric.shipGate) || {};
    return [
      { name: "Pass rate ≥75%", threshold: "75%", actual: `${Math.round((s.passRate || 0) * 100)}%`, pass: (s.passRate || 0) >= (ship.minPassRate || 0.75) },
      { name: "Catastrophic failures = 0", threshold: "0", actual: String(s.catastrophicCount || 0), pass: (s.catastrophicCount || 0) === 0 },
      { name: "Generic/cliché rate ≤10%", threshold: "10%", actual: `${Math.round((s.genericClicheRate || 0) * 100)}%`, pass: (s.genericClicheRate || 0) <= (ship.genericClicheMaxRate || 0.10) },
    ];
  }

  const itemById = {};
  for (const item of datasetItems) { itemById[item.id] = item; }

  const baselineMap = {};
  judgedRows.filter(function(r) { return r.variant === baseV; })
    .forEach(function(r) { baselineMap[`${r.id}:${r.inputMode}`] = r; });

  const compareRows = judgedRows.filter(function(r) { return r.variant !== baseV && agg.byVariant[r.variant] !== undefined; });
  const scoredDelta = compareRows.map(function(r) {
    const bRow = baselineMap[`${r.id}:${r.inputMode}`];
    return { row: r, delta: bRow ? (r.overallScore - bRow.overallScore) : 0 };
  }).sort(function(a, b) { return b.delta - a.delta; });

  const notableWins = scoredDelta.filter(function(d) { return d.delta > 0; }).slice(0, 3);
  const notableFails = scoredDelta.filter(function(d) { return d.row.passFail === "fail"; }).slice(-3).reverse();

  let recommendation = "PENDING HUMAN REVIEW";
  let recommendationReason = "Human A/B review on gold set not yet completed.";
  const evalVariants = variants.filter(function(x) { return x !== baseV; });
  const evalTargets = evalVariants.length > 0 ? evalVariants : variants;
  for (const v of evalTargets) {
    const gates = checkGates(v);
    if (gates.every(function(g) { return g.pass; })) {
      recommendation = evalVariants.length > 0 ? `CONDITIONAL SHIP — ${v}` : "CONDITIONAL SHIP — baseline";
      recommendationReason = `${v} passes all model-only gates. Human A/B review required to confirm.`;
    } else {
      const failed = gates.filter(function(g) { return !g.pass; }).map(function(g) { return g.name; }).join(", ");
      recommendation = `NO SHIP — ${v} fails: ${failed}`;
      recommendationReason = `${v} does not meet quality thresholds.`;
    }
  }

  const lines = [];
  lines.push(`# WIM Eval Summary — Run ${manifest.runId}`);
  lines.push(`\n**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Judge:** ${manifest.judgeModel || "unknown"} | **Generation:** ${manifest.generationModel || "unknown"} | **Rubric:** ${manifest.rubricVersion || "unknown"}`);

  lines.push(`\n## 1. Recommendation`);
  lines.push(`\n**${recommendation}**`);
  lines.push(`\n${recommendationReason}`);
  if (notableWins[0]) lines.push(`\n**Biggest improvement:** ${notableWins[0].row.id} (+${notableWins[0].delta.toFixed(1)} vs baseline)`);
  if (notableFails[0]) lines.push(`**Biggest remaining risk:** ${notableFails[0].row.id} — tags: ${(notableFails[0].row.failureTags || []).join(", ") || "none"}`);

  lines.push(`\n## 2. Overall`);
  lines.push(`\n| Metric | ${variants.join(" | ")} |`);
  lines.push(`|---|${variants.map(function() { return "---"; }).join("|")}|`);
  lines.push(`| Pass rate | ${variants.map(function(v) { const s = agg.byVariant[v] || {}; return pct(s.passRate || 0, s.passCount || 0, s.total || 0); }).join(" | ")} |`);
  lines.push(`| Avg score | ${variants.map(function(v) { return (agg.byVariant[v] || {}).avgScore || 0; }).join(" | ")} |`);
  lines.push(`| Catastrophic | ${variants.map(function(v) { return (agg.byVariant[v] || {}).catastrophicCount || 0; }).join(" | ")} |`);
  lines.push(`| Generic rate | ${variants.map(function(v) { const s = agg.byVariant[v] || {}; return `${Math.round((s.genericClicheRate || 0) * 100)}%`; }).join(" | ")} |`);

  lines.push(`\n## 3. Gold Set Results`);
  lines.push(`\n| Metric | ${variants.join(" | ")} |`);
  lines.push(`|---|${variants.map(function() { return "---"; }).join("|")}|`);
  lines.push(`| Pass rate | ${variants.map(function(v) { const s = agg.byGoldSet[v] || {}; return pct(s.passRate || 0, s.passCount || 0, s.total || 0); }).join(" | ")} |`);
  lines.push(`| Avg score | ${variants.map(function(v) { return (agg.byGoldSet[v] || {}).avgScore || 0; }).join(" | ")} |`);
  lines.push(`| Catastrophic | ${variants.map(function(v) { return (agg.byGoldSet[v] || {}).catastrophicCount || 0; }).join(" | ")} |`);
  lines.push(`| Human A/B | ${variants.map(function() { return "(see human-review.csv)"; }).join(" | ")} |`);

  lines.push(`\n## 4. By Topic`);
  lines.push(`\n| Topic | ${variants.map(function(v) { return `${v} pass%`; }).join(" | ")} | Delta | Regression? |`);
  lines.push(`|---|${variants.map(function() { return "---"; }).join("|")}|---|---|`);
  for (const topic of topics) {
    const baseStats = ((agg.byTopic[topic] || {})[baseV]) || {};
    const baseRate = baseStats.passRate || 0;
    const cells = variants.map(function(v) { const s = (agg.byTopic[topic] || {})[v] || {}; return pct(s.passRate || 0, s.passCount || 0, s.total || 0); });
    const delta = variants.filter(function(v) { return v !== baseV; }).map(function(v) {
      const s = (agg.byTopic[topic] || {})[v] || {};
      return `${Math.round(((s.passRate || 0) - baseRate) * 100)}pp`;
    }).join(", ");
    const regression = variants.filter(function(v) { return v !== baseV; }).some(function(v) {
      const s = (agg.byTopic[topic] || {})[v] || {};
      return ((s.passRate || 0) - baseRate) < -0.10 || (s.catastrophicCount || 0) > 0;
    }) ? "⚠️ YES" : "✓";
    lines.push(`| ${topic} | ${cells.join(" | ")} | ${delta} | ${regression} |`);
  }

  lines.push(`\n## 5. Failure Pattern Analysis`);
  for (const v of variants) {
    const tagCounts = agg.failureTagCounts[v] || {};
    const sorted = Object.keys(tagCounts).sort(function(a, b) { return tagCounts[b] - tagCounts[a]; });
    lines.push(`\n**${v}:** ${sorted.map(function(t) { return `${t}=${tagCounts[t]}`; }).join(", ") || "none"}`);
  }

  lines.push(`\n## 6. By Input Mode`);
  lines.push(`\n| Mode | ${variants.map(function(v) { return `${v} pass%`; }).join(" | ")} |`);
  lines.push(`|---|${variants.map(function() { return "---"; }).join("|")}|`);
  for (const mode of agg.inputModes) {
    const cells = variants.map(function(v) { const s = (agg.byInputMode[mode] || {})[v] || {}; return pct(s.passRate || 0, s.passCount || 0, s.total || 0); });
    lines.push(`| ${mode} | ${cells.join(" | ")} |`);
  }

  lines.push(`\n## 7. Consistency / Variance Check`);
  lines.push(`\nScore standard deviation by topic × variant. High variance (>1.5) signals inconsistent output quality.`);
  lines.push(`\n| Topic | ${variants.join(" | ")} |`);
  lines.push(`|---|${variants.map(function() { return "---"; }).join("|")}|`);
  for (const topic of topics) {
    const cells = variants.map(function(v) { const std = (agg.consistency[topic] || {})[v]; return std != null ? std.toFixed(2) : "n/a"; });
    lines.push(`| ${topic} | ${cells.join(" | ")} |`);
  }

  lines.push(`\n## 8. Notable Wins / Notable Fails`);
  lines.push(`\n### Top improvements vs baseline`);
  if (notableWins.length === 0) lines.push("_(none with positive delta)_");
  for (const d of notableWins) {
    const item = itemById[d.row.id] || {};
    lines.push(`- **${d.row.id}** (+${d.delta.toFixed(1)}): *"${(item.headline || "").slice(0, 80)}"*`);
    if (d.row.generatedWim) lines.push(`  WIM: ${d.row.generatedWim.slice(0, 120)}`);
  }
  lines.push(`\n### Worst remaining failures`);
  if (notableFails.length === 0) lines.push("_(none)_");
  for (const d of notableFails) {
    const item = itemById[d.row.id] || {};
    lines.push(`- **${d.row.id}** [${(d.row.failureTags || []).join(", ") || "no tags"}]: *"${(item.headline || "").slice(0, 80)}"*`);
    if (d.row.generatedWim) lines.push(`  WIM: ${d.row.generatedWim.slice(0, 120)}`);
  }

  lines.push(`\n## 9. Ship Gate Assessment`);
  lines.push(`\n### Model-only gates`);
  const gatedVariants = variants.filter(function(x) { return x !== baseV; });
  const showVariants = gatedVariants.length > 0 ? gatedVariants : variants;
  for (const v of showVariants) {
    if (showVariants.length > 1) lines.push(`\n**${v}:**`);
    lines.push(`| Gate | Threshold | Actual | Pass? |`);
    lines.push(`|---|---|---|---|`);
    for (const g of checkGates(v)) {
      lines.push(`| ${g.name} | ${g.threshold} | ${g.actual} | ${g.pass ? "✓" : "✗"} |`);
    }
  }
  lines.push(`\n### Human-review gate (pending)`);
  lines.push(`| Gate | Threshold | Status |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Human A/B preference ≥60% | 60% | Fill human-review.csv to assess |`);

  lines.push(`\n## 10. Next Actions`);
  lines.push(`\n1. Fill \`human-review.csv\` — blind A/B review of gold set pairs`);
  lines.push(`2. Re-run \`--phase=report\` or update summary manually after human review`);
  const topTags = variants.map(function(v) {
    const t = Object.keys(agg.failureTagCounts[v] || {}).sort(function(a, b) {
      return (agg.failureTagCounts[v][b] || 0) - (agg.failureTagCounts[v][a] || 0);
    })[0];
    return t ? `${v}→${t}` : null;
  }).filter(Boolean).join(", ");
  lines.push(`3. Address top failure modes: ${topTags || "none"}`);

  return lines.join("\n");
}

async function runReportPhase(opts) {
  const { runDir, rubricPath, overwrite } = opts;

  const reportCsvPath = path.join(runDir, "report.csv");
  const summaryPath = path.join(runDir, "summary.md");
  const humanReviewPath = path.join(runDir, "human-review.csv");

  if (!overwrite && fs.existsSync(reportCsvPath)) {
    throw new Error(`report.csv already exists in ${runDir}. Use --overwrite=true to overwrite.`);
  }

  const manifest = readManifest(runDir);
  const judged = readJson(path.join(runDir, "judged.json"));
  const dataset = readJson(path.join(runDir, "dataset.json"));
  const rubric = JSON.parse(fs.readFileSync(rubricPath, "utf8"));

  const rows = judged.rows || [];
  const datasetItems = dataset.items || [];

  const inGoldSetById = {};
  for (const item of datasetItems) { inGoldSetById[item.id] = item.inGoldSet; }
  rows.forEach(function(r) { r.inGoldSet = inGoldSetById[r.id] || false; });

  const baselineVariant = manifest.compareAgainst || "baseline";
  const compareVariants = Array.from(new Set(rows.map(function(r) { return r.variant; }))).filter(function(v) { return v !== baselineVariant; });
  const compareVariant = compareVariants[0] || null;

  const agg = computeAggregates(rows, baselineVariant, compareVariant);
  const csv = buildReportCsv(rows, datasetItems, baselineVariant);
  const md = buildSummaryMd(agg, manifest, rows, datasetItems, rubric);
  const humanCsv = compareVariant
    ? buildHumanReviewCsv(rows, datasetItems, baselineVariant, compareVariant)
    : "id,topic,headline,label_a_is,wim_a,wim_b,winner,preferred_reason_tag,notes\n";

  fs.writeFileSync(reportCsvPath, csv, "utf8");
  fs.writeFileSync(summaryPath, md, "utf8");
  fs.writeFileSync(humanReviewPath, humanCsv, "utf8");

  markPhaseComplete(runDir, "report");

  return { reportCsvPath, summaryPath, humanReviewPath };
}

module.exports = {
  computeAggregates,
  buildReportCsv,
  buildHumanReviewCsv,
  buildSummaryMd,
  runReportPhase,
  formatPct,
};
