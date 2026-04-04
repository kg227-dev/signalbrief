#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { loadConfig } = require("../platform/config");

const {
  createRun,
  readManifest,
  ensureDir,
} = require("../eval/wim/manifest-runtime");
const { resolveArchiveDates, runDatasetPhase } = require("../eval/wim/dataset-builder");
const { runGeneratePhase } = require("../eval/wim/generator-runtime");
const { runJudgePhase } = require("../eval/wim/judge-runtime");
const { runReportPhase } = require("../eval/wim/report-runtime");

const APP_ROOT = path.join(__dirname, "../..");
const DEFAULT_OUTPUT_DIR = path.join(APP_ROOT, "data/wim-evals");
const DEFAULT_PROMPT_DIR = path.join(APP_ROOT, "evals/prompts");
const DEFAULT_RUBRIC_PATH = path.join(APP_ROOT, "evals/config/judge-rubric.json");
const ARCHIVE_DIR = path.join(APP_ROOT, "archive");

function parseArgs(argv) {
  const args = {
    phase: null,
    run: null,
    dates: null,
    variants: null,
    model: "claude-sonnet-4-6",
    judgeModel: null,
    inputModes: ["minimal", "enhanced"],
    goldSetOnly: false,
    promptDir: DEFAULT_PROMPT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    goldSetPath: null,
    limit: null,
    overwrite: false,
  };

  for (const token of (argv || [])) {
    if (token === "--help") { printHelp(); process.exit(0); }
    if (token.startsWith("--phase=")) { args.phase = token.slice("--phase=".length); continue; }
    if (token.startsWith("--run=")) { args.run = token.slice("--run=".length); continue; }
    if (token.startsWith("--dates=")) { args.dates = token.slice("--dates=".length).split(",").map(function(s) { return s.trim(); }).filter(Boolean); continue; }
    if (token.startsWith("--variants=")) { args.variants = token.slice("--variants=".length).split(",").map(function(s) { return s.trim(); }).filter(Boolean); continue; }
    if (token.startsWith("--model=")) { args.model = token.slice("--model=".length).trim(); continue; }
    if (token.startsWith("--judge-model=")) { args.judgeModel = token.slice("--judge-model=".length).trim(); continue; }
    if (token.startsWith("--input-modes=")) { args.inputModes = token.slice("--input-modes=".length).split(",").map(function(s) { return s.trim(); }).filter(Boolean); continue; }
    if (token === "--gold-set-only") { args.goldSetOnly = true; continue; }
    if (token.startsWith("--prompt-dir=")) { args.promptDir = path.resolve(token.slice("--prompt-dir=".length).trim()); continue; }
    if (token.startsWith("--output-dir=")) { args.outputDir = path.resolve(token.slice("--output-dir=".length).trim()); continue; }
    if (token.startsWith("--gold-set-path=")) { args.goldSetPath = path.resolve(token.slice("--gold-set-path=".length).trim()); continue; }
    if (token.startsWith("--limit=")) { args.limit = Number(token.slice("--limit=".length).trim()) || null; continue; }
    if (token.startsWith("--overwrite=")) { args.overwrite = token.slice("--overwrite=".length).trim() === "true"; continue; }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`
wim-eval — WIM evaluation harness

Usage: node src/entrypoints/wim-eval.js --phase=<phase> [options]

Phases:
  dataset     Load archive items, propose gold set
  generate    Generate WIMs per variant x input mode
  judge       Judge WIMs against rubric
  report      Build report.csv, summary.md, human-review.csv

Options:
  --phase=dataset|generate|judge|report
  --run=YYYY-MM-DD-HH                     (required for generate/judge/report)
  --dates=YYYY-MM-DD,...                  (dataset: default last 7 available)
  --variants=baseline,variant-a,...       (generate: default all in --prompt-dir)
  --model=claude-sonnet-4-6
  --judge-model=claude-sonnet-4-6         (judge only; overrides --model)
  --input-modes=minimal,enhanced
  --gold-set-only                         (judge/report: gold set items only)
  --prompt-dir=evals/prompts
  --output-dir=data/wim-evals
  --gold-set-path=...
  --limit=N                               (smoke test: first N items only)
  --overwrite=true|false                  (default: false)
  --help
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.phase) {
    process.stderr.write("[wim-eval] --phase is required. Run --help for usage.\n");
    process.exit(1);
  }

  const CONFIG = loadConfig();
  const apiKey = CONFIG && CONFIG.keys && CONFIG.keys.anthropic;
  if (!apiKey && (args.phase === "generate" || args.phase === "judge")) {
    process.stderr.write("[wim-eval] ANTHROPIC_API_KEY (or SIGNALBRIEF_ANTHROPIC_API_KEY) is required for generate/judge phases.\n");
    process.exit(1);
  }

  ensureDir(args.outputDir);

  if (args.phase === "dataset") {
    const dates = args.dates && args.dates.length > 0
      ? args.dates
      : resolveArchiveDates(ARCHIVE_DIR, null);

    const { runId, runDir } = createRun(args.outputDir, {
      archiveDates: dates,
      inputModes: args.inputModes,
      promptDir: path.relative(APP_ROOT, args.promptDir),
      outputDir: path.relative(APP_ROOT, args.outputDir),
    });

    const result = runDatasetPhase({
      archiveDir: ARCHIVE_DIR,
      runDir,
      dates,
      limit: args.limit,
      overwrite: args.overwrite,
    });

    process.stdout.write(JSON.stringify({
      runId,
      runDir,
      itemCount: result.dataset.meta.totalItems,
      goldSetSize: result.goldSet.items.length,
      topics: result.dataset.meta.topics,
      nextStep: `Review ${path.join(runDir, "gold-set.json")}, set goldSetApproved:true, then run --phase=generate --run=${runId}`,
    }, null, 2) + "\n");
    return;
  }

  if (!args.run) {
    process.stderr.write("[wim-eval] --run=YYYY-MM-DD-HH is required for generate/judge/report phases.\n");
    process.exit(1);
  }

  const runDir = path.join(args.outputDir, args.run);
  if (!fs.existsSync(runDir)) {
    process.stderr.write(`[wim-eval] Run directory not found: ${runDir}\n`);
    process.exit(1);
  }

  if (args.phase === "generate") {
    const result = await runGeneratePhase({
      runDir,
      promptDir: args.promptDir,
      variants: args.variants,
      inputModes: args.inputModes,
      model: args.model,
      limit: args.limit,
      overwrite: args.overwrite,
      apiKey,
    });
    process.stdout.write(JSON.stringify({ rowsGenerated: result.rows.length }, null, 2) + "\n");
    return;
  }

  if (args.phase === "judge") {
    const result = await runJudgePhase({
      runDir,
      rubricPath: DEFAULT_RUBRIC_PATH,
      judgeModel: args.judgeModel || args.model,
      limit: args.limit,
      overwrite: args.overwrite,
      apiKey,
      goldSetOnly: args.goldSetOnly,
    });
    const passCount = result.rows.filter(function(r) { return r.passFail === "pass"; }).length;
    process.stdout.write(JSON.stringify({
      rowsJudged: result.rows.length,
      passRate: result.rows.length > 0 ? Math.round((passCount / result.rows.length) * 100) + "%" : "n/a",
    }, null, 2) + "\n");
    return;
  }

  if (args.phase === "report") {
    const result = await runReportPhase({
      runDir,
      rubricPath: DEFAULT_RUBRIC_PATH,
      overwrite: args.overwrite,
    });
    process.stdout.write(JSON.stringify({
      reportCsv: result.reportCsvPath,
      summary: result.summaryPath,
      humanReview: result.humanReviewPath,
    }, null, 2) + "\n");
    return;
  }

  process.stderr.write(`[wim-eval] Unknown phase: ${args.phase}. Expected: dataset|generate|judge|report\n`);
  process.exit(1);
}

if (require.main === module) {
  main().catch(function(err) {
    process.stderr.write(`[wim-eval] fatal: ${err.message || String(err)}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
