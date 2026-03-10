const fs = require("fs");
const path = require("path");

const { ROOT_DIR, RUNS_DIR, readJson } = require("../config");

const EVIDENCE_FILE_PATTERN = /\b(?:test-harness\/[^\s:]+\.js|src\/[^\s:]+\.js|web\/[^\s:]+(?:\.js|\.html)|digest\.js|reply-handler\.js|personalization\.js|engagement-events\.js|mailer\.js|scheduler-worker\.js|bot-server\.js)\b/gi;

function normalizeEvidenceFile(raw) {
  const rel = String(raw || "").trim().replace(/^[./]+/, "");
  if (!rel) return null;
  if (path.isAbsolute(rel)) return rel;
  return path.join(ROOT_DIR, rel);
}

function extractEvidenceFilesFromText(text) {
  const found = [];
  const source = String(text || "");
  if (!source) return found;

  const matches = source.match(EVIDENCE_FILE_PATTERN) || [];
  for (const match of matches) {
    const full = normalizeEvidenceFile(match);
    if (full) found.push(full);
  }
  return found;
}

function collectEvidenceFiles(node, bag, depth = 0) {
  if (!node || depth > 4) return;

  if (typeof node === "string") {
    extractEvidenceFilesFromText(node).forEach((file) => bag.add(file));
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((entry) => collectEvidenceFiles(entry, bag, depth + 1));
    return;
  }

  if (typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = String(key || "").toLowerCase();

    if ((normalizedKey === "file" || normalizedKey === "path" || normalizedKey === "module") && typeof value === "string") {
      const full = normalizeEvidenceFile(value);
      if (full) bag.add(full);
      continue;
    }

    if (
      (normalizedKey === "evidence"
      || normalizedKey === "detail"
      || normalizedKey === "message"
      || normalizedKey === "issue")
      && typeof value === "string"
    ) {
      extractEvidenceFilesFromText(value).forEach((file) => bag.add(file));
    }

    collectEvidenceFiles(value, bag, depth + 1);
  }
}

function detectOwner(files = []) {
  const list = Array.isArray(files) ? files : [];
  if (list.some((file) => file.includes("/test-harness/cache/index.js"))) return "cache";
  if (list.some((file) => file.includes("/test-harness/run-matrix.js") || file.includes("/test-harness/run-tests.js"))) {
    return "harness-orchestration";
  }
  if (list.some((file) => file.includes("/test-harness/"))) return "harness";
  if (list.some((file) => file.includes("/web/"))) return "web";
  if (list.some((file) => file.includes("/src/entrypoints/digest.js") || file.endsWith("/digest.js"))) return "digest";
  if (list.some((file) => file.includes("/src/runtime/reply/reply-handler-runtime.js") || file.endsWith("/reply-handler-runtime.js"))) {
    return "reply-handler";
  }
  return "runtime";
}

function ownerFixHint(owner) {
  const hints = {
    cache: "Prioritize cache fallback and freshness logic first; avoid tuning digest ranking until cache behavior is stable.",
    "harness-orchestration": "Fix harness and matrix control flow first, then rerun suites to re-rank downstream priorities.",
    harness: "Start with failing harness seam logic and evaluator contracts before changing production ranking heuristics.",
    web: "Address web API and UI contract seams first, then retest dependent digest workflows.",
    digest: "Apply targeted digest pipeline fixes validated by failing suite evidence.",
    "reply-handler": "Fix Telegram command lifecycle and state transitions before downstream scoring tweaks.",
    runtime: "Use suite failure evidence to identify the failing seam owner, then implement the smallest cross-module contract fix.",
  };
  return hints[owner] || hints.runtime;
}

function summarizeIssue(suite, failures = []) {
  const firstFailure = failures.find((failure) => failure && typeof failure === "object") || null;
  const direct = firstFailure && (
    firstFailure.issue
    || firstFailure.title
    || firstFailure.message
    || firstFailure.evidence
    || firstFailure.metric
  );
  const issue = String(direct || "").trim();
  return issue || `${suite.name} under target`;
}

function buildImprovementPriorities(suites) {
  const severity = { fail: 2, warn: 1, pass: 0, skip: 0 };
  return suites
    .filter((suite) => ["fail", "warn"].includes(String(suite.status || "").toLowerCase()))
    .sort((a, b) => {
      const severityDelta = severity[String(b.status || "").toLowerCase()] - severity[String(a.status || "").toLowerCase()];
      if (severityDelta !== 0) return severityDelta;
      return Number(a.score || 0) - Number(b.score || 0);
    })
    .map((suite, index) => {
      const evidenceFiles = new Set();
      collectEvidenceFiles(suite?.failures || [], evidenceFiles);
      collectEvidenceFiles(suite?.details || {}, evidenceFiles);
      collectEvidenceFiles(suite?.suggestions || [], evidenceFiles);

      const fileList = [...evidenceFiles];
      const owner = detectOwner(fileList);
      const primaryFile = fileList[0] || null;
      const issue = summarizeIssue(suite, Array.isArray(suite?.failures) ? suite.failures : []);
      const suggestedFix = Array.isArray(suite?.suggestions) && suite.suggestions.length
        ? String(suite.suggestions[0] || "").trim()
        : "";

      return {
        rank: index + 1,
        issue,
        suite: suite.id,
        fix: suggestedFix || ownerFixHint(owner),
        file: primaryFile,
        owner,
      };
    });
}

function inferSuiteSampleSize(suite) {
  const details = suite?.details || {};
  if (Number.isFinite(Number(details.sample_count))) return Number(details.sample_count);
  if (Array.isArray(details.judged_items)) return details.judged_items.length;
  if (Array.isArray(details.judged_pairs)) return details.judged_pairs.length;
  if (Array.isArray(details.pair_metrics)) return details.pair_metrics.length;
  if (suite?.per_persona && typeof suite.per_persona === "object") {
    return Object.keys(suite.per_persona).length;
  }
  return 0;
}

function buildSampleSizes(suites) {
  const out = {};
  for (const suite of suites || []) {
    const key = String(suite.id || suite.name || "suite")
      .replace(/^\d+-/, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase();
    out[key] = inferSuiteSampleSize(suite);
  }
  return out;
}

function ciTuple(ci) {
  if (!ci) return null;
  return [Number(ci.low.toFixed(3)), Number(ci.high.toFixed(3))];
}

function buildConfidenceSection(suites, evaluator, bootstrapIterations) {
  const out = {};

  for (const suite of suites || []) {
    const key = String(suite.id || suite.name || "suite")
      .replace(/^\d+-/, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase();

    const details = suite.details || {};

    if (Array.isArray(details.judged_items) && details.judged_items.length) {
      const values = details.judged_items.map((row) => Number(row.overall)).filter(Number.isFinite);
      if (values.length) {
        const ci = evaluator.bootstrapMeanCI(values, bootstrapIterations);
        out[key] = {
          n: values.length,
          ci95: ciTuple(ci),
          p25: Number(evaluator.percentile(values, 0.25).toFixed(3)),
          p10: Number(evaluator.percentile(values, 0.1).toFixed(3)),
          mean: Number(ci.mean.toFixed(3)),
        };
      }
      continue;
    }

    if (Array.isArray(details.judged_pairs) && details.judged_pairs.length) {
      const values = details.judged_pairs
        .map((row) => Number(row.insight_gain || row?.judge?.insight_gain || 0))
        .filter(Number.isFinite);

      if (values.length) {
        const ci = evaluator.bootstrapMeanCI(values, bootstrapIterations);
        const paddingValues = details.judged_pairs.map((row) => (row.likely_padding || row?.judge?.likely_padding ? 1 : 0));
        out[key] = {
          n: values.length,
          ci95: ciTuple(ci),
          p25: Number(evaluator.percentile(values, 0.25).toFixed(3)),
          p10: Number(evaluator.percentile(values, 0.1).toFixed(3)),
          mean: Number(ci.mean.toFixed(3)),
          likely_padding: Number(evaluator.mean(paddingValues).toFixed(3)),
        };
      }
      continue;
    }

    const personaValues = Object.values(suite.per_persona || {})
      .map((row) => Number(row?.score))
      .filter(Number.isFinite);

    if (personaValues.length >= 2) {
      const ci = evaluator.bootstrapMeanCI(personaValues, bootstrapIterations);
      out[key] = {
        n: personaValues.length,
        ci95: ciTuple(ci),
        p25: Number(evaluator.percentile(personaValues, 0.25).toFixed(3)),
        p10: Number(evaluator.percentile(personaValues, 0.1).toFixed(3)),
        mean: Number(ci.mean.toFixed(3)),
      };
    }
  }

  return out;
}

function getLatestRunPayload(runsDir) {
  if (!fs.existsSync(runsDir)) return null;
  const files = fs.readdirSync(runsDir).filter((file) => /^run-.*\.json$/.test(file)).sort();
  if (!files.length) return null;

  const latest = files[files.length - 1];
  try {
    return readJson(path.join(runsDir, latest), null);
  } catch {
    return null;
  }
}

function buildRegressionAgainstBaseline(baselinePayload, suites, compositeAverage) {
  if (!baselinePayload || !baselinePayload.suites) return null;

  const bySuite = {};
  for (const suite of suites) {
    const key = String(suite.id || "")
      .replace(/^\d+-/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    const previous = baselinePayload.suites[key];
    const previousScore = Number(previous?.score);
    if (!Number.isFinite(previousScore)) continue;

    const currentScore = Number(suite.score || 0);
    bySuite[key] = {
      baseline: Number(previousScore.toFixed(2)),
      current: Number(currentScore.toFixed(2)),
      delta: Number((currentScore - previousScore).toFixed(2)),
      baseline_status: previous?.status || null,
      current_status: suite.status || null,
    };
  }

  const baselineComposite = Number(
    baselinePayload?.suites?.["end-to-end"]?.score
      || baselinePayload?.suites?.["end_to_end"]?.score
      || baselinePayload?.suites?.["end-to-end-composite"]?.score
  );

  return {
    baseline_timestamp: baselinePayload.timestamp || null,
    composite: Number.isFinite(baselineComposite)
      ? {
          baseline: Number(baselineComposite.toFixed(2)),
          current: Number(Number(compositeAverage || 0).toFixed(2)),
          delta: Number((Number(compositeAverage || 0) - baselineComposite).toFixed(2)),
        }
      : null,
    suites: bySuite,
  };
}

/**
 * Analytics stage interface.
 * @returns {{sampleSizes: object, confidence: object, improvementPriorities: Array, regressionAgainstBaseline: object|null}}
 */
function runAnalyticsStage({
  suiteResults,
  evaluator,
  confidenceBootstrap,
  compositeAverage,
  runsDir = RUNS_DIR,
}) {
  const sampleSizes = buildSampleSizes(suiteResults);
  const confidence = buildConfidenceSection(
    suiteResults,
    evaluator,
    Number(confidenceBootstrap || 1000)
  );
  const improvementPriorities = buildImprovementPriorities(suiteResults);
  const baselineReport = getLatestRunPayload(runsDir);
  const regressionAgainstBaseline = buildRegressionAgainstBaseline(
    baselineReport,
    suiteResults,
    compositeAverage
  );

  return {
    sampleSizes,
    confidence,
    improvementPriorities,
    regressionAgainstBaseline,
  };
}

module.exports = {
  runAnalyticsStage,
};
