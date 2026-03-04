const fs = require("fs");
const path = require("path");
const { jaccardSimilarity } = require("../pipeline");

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
  } catch {
    return raw.toLowerCase();
  }
}

function uniqueUrls(items) {
  return [...new Set((items || []).map(normalizeUrl).filter(Boolean))];
}

function loadDatasetSnapshots(maxSnapshots = 120) {
  const dir = path.join(__dirname, "..", "..", "test-results", "datasets");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter((f) => /^dataset-.*\.json$/.test(f))
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
    } catch {
      // ignore parse failures
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
    const prevUrls = uniqueUrls(prev.items);
    const currUrls = uniqueUrls(curr.items);
    const overlap = jaccardSimilarity(prevUrls, currUrls);
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

module.exports = {
  id: "08-cross-day-freshness",
  name: "Cross-Day Freshness",

  async run(context) {
    const archives = Array.isArray(context.archives) ? context.archives.slice() : [];
    archives.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    const archiveEntries = archives.map((digest) => ({
      ref: `archive:${digest.date}`,
      date_key: String(digest.date || ""),
      items: Array.isArray(digest.items) ? digest.items : [],
    }));
    const archivePairs = toPairMetrics(archiveEntries, "archive");

    const maxSnapshots = Math.max(20, Number(context?.runtime?.freshness_max_snapshots || 120));
    const snapshotRows = loadDatasetSnapshots(maxSnapshots);

    const latestByDay = new Map();
    for (const row of snapshotRows) {
      if (!row.date_key) continue;
      latestByDay.set(row.date_key, {
        ref: `dataset:${row.run_id}`,
        date_key: row.date_key,
        items: row.items,
      });
    }
    const datasetDayEntries = [...latestByDay.values()].sort((a, b) => a.date_key.localeCompare(b.date_key));
    const datasetDayPairs = toPairMetrics(datasetDayEntries, "dataset_day");

    const intradayEntries = [];
    for (let i = 1; i < snapshotRows.length; i++) {
      const prev = snapshotRows[i - 1];
      const curr = snapshotRows[i];
      if (!prev.date_key || !curr.date_key || prev.date_key !== curr.date_key) continue;
      intradayEntries.push({
        prev,
        curr,
      });
    }
    const intradayPairs = intradayEntries.map((row) => {
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

    const primaryPairs = [...archivePairs, ...datasetDayPairs];
    if (!primaryPairs.length) {
      return {
        id: this.id,
        name: this.name,
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

    const avgOverlap = primaryPairs.reduce((sum, row) => sum + row.overlap, 0) / primaryPairs.length;
    const suiteScore = Number((100 - avgOverlap * 100).toFixed(2));

    const repeatRows = buildRepeatRows([...archiveEntries, ...datasetDayEntries]);
    const distinctDays = [...new Set([...archiveEntries, ...datasetDayEntries].map((row) => row.date_key).filter(Boolean))];

    let status = "pass";
    if (avgOverlap > 0.2 && avgOverlap <= 0.35) status = "warn";
    else if (avgOverlap > 0.35) status = "fail";
    if (repeatRows.length > 0 && status === "pass") status = "warn";
    if (primaryPairs.length < 3 && status === "pass") status = "warn";

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
    if (primaryPairs.length < 3) {
      failures.push({
        issue: `Freshness sample depth is thin (${primaryPairs.length} day-pair comparison(s)).`,
        evidence: {
          archive_pairs: archivePairs.length,
          dataset_day_pairs: datasetDayPairs.length,
          distinct_days: distinctDays,
        },
      });
    }

    const suggestions = [];
    if (avgOverlap > 0.2 || repeatRows.length > 0) {
      suggestions.push("Increase cross-day novelty penalty on repeated URLs/headline keys during final ranking.");
      suggestions.push("Expand archive lookback in production dedup to down-rank repeats that re-enter via alternate sources.");
    }
    if (primaryPairs.length < 3) {
      suggestions.push("Run at least 3-5 distinct digest days to certify freshness confidently (current day-pair depth is low).");
    }

    return {
      id: this.id,
      name: this.name,
      score: suiteScore,
      score_label: `${suiteScore.toFixed(1)}%`,
      status,
      per_persona: {},
      failures,
      suggestions,
      details: {
        target: "Day-to-day overlap <20%; no URL repeated in 3+ distinct digest days.",
        sample_count: primaryPairs.length,
        pair_metrics: primaryPairs,
        archive_pair_metrics: archivePairs,
        dataset_day_pair_metrics: datasetDayPairs,
        intraday_pair_metrics: intradayPairs.slice(-20),
        distinct_days: distinctDays,
        repeated_three_plus: repeatRows,
      },
      confidence: Math.max(0.55, Math.min(0.95, 0.55 + primaryPairs.length * 0.08)),
    };
  },
};
