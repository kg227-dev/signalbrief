"use strict";

const STAGES = [
  { key: "fetch",            label: "Fetch",                type: "pass-through"  },
  { key: "editorial_filter", label: "Editorial Filter",     type: "drop-capable"  },
  { key: "archive_dedup",    label: "Archive Dedup",        type: "drop-capable"  },
  { key: "freshness_filter", label: "Freshness Filter",     type: "drop-capable"  },
  { key: "story_dedup",      label: "Story Dedup",          type: "drop-capable"  },
  { key: "classifier",       label: "Strategic Classifier", type: "drop-capable"  },
  { key: "scoring",          label: "Scoring / Ranking",    type: "pass-through"  },
  { key: "final_selection",  label: "Final Selection",      type: "drop-capable"  },
  { key: "enrichment",       label: "Enrichment",           type: "drop-capable"  },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

// Internal codebase strings → canonical spec reason enum
const REASON_ALIAS_MAP = {
  selection_duplicate_url:      "duplicate_url",
  selection_duplicate_headline: "duplicate_headline",
  stale_age_filter:             "too_old",
};

function normalizeLane(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "perplexity_discovery" || s === "broad") return "discovery";
  return "broker"; // default: any broker lane or unknown
}

function normalizeCanonicalUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    u.hostname = u.hostname.toLowerCase();
    const STRIP_PARAMS = new Set(["fbclid", "gclid", "ref", "source"]);
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || STRIP_PARAMS.has(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    // strip trailing slash from path (but not from root "/")
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(raw || "");
  }
}

function normalizeDomain(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return s.startsWith("www.") ? s.slice(4) : s;
}

function normalizeReason(raw) {
  const s = String(raw || "").trim();
  return REASON_ALIAS_MAP[s] || s;
}

function computeDropPct(dropped, inCount) {
  const d = Number(dropped || 0);
  const n = Number(inCount || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number(((d / n) * 100).toFixed(2));
}

function computeConversionRate(selected, fetched) {
  const s = Number(selected || 0);
  const f = Number(fetched || 0);
  if (!Number.isFinite(f) || f <= 0) return 0;
  return Number((s / f).toFixed(4));
}

function computeClassifierDropRatePct(classifierDropped, classifierIn) {
  return computeDropPct(classifierDropped, classifierIn);
}

module.exports = {
  STAGES,
  STAGE_INDEX,
  normalizeLane,
  normalizeCanonicalUrl,
  normalizeDomain,
  normalizeReason,
  computeDropPct,
  computeConversionRate,
  computeClassifierDropRatePct,
};
