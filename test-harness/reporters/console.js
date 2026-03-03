function pad(value, width, alignRight = false) {
  const raw = String(value == null ? "" : value);
  if (raw.length >= width) return raw.slice(0, width);
  const fill = " ".repeat(width - raw.length);
  return alignRight ? fill + raw : raw + fill;
}

function statusLabel(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PASS") return "PASS";
  if (s === "WARN") return "WARN";
  if (s === "SKIP") return "SKIP";
  return "FAIL";
}

function printConsoleReport({ timestamp, runLabel, suites, budget, compositeSummary, rollingSummary }) {
  const title = "SignalBrief QA Results";
  const width = 66;
  const divider = "=".repeat(width);

  console.log("\n" + divider);
  console.log(`${title} | Run: ${timestamp}`);
  if (runLabel) console.log(`Label: ${runLabel}`);
  console.log(divider);
  console.log(`${pad("Suite", 32)} | ${pad("Score", 10, true)} | ${pad("Status", 8)}`);
  console.log("-".repeat(width));

  for (const suite of suites) {
    const score = suite.score_label || `${Number(suite.score || 0).toFixed(1)}%`;
    console.log(`${pad(suite.name, 32)} | ${pad(score, 10, true)} | ${pad(statusLabel(suite.status), 8)}`);
  }

  console.log("-".repeat(width));
  console.log(`Budget spent: $${Number(budget.spent || 0).toFixed(4)} / $${Number(budget.cap || 0).toFixed(2)}  (remaining: $${Number(budget.remaining || 0).toFixed(4)})`);

  if (compositeSummary) {
    console.log(`Composite average: ${Number(compositeSummary.average_score || 0).toFixed(1)} / 100`);
    if (compositeSummary.best_persona) {
      const bestName = compositeSummary.best_persona.name || compositeSummary.best_persona.persona || "unknown";
      console.log(`Top persona: ${bestName} (${Number(compositeSummary.best_persona.score || 0).toFixed(1)})`);
    }
    if (compositeSummary.worst_persona) {
      const worstName = compositeSummary.worst_persona.name || compositeSummary.worst_persona.persona || "unknown";
      console.log(`Lowest persona: ${worstName} (${Number(compositeSummary.worst_persona.score || 0).toFixed(1)})`);
    }
  }

  if (rollingSummary && Number.isFinite(Number(rollingSummary.pass_streak))) {
    console.log(`Rolling pass streak: ${Number(rollingSummary.pass_streak)} run(s)`);
  }

  console.log(divider + "\n");
}

module.exports = {
  printConsoleReport,
};
