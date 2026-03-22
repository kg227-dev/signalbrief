"use strict";

const path = require("path");

function parseListLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return "";
  const match = raw.match(/^[-*]\s+(.+)$/) || raw.match(/^\d+\.\s+(.+)$/);
  if (!match) return "";
  return String(match[1] || "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function defaultProgressPayload(worklogPath) {
  return {
    available: false,
    worklog_path: worklogPath ? String(worklogPath) : null,
    updated_at: null,
    pass_count: 0,
    latest_pass: null,
    recent_passes: [],
    remaining_problems: [],
    next_steps: [],
    important_runs: [],
  };
}

function loadRetrievalEvalProgress(options = {}) {
  const fs = options.fs || require("fs");
  const appRoot = options.appRoot ? path.resolve(String(options.appRoot)) : process.cwd();
  const worklogPath = options.worklogPath
    ? path.resolve(String(options.worklogPath))
    : path.join(appRoot, "docs", "retrieval-eval-worklog.md");
  let text = "";
  let stat = null;
  try {
    text = fs.readFileSync(worklogPath, "utf8");
    stat = fs.statSync(worklogPath);
  } catch {
    return defaultProgressPayload(path.relative(appRoot, worklogPath));
  }

  const progress = defaultProgressPayload(path.relative(appRoot, worklogPath));
  const lines = String(text || "").split(/\r?\n/);
  const passes = [];
  const remainingProblems = [];
  const nextSteps = [];
  const importantRuns = [];

  let currentPass = null;
  let section = "";
  let passMode = "";

  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;

    if (/^###\s+Pass\s+/i.test(trimmed)) {
      currentPass = {
        title: trimmed.replace(/^###\s+/, "").trim(),
        completed: [],
        findings: [],
      };
      passes.push(currentPass);
      section = "pass";
      passMode = "";
      continue;
    }
    if (/^##\s+Remaining Problems/i.test(trimmed)) {
      currentPass = null;
      section = "remaining";
      passMode = "";
      continue;
    }
    if (/^##\s+Next Planned Work/i.test(trimmed)) {
      currentPass = null;
      section = "next";
      passMode = "";
      continue;
    }
    if (/^##\s+Important Run IDs/i.test(trimmed)) {
      currentPass = null;
      section = "runs";
      passMode = "";
      continue;
    }
    if (/^##\s+/i.test(trimmed)) {
      currentPass = null;
      section = "";
      passMode = "";
      continue;
    }

    if (section === "pass" && currentPass) {
      if (/^Completed in this pass:/i.test(trimmed)) {
        passMode = "completed";
        continue;
      }
      if (/^Key findings:/i.test(trimmed)) {
        passMode = "findings";
        continue;
      }
      const item = parseListLine(trimmed);
      if (!item) continue;
      if (passMode === "completed") currentPass.completed.push(item);
      else if (passMode === "findings") currentPass.findings.push(item);
      continue;
    }

    if (section === "remaining") {
      const item = parseListLine(trimmed);
      if (item) remainingProblems.push(item);
      continue;
    }

    if (section === "next") {
      const item = parseListLine(trimmed);
      if (item) nextSteps.push(item);
      continue;
    }

    if (section === "runs") {
      const match = trimmed.match(/^-\s+`(retrieval-eval:[^`]+)`/);
      if (match && match[1]) importantRuns.push(match[1]);
    }
  }

  progress.available = true;
  progress.updated_at = stat?.mtime?.toISOString?.() || null;
  progress.pass_count = passes.length;
  progress.latest_pass = passes.length ? passes[passes.length - 1] : null;
  progress.recent_passes = passes.slice(-4).reverse().map((entry) => ({ title: entry.title }));
  progress.remaining_problems = remainingProblems.slice(0, 8);
  progress.next_steps = nextSteps.slice(0, 8);
  progress.important_runs = Array.from(new Set(importantRuns)).slice(-6).reverse();
  return progress;
}

function createAdminRetrievalEvalRuntime(deps = {}) {
  const { storage } = deps;
  const progressLoader = () => loadRetrievalEvalProgress({
    fs: deps.fs,
    appRoot: deps.appRoot,
    worklogPath: deps.worklogPath,
  });

  function listRuns(limit = 20) {
    return storage.listRuns(limit);
  }

  function loadRun(runId) {
    return storage.loadRun(runId);
  }

  function loadStatus() {
    return {
      active_run: storage.loadActiveRun(),
      budget: storage.loadBudget(),
      latest_runs: storage.listRuns(5),
      progress: progressLoader(),
    };
  }

  return {
    listRuns,
    loadRun,
    loadStatus,
    loadProgress: progressLoader,
  };
}

module.exports = {
  createAdminRetrievalEvalRuntime,
  loadRetrievalEvalProgress,
};
