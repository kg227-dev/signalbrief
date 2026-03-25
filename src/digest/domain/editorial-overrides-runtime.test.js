"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  loadEditorialOverrides,
  saveEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
  pruneStaleEntries,
} = require("./editorial-overrides-runtime");

const TODAY = "2026-03-24";
const YESTERDAY = "2026-03-23";
const EIGHT_DAYS_AGO = "2026-03-16";
const TOMORROW = "2026-03-25";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-editorial-test-"));
const overridesPath = path.join(tmpDir, "editorial-overrides.json");

// --- loadEditorialOverrides ---
{
  // Missing file → empty structure
  const result = loadEditorialOverrides("/nonexistent/path.json", fs);
  assert.deepStrictEqual(result.pins, [], "missing file → empty pins");
  assert.deepStrictEqual(result.excludes, [], "missing file → empty excludes");
  assert.deepStrictEqual(result.source_suppressions, [], "missing file → empty suppressions");
  console.log("loadEditorialOverrides missing ✓");
}

{
  // Valid file → correct shape
  const overrides = {
    pins: [{ url: "https://example.com/article", topic: "TECHNOLOGY", date: TODAY, note: "" }],
    excludes: [{ url: "https://bad.com/article", date: TODAY, note: "" }],
    source_suppressions: [{ domain: "spam.com", date: TODAY, note: "" }],
  };
  fs.writeFileSync(overridesPath, JSON.stringify(overrides));
  const loaded = loadEditorialOverrides(overridesPath, fs);
  assert.strictEqual(loaded.pins.length, 1, "pins loaded");
  assert.strictEqual(loaded.excludes.length, 1, "excludes loaded");
  assert.strictEqual(loaded.source_suppressions.length, 1, "suppressions loaded");
  console.log("loadEditorialOverrides valid ✓");
}

// --- pruneStaleEntries ---
{
  const entries = [
    { url: "a", date: TODAY },          // active: today
    { url: "b", date: YESTERDAY },      // active: yesterday (within 7 days)
    { url: "c", date: EIGHT_DAYS_AGO }, // stale: 8 days ago
    { url: "d", date: TOMORROW },       // active: tomorrow (future pin)
  ];
  const pruned = pruneStaleEntries(entries, TODAY);
  assert.strictEqual(pruned.length, 3, "stale entry pruned");
  assert.ok(!pruned.some((e) => e.url === "c"), "8-day-old entry removed");
  assert.ok(pruned.some((e) => e.url === "d"), "future entry kept");
  console.log("pruneStaleEntries ✓");
}

// --- isUrlExcluded ---
{
  const excludes = [
    { url: "https://bad.com/article", date: TODAY },
    { url: "https://old.com/article", date: EIGHT_DAYS_AGO }, // stale, should not match
  ];
  assert.strictEqual(isUrlExcluded("https://bad.com/article", excludes, TODAY), true, "active exclude matches");
  assert.strictEqual(isUrlExcluded("https://good.com/article", excludes, TODAY), false, "non-excluded URL");
  assert.strictEqual(isUrlExcluded("https://old.com/article", excludes, TODAY), false, "stale exclude does not apply");
  assert.strictEqual(isUrlExcluded("", excludes, TODAY), false, "empty URL → false");
  console.log("isUrlExcluded ✓");
}

// --- isDomainSuppressed ---
{
  const suppressions = [
    { domain: "spam.com", date: TODAY },
    { domain: "expired.com", date: EIGHT_DAYS_AGO },
  ];
  assert.strictEqual(isDomainSuppressed("spam.com", suppressions, TODAY), true, "active suppression");
  assert.strictEqual(isDomainSuppressed("ok.com", suppressions, TODAY), false, "not suppressed");
  assert.strictEqual(isDomainSuppressed("expired.com", suppressions, TODAY), false, "expired suppression inactive");
  assert.strictEqual(isDomainSuppressed("", suppressions, TODAY), false, "empty domain → false");
  console.log("isDomainSuppressed ✓");
}

// --- getPinsForDate ---
{
  const pins = [
    { url: "https://pinned.com/a", topic: "TECHNOLOGY", date: TODAY, note: "" },
    { url: "https://pinned.com/b", topic: "HEALTHCARE", date: YESTERDAY, note: "" },
    { url: "https://future.com/c", topic: "ENERGY", date: TOMORROW, note: "" },
    { url: "https://stale.com/d", topic: "INDUSTRIALS", date: EIGHT_DAYS_AGO, note: "" },
  ];
  const active = getPinsForDate(pins, TODAY);
  assert.strictEqual(active.length, 2, "2 active pins for today");
  assert.ok(active.some((p) => p.url === "https://pinned.com/a"), "today pin included");
  assert.ok(active.some((p) => p.url === "https://pinned.com/b"), "yesterday pin included (within window)");
  assert.ok(!active.some((p) => p.url === "https://future.com/c"), "future pin excluded");
  assert.ok(!active.some((p) => p.url === "https://stale.com/d"), "stale pin excluded");
  console.log("getPinsForDate ✓");
}

// --- saveEditorialOverrides ---
{
  const overrides = {
    pins: [],
    excludes: [
      { url: "https://bad.com/a", date: TODAY },
      { url: "https://stale.com/b", date: EIGHT_DAYS_AGO }, // should be pruned
    ],
    source_suppressions: [],
  };
  const savePath = path.join(tmpDir, "saved-overrides.json");
  saveEditorialOverrides(savePath, overrides, TODAY, fs, path);
  const onDisk = JSON.parse(fs.readFileSync(savePath, "utf8"));
  assert.strictEqual(onDisk.excludes.length, 1, "stale entry pruned on save");
  assert.strictEqual(onDisk.excludes[0].url, "https://bad.com/a", "active entry kept");
  console.log("saveEditorialOverrides ✓");
}

console.log("All editorial-overrides-runtime tests passed ✓");
