"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  loadDigestTuning,
  mergeDigestTuning,
  validateDigestTuning,
  ALLOWED_TUNING_KEYS,
} = require("./digest-tuning-runtime");

// --- loadDigestTuning ---
{
  // Returns {} when file is missing
  const missing = loadDigestTuning("/nonexistent/path/digest-tuning.json", fs);
  assert.deepStrictEqual(missing, {}, "missing file → empty object");

  // Returns {} when file contains invalid JSON
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tune-test-"));
  const badPath = path.join(tmpDir, "bad.json");
  fs.writeFileSync(badPath, "not-json");
  const bad = loadDigestTuning(badPath, fs);
  assert.deepStrictEqual(bad, {}, "invalid JSON → empty object");

  // Returns parsed object for valid JSON
  const goodPath = path.join(tmpDir, "good.json");
  const tuning = { maxAgeHours: 36, weights: { freshness: 0.4, source_tier: 0.3, lane_bonus: 0.15, novelty: 0.15 } };
  fs.writeFileSync(goodPath, JSON.stringify(tuning));
  const result = loadDigestTuning(goodPath, fs);
  assert.strictEqual(result.maxAgeHours, 36, "maxAgeHours parsed correctly");
  assert.strictEqual(result.weights.freshness, 0.4, "weights.freshness parsed correctly");

  // Returns {} when file contains a non-object root
  const arrPath = path.join(tmpDir, "arr.json");
  fs.writeFileSync(arrPath, JSON.stringify([1, 2, 3]));
  const arr = loadDigestTuning(arrPath, fs);
  assert.deepStrictEqual(arr, {}, "array root → empty object");

  console.log("loadDigestTuning ✓");
}

// --- validateDigestTuning ---
{
  const { ok, errors } = validateDigestTuning({
    maxAgeHours: 36,
    maxItemsPerSourceDomain: 2,
    crossDayDedupDays: 3,
    historyLookbackDays: 7,
    weights: { freshness: 0.4, source_tier: 0.3, lane_bonus: 0.15, novelty: 0.15 },
    laneBonuses: { rss: 0.8 },
    tierScores: { "1": 1.0 },
  });
  assert.strictEqual(ok, true, "valid tuning passes validation");
  assert.strictEqual(errors.length, 0, "no errors for valid input");

  // Unknown key is rejected
  const { ok: badOk, errors: badErrors } = validateDigestTuning({ unknownKey: 123 });
  assert.strictEqual(badOk, false, "unknown key fails validation");
  assert.ok(badErrors.some((e) => e.includes("unknownKey")), "error mentions unknown key");

  // Non-numeric maxAgeHours is rejected
  const { ok: numOk, errors: numErrors } = validateDigestTuning({ maxAgeHours: "48h" });
  assert.strictEqual(numOk, false, "string maxAgeHours fails");
  assert.ok(numErrors.some((e) => e.includes("maxAgeHours")), "error mentions maxAgeHours");

  // Weights with out-of-range value is rejected
  const { ok: wOk, errors: wErrors } = validateDigestTuning({ weights: { freshness: 2.0, source_tier: 0.35, lane_bonus: 0.15, novelty: 0.15 } });
  assert.strictEqual(wOk, false, "out-of-range weight fails");
  assert.ok(wErrors.some((e) => e.includes("freshness")), "error mentions freshness");

  // Empty object is valid (no overrides)
  const { ok: emptyOk } = validateDigestTuning({});
  assert.strictEqual(emptyOk, true, "empty object is valid");

  // String where number expected is rejected
  const { ok: strOk, errors: strErrors } = validateDigestTuning({ maxAgeHours: "36" });
  assert.strictEqual(strOk, false, "string maxAgeHours fails strict validation");
  assert.ok(strErrors.some((e) => e.includes("maxAgeHours")), "error mentions field name");

  console.log("validateDigestTuning ✓");
}

// --- mergeDigestTuning ---
{
  const base = {
    weights: { freshness: 0.35, source_tier: 0.35, lane_bonus: 0.15, novelty: 0.15 },
    maxAgeHours: 48,
    maxItemsPerSourceDomain: 2,
    crossDayDedupDays: 3,
    historyLookbackDays: 7,
  };

  // Tuning overrides only the specified keys
  const merged = mergeDigestTuning(base, { maxAgeHours: 36, weights: { freshness: 0.5, source_tier: 0.3, lane_bonus: 0.1, novelty: 0.1 } });
  assert.strictEqual(merged.maxAgeHours, 36, "maxAgeHours overridden");
  assert.strictEqual(merged.weights.freshness, 0.5, "weights overridden");
  assert.strictEqual(merged.maxItemsPerSourceDomain, 2, "unset key preserved from base");

  // Empty tuning returns base unchanged (deep equal)
  const unmodified = mergeDigestTuning(base, {});
  assert.deepStrictEqual(unmodified, base, "empty tuning → base unchanged");

  // Empty tuning returns a copy, not the same reference
  assert.notStrictEqual(mergeDigestTuning(base, {}), base, "empty tuning → new object (not same ref)");

  // Null/undefined tuning returns base
  const fromNull = mergeDigestTuning(base, null);
  assert.deepStrictEqual(fromNull, base, "null tuning → base unchanged");

  console.log("mergeDigestTuning ✓");
}

// --- ALLOWED_TUNING_KEYS ---
{
  assert.ok(Array.isArray(ALLOWED_TUNING_KEYS), "ALLOWED_TUNING_KEYS is an array");
  assert.ok(ALLOWED_TUNING_KEYS.includes("maxAgeHours"), "maxAgeHours is allowed");
  assert.ok(ALLOWED_TUNING_KEYS.includes("weights"), "weights is allowed");
  assert.ok(!ALLOWED_TUNING_KEYS.includes("keys"), "keys is not allowed (security)");
  console.log("ALLOWED_TUNING_KEYS ✓");
}

console.log("All digest-tuning-runtime tests passed ✓");
