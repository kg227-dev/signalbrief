const fs = require("fs");
const path = require("path");
const { jaccardSimilarity } = require("../runtime/pipeline");

function normalizeUrl(item) {
  const raw = String(item?.url || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch (err) {
    if (process.env.QA_DEBUG === "1") {
      console.warn(`[qa-cross-day-freshness] URL parse fallback: ${err.message}`);
    }
    return raw.toLowerCase();
  }
}

function uniqueUrls(items) {
  return [...new Set((items || []).map(normalizeUrl).filter(Boolean))];
}

function loadDatasetSnapshots(maxSnapshots = 120) {
  const dir = path.join(__dirname, "..", "..", "test-results", "datasets");
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((fileName) => /^dataset-.*\.json$/.test(fileName))
    .sort();

  const rows = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (!parsed || typeof parsed !== "object") continue;
      rows.push({
        file,
        run_id: parsed.run_id || file.replace(/^dataset-/, "").replace(/\.json$/, ""),
        timestamp: parsed.timestamp || parsed.generated_at || null,
        date_key: String(parsed.date_key || "").trim(),
        items: Array.isArray(parsed.enriched_items) && parsed.enriched_items.length
          ? parsed.enriched_items
          : (Array.isArray(parsed.selected_items) ? parsed.selected_items : []),
      });
    } catch (err) {
      if (process.env.QA_DEBUG === "1") {
        console.warn(`[qa-cross-day-freshness] skipping snapshot ${file}: ${err.message}`);
      }
    }
  }

  rows.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  if (!Number.isFinite(Number(maxSnapshots)) || maxSnapshots <= 0) return rows;
  return rows.slice(-Math.floor(maxSnapshots));
}

function toPairMetrics(entries, labelPrefix) {
  const out = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const overlap = jaccardSimilarity(uniqueUrls(prev.items), uniqueUrls(curr.items));
    out.push({
      type: labelPrefix,
      from: prev.date_key,
      to: curr.date_key,
      from_ref: prev.ref || null,
      to_ref: curr.ref || null,
      overlap,
      overlap_pct: Number((overlap * 100).toFixed(2)),
    });
  }
  return out;
}

function buildRepeatRows(entries) {
  const urlDays = {};
  for (const row of entries) {
    const day = String(row.date_key || "");
    if (!day) continue;
    for (const url of uniqueUrls(row.items)) {
      if (!urlDays[url]) urlDays[url] = new Set();
      urlDays[url].add(day);
    }
  }
  return Object.entries(urlDays)
    .map(([url, daySet]) => ({ url, days: [...daySet].sort() }))
    .filter((row) => row.days.length >= 3);
}

function buildArchiveEntries(archives) {
  const sorted = Array.isArray(archives) ? archives.slice() : [];
  sorted.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  return sorted.map((digest) => ({
    ref: `archive:${digest.date}`,
    date_key: String(digest.date || ""),
    items: Array.isArray(digest.items) ? digest.items : [],
  }));
}

function buildDatasetDayEntries(snapshotRows) {
  const latestByDay = new Map();
  for (const row of snapshotRows) {
    if (!row.date_key) continue;
    latestByDay.set(row.date_key, {
      ref: `dataset:${row.run_id}`,
      date_key: row.date_key,
      items: row.items,
    });
  }
  return [...latestByDay.values()].sort((a, b) => a.date_key.localeCompare(b.date_key));
}

function buildIntradayPairs(snapshotRows) {
  const intradayEntries = [];
  for (let i = 1; i < snapshotRows.length; i++) {
    const prev = snapshotRows[i - 1];
    const curr = snapshotRows[i];
    if (!prev.date_key || !curr.date_key || prev.date_key !== curr.date_key) continue;
    intradayEntries.push({ prev, curr });
  }

  return intradayEntries.map((row) => {
    const overlap = jaccardSimilarity(uniqueUrls(row.prev.items), uniqueUrls(row.curr.items));
    return {
      type: "intraday",
      date: row.curr.date_key,
      from_ref: `dataset:${row.prev.run_id}`,
      to_ref: `dataset:${row.curr.run_id}`,
      overlap,
      overlap_pct: Number((overlap * 100).toFixed(2)),
    };
  });
}

function makeCrossDaySkipPayload(suiteMeta, archives, snapshotRows) {
  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
    score: 0,
    score_label: "N/A",
    status: "skip",
    per_persona: {},
    failures: [],
    suggestions: ["Need at least 2 distinct digest days (archive or dataset snapshots) for freshness checks."],
    details: {
      sample_count: 0,
      archive_days: archives.length,
      dataset_snapshots: snapshotRows.length,
    },
    confidence: 0.45,
  };
}

function selectEvaluationPairs(primaryPairs, distinctDaysAll, windowDays) {
  const recentDaySet = new Set(distinctDaysAll.slice(-windowDays));
  const recentPairs = primaryPairs.filter(
    (row) => recentDaySet.has(String(row.from || "")) && recentDaySet.has(String(row.to || ""))
  );
  return {
    recentDaySet,
    evalPairs: recentPairs.length > 0 ? recentPairs : primaryPairs,
  };
}

function computeCrossDayStatusBand(avgOverlap, repeatRows, evalPairs) {
  let status = "pass";
  if (avgOverlap > 0.2 && avgOverlap <= 0.35) status = "warn";
  else if (avgOverlap > 0.35) status = "fail";
  if (repeatRows.length > 0 && status === "pass") status = "warn";
  if (evalPairs.length < 3 && status === "pass") status = "warn";
  return status;
}

function collectCrossDayFailures(avgOverlap, primaryPairs, repeatRows, evalPairs, archivePairs, datasetDayPairs, distinctDays) {
  const failures = [];
  if (avgOverlap > 0.2) {
    failures.push({
      issue: `Average day-to-day overlap ${(avgOverlap * 100).toFixed(2)}% exceeds target <20%.`,
      evidence: primaryPairs,
    });
  }
  if (repeatRows.length > 0) {
    failures.push({
      issue: `${repeatRows.length} URL(s) appeared in 3+ distinct digest days.`,
      evidence: repeatRows.slice(0, 20),
    });
  }
  if (evalPairs.length < 3) {
    failures.push({
      issue: `Freshness sample depth is thin (${evalPairs.length} day-pair comparison(s)).`,
      evidence: {
        archive_pairs: archivePairs.length,
        dataset_day_pairs: datasetDayPairs.length,
        distinct_days: distinctDays,
      },
    });
  }
  return failures;
}

function collectCrossDaySuggestions(avgOverlap, repeatRows, evalPairs) {
  const suggestions = [];
  if (avgOverlap > 0.2 || repeatRows.length > 0) {
    suggestions.push("Increase cross-day novelty penalty on repeated URLs/headline keys during final ranking.");
    suggestions.push("Expand archive lookback in production dedup to down-rank repeats that re-enter via alternate sources.");
  }
  if (evalPairs.length < 3) {
    suggestions.push("Run at least 3-5 distinct digest days to certify freshness confidently (current day-pair depth is low).");
  }
  return suggestions;
}

async function runCrossDayFreshnessSuite(context, suiteMeta) {
  const archives = Array.isArray(context.archives) ? context.archives.slice() : [];
  const archiveEntries = buildArchiveEntries(archives);
  const archivePairs = toPairMetrics(archiveEntries, "archive");

  const maxSnapshots = Math.max(20, Number(context?.runtime?.freshness_max_snapshots || 120));
  const snapshotRows = loadDatasetSnapshots(maxSnapshots);
  const datasetDayEntries = buildDatasetDayEntries(snapshotRows);
  const datasetDayPairs = toPairMetrics(datasetDayEntries, "dataset_day");
  const intradayPairs = buildIntradayPairs(snapshotRows);

  const primaryPairs = [...archivePairs, ...datasetDayPairs];
  if (!primaryPairs.length) return makeCrossDaySkipPayload(suiteMeta, archives, snapshotRows);

  const distinctDaysAll = [...new Set([...archiveEntries, ...datasetDayEntries].map((row) => row.date_key).filter(Boolean))].sort();
  const windowDays = Math.max(
    3,
    Number(context?.runtime?.freshness_window_days || context?.appConfig?.digest?.crossDayDedupDays || 3)
  );
  const { recentDaySet, evalPairs } = selectEvaluationPairs(primaryPairs, distinctDaysAll, windowDays);

  const avgOverlap = evalPairs.reduce((sum, row) => sum + row.overlap, 0) / evalPairs.length;
  const suiteScore = Number((100 - avgOverlap * 100).toFixed(2));
  const repeatSourceIsArchive = archiveEntries.length >= 3;
  const repeatEntryPool = (repeatSourceIsArchive ? archiveEntries : datasetDayEntries).filter((row) =>
    recentDaySet.has(row.date_key)
  );
  const repeatRows = buildRepeatRows(repeatEntryPool);
  const status = computeCrossDayStatusBand(avgOverlap, repeatRows, evalPairs);
  const failures = collectCrossDayFailures(avgOverlap, primaryPairs, repeatRows, evalPairs, archivePairs, datasetDayPairs, distinctDaysAll);
  const suggestions = collectCrossDaySuggestions(avgOverlap, repeatRows, evalPairs);

  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
    score: suiteScore,
    score_label: `${suiteScore.toFixed(1)}%`,
    status,
    per_persona: {},
    failures,
    suggestions,
    details: {
      target: "Day-to-day overlap <20%; no URL repeated in 3+ distinct digest days.",
      sample_count: evalPairs.length,
      pair_metrics: evalPairs,
      evaluation_window_days: windowDays,
      repeat_source: repeatSourceIsArchive ? "archive" : "dataset_day",
      archive_pair_metrics: archivePairs,
      dataset_day_pair_metrics: datasetDayPairs,
      intraday_pair_metrics: intradayPairs.slice(-20),
      distinct_days: distinctDaysAll,
      repeated_three_plus: repeatRows,
    },
    confidence: Math.max(0.55, Math.min(0.95, 0.55 + primaryPairs.length * 0.08)),
  };
}

module.exports = {
  runCrossDayFreshnessSuite,
};
