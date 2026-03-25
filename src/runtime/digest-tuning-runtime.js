"use strict";

/**
 * Digest tuning runtime — loads per-run scoring overrides from
 * data/digest-tuning.json without touching config.json.
 *
 * Design: read fresh from disk on every digest run so operator changes
 * take effect on the next run automatically without restarting anything.
 */

const ALLOWED_TUNING_KEYS = [
  "weights",
  "maxAgeHours",
  "maxItemsPerSourceDomain",
  "crossDayDedupDays",
  "historyLookbackDays",
  "laneBonuses",
  "tierScores",
];

const NUMERIC_KEYS = new Set([
  "maxAgeHours",
  "maxItemsPerSourceDomain",
  "crossDayDedupDays",
  "historyLookbackDays",
]);

const OBJECT_KEYS = new Set(["weights", "laneBonuses", "tierScores"]);

const WEIGHT_COMPONENT_KEYS = ["freshness", "source_tier", "lane_bonus", "novelty"];

/**
 * Load digest-tuning.json from disk.
 * Returns {} if the file is missing, unreadable, or has invalid JSON.
 * Returns {} if the parsed value is not a plain object.
 */
function loadDigestTuning(tuningPath, fs) {
  let raw;
  try {
    raw = fs.readFileSync(String(tuningPath || ""), "utf8");
  } catch (_) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

/**
 * Validate a tuning object against the allowed key set and type constraints.
 * Returns { ok: boolean, errors: string[] }
 */
function validateDigestTuning(tuning) {
  if (!tuning || typeof tuning !== "object" || Array.isArray(tuning)) {
    return { ok: false, errors: ["tuning must be a plain object"] };
  }

  const errors = [];
  const allowedSet = new Set(ALLOWED_TUNING_KEYS);

  for (const key of Object.keys(tuning)) {
    if (!allowedSet.has(key)) {
      errors.push(`unknown tuning key: "${key}" — allowed keys: ${ALLOWED_TUNING_KEYS.join(", ")}`);
      continue;
    }
    const value = tuning[key];

    if (NUMERIC_KEYS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`"${key}" must be a non-negative finite number, got: ${JSON.stringify(value)}`);
      }
      continue;
    }

    if (OBJECT_KEYS.has(key)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`"${key}" must be a plain object, got: ${JSON.stringify(value)}`);
        continue;
      }
      if (key === "weights") {
        for (const wKey of WEIGHT_COMPONENT_KEYS) {
          if (!(wKey in value)) continue;
          const w = Number(value[wKey]);
          if (!Number.isFinite(w) || w < 0 || w > 1) {
            errors.push(`"weights.${wKey}" must be a number in [0,1], got: ${JSON.stringify(value[wKey])}`);
          }
        }
        for (const wKey of Object.keys(value)) {
          if (!WEIGHT_COMPONENT_KEYS.includes(wKey)) {
            errors.push(`"weights.${wKey}" is not a recognized weight component`);
          }
        }
      }
      continue;
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Merge tuning overrides on top of a base scoring config object.
 * Only ALLOWED_TUNING_KEYS are merged; all other base keys are preserved.
 * Object values (weights, laneBonuses, tierScores) are shallow-merged.
 */
function mergeDigestTuning(base, tuning) {
  const safeBase = (base && typeof base === "object" && !Array.isArray(base)) ? base : {};
  const safeTuning = (tuning && typeof tuning === "object" && !Array.isArray(tuning)) ? tuning : {};
  if (Object.keys(safeTuning).length === 0) return safeBase;

  const merged = { ...safeBase };
  for (const key of ALLOWED_TUNING_KEYS) {
    if (!(key in safeTuning)) continue;
    const val = safeTuning[key];
    if (OBJECT_KEYS.has(key)) {
      merged[key] = { ...(safeBase[key] || {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

module.exports = {
  loadDigestTuning,
  validateDigestTuning,
  mergeDigestTuning,
  ALLOWED_TUNING_KEYS,
};
