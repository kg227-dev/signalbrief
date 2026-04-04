"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function makeRunId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}`;
}

function createRun(outputDir, opts) {
  opts = opts || {};
  const runId = makeRunId();
  const runDir = path.join(outputDir, runId);
  ensureDir(runDir);
  const manifest = {
    runId,
    archiveDates: opts.archiveDates || [],
    itemCount: 0,
    goldSetSize: 0,
    promptVersions: [],
    generationModel: opts.generationModel || null,
    judgeModel: opts.judgeModel || null,
    rubricVersion: null,
    inputModes: opts.inputModes || ["minimal", "enhanced"],
    compareAgainst: opts.compareAgainst || "baseline",
    promptDir: opts.promptDir || "evals/prompts",
    outputDir: opts.outputDir || "data/wim-evals",
    goldSetApproved: false,
    phases: {
      dataset:  { completedAt: null, done: false },
      generate: { completedAt: null, done: false },
      judge:    { completedAt: null, done: false },
      report:   { completedAt: null, done: false },
    },
  };
  writeJsonAtomic(path.join(runDir, "manifest.json"), manifest);
  return { runId, runDir, manifest };
}

function readManifest(runDir) {
  return readJson(path.join(runDir, "manifest.json"));
}

function updateManifest(runDir, updates) {
  const current = readManifest(runDir);
  const updated = Object.assign({}, current, updates);
  writeJsonAtomic(path.join(runDir, "manifest.json"), updated);
  return updated;
}

function markPhaseComplete(runDir, phase) {
  const current = readManifest(runDir);
  const updated = Object.assign({}, current, {
    phases: Object.assign({}, current.phases, {
      [phase]: { completedAt: new Date().toISOString(), done: true },
    }),
  });
  writeJsonAtomic(path.join(runDir, "manifest.json"), updated);
  return updated;
}

module.exports = {
  makeRunId,
  createRun,
  readManifest,
  updateManifest,
  markPhaseComplete,
  writeJsonAtomic,
  ensureDir,
  readJson,
};
