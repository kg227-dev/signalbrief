const fs = require("fs");
const path = require("path");

const { RESULTS_DIR, RUNS_DIR, writeJson } = require("../config");
const { printConsoleReport } = require("../reporters/console");
const { writeRunReport, writeRollingSummary } = require("../reporters/json");

function ensureDatasetSnapshotsDir(resultsDir) {
  const snapshotsDir = path.join(resultsDir, "datasets");
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
  return snapshotsDir;
}

function writeDatasetSnapshots({ dataset, runId, runLabel, timestamp, resultsDir = RESULTS_DIR }) {
  const datasetSnapshotPath = path.join(resultsDir, "dataset-latest.json");
  writeJson(datasetSnapshotPath, dataset);

  const snapshotsDir = ensureDatasetSnapshotsDir(resultsDir);
  const datasetRunSnapshotPath = path.join(snapshotsDir, `dataset-${runId}.json`);
  writeJson(datasetRunSnapshotPath, {
    run_id: runId,
    run_label: runLabel || null,
    timestamp,
    ...dataset,
  });

  return {
    datasetSnapshotPath,
    datasetRunSnapshotPath,
  };
}

/**
 * Reporting stage interface.
 * @returns {{report: object, rolling: object, datasetSnapshotPath: string, datasetRunSnapshotPath: string}}
 */
function runReportingStage({
  timestamp,
  runId,
  runLabel,
  budget,
  suites,
  sampleSizes,
  confidence,
  regressionAgainstBaseline,
  compositeScoresByPersona,
  improvementPriorities,
  compositeSummary,
  dataset,
  runsDir = RUNS_DIR,
  resultsDir = RESULTS_DIR,
}) {
  const {
    datasetSnapshotPath,
    datasetRunSnapshotPath,
  } = writeDatasetSnapshots({
    dataset,
    runId,
    runLabel,
    timestamp,
    resultsDir,
  });

  const report = writeRunReport({
    timestamp,
    runId,
    runLabel,
    runsDir,
    budget,
    suites,
    sampleSizes,
    confidence,
    regressionAgainstBaseline,
    compositeScoresByPersona,
    improvementPriorities,
  });

  const rolling = writeRollingSummary({
    resultsDir,
    runPayload: report.payload,
  });

  printConsoleReport({
    timestamp,
    runLabel,
    suites,
    budget,
    compositeSummary,
    rollingSummary: rolling,
  });

  console.log(`Report written: ${report.file}`);
  console.log(`Dataset snapshot: ${datasetSnapshotPath}`);
  console.log(`Dataset run snapshot: ${datasetRunSnapshotPath}`);

  return {
    report,
    rolling,
    datasetSnapshotPath,
    datasetRunSnapshotPath,
  };
}

module.exports = {
  runReportingStage,
};
