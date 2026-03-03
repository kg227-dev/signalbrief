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

module.exports = {
  id: "08-cross-day-freshness",
  name: "Cross-Day Freshness",

  async run(context) {
    const archives = Array.isArray(context.archives) ? context.archives.slice() : [];
    archives.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    if (archives.length < 2) {
      return {
        id: this.id,
        name: this.name,
        score: 0,
        score_label: "N/A",
        status: "skip",
        per_persona: {},
        failures: [],
        suggestions: ["Need at least 2 archived days for cross-day freshness checks."],
        details: {
          archive_days: archives.length,
        },
        confidence: 0.5,
      };
    }

    const pairMetrics = [];
    for (let i = 1; i < archives.length; i++) {
      const prev = archives[i - 1];
      const curr = archives[i];
      const prevUrls = [...new Set((prev.items || []).map(normalizeUrl).filter(Boolean))];
      const currUrls = [...new Set((curr.items || []).map(normalizeUrl).filter(Boolean))];
      const overlap = jaccardSimilarity(prevUrls, currUrls);
      pairMetrics.push({
        from: prev.date,
        to: curr.date,
        overlap,
        overlap_pct: Number((overlap * 100).toFixed(2)),
      });
    }

    const itemRuns = {};
    for (const digest of archives) {
      const date = String(digest.date || "");
      const urls = [...new Set((digest.items || []).map(normalizeUrl).filter(Boolean))];
      for (const url of urls) {
        if (!itemRuns[url]) itemRuns[url] = [];
        itemRuns[url].push(date);
      }
    }

    const repeatedThreePlus = Object.entries(itemRuns)
      .filter(([, dates]) => dates.length >= 3)
      .map(([url, dates]) => ({ url, dates }));

    const avgOverlap = pairMetrics.length
      ? pairMetrics.reduce((sum, row) => sum + row.overlap, 0) / pairMetrics.length
      : 0;

    const suiteScore = Number((100 - avgOverlap * 100).toFixed(2));

    let status = "pass";
    if (avgOverlap > 0.2 && avgOverlap <= 0.35) status = "warn";
    else if (avgOverlap > 0.35) status = "fail";

    const failures = [];
    if (status !== "pass") {
      failures.push({
        issue: `Average day-to-day overlap ${(avgOverlap * 100).toFixed(2)}% exceeds target <20%.`,
        evidence: pairMetrics,
      });
    }
    if (repeatedThreePlus.length > 0) {
      failures.push({
        issue: `${repeatedThreePlus.length} URL(s) appeared in 3+ digest days.`,
        evidence: repeatedThreePlus.slice(0, 20),
      });
      if (status === "pass") status = "warn";
    }

    const suggestions = [];
    if (status !== "pass") {
      suggestions.push("Add cross-day headline/url dedup check against the last 3 archive days before selection.");
      suggestions.push("Use freshness decay in ranking to suppress repeated URLs across consecutive runs.");
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
        target: "Day-to-day overlap <20%; no item repeated in 3+ consecutive digests.",
        pair_metrics: pairMetrics,
        repeated_three_plus: repeatedThreePlus,
      },
      confidence: 0.9,
    };
  },
};
