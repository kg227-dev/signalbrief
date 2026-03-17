#!/usr/bin/env node
/**
 * bootstrap-domain-stats.js
 *
 * Seeds data/domain-stats.json from existing digest records so the domain
 * learning system has immediate signal instead of starting cold.
 *
 * Usage: node scripts/bootstrap-domain-stats.js [--dry-run]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const RECORDS_DIR = path.join(APP_ROOT, "data", "digest-records");
const STATS_FILE = path.join(APP_ROOT, "data", "domain-stats.json");

const {
  accumulateDomainStats,
  saveDomainStats,
} = require("../src/digest/domain/domain-learning-runtime");

const dryRun = process.argv.includes("--dry-run");

function walkRecords(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRecords(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

function loadRecord(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function main() {
  const files = walkRecords(RECORDS_DIR);
  if (files.length === 0) {
    console.log("No digest records found. Nothing to bootstrap.");
    return;
  }

  let stats = {};
  let totalItems = 0;
  let processedFiles = 0;

  for (const file of files) {
    const record = loadRecord(file);
    if (!record) continue;
    // Records store items under current.items (canonical format)
    const items = Array.isArray(record.current?.items)
      ? record.current.items
      : Array.isArray(record.items) ? record.items : [];
    if (items.length === 0) continue;
    stats = accumulateDomainStats(items, stats);
    totalItems += items.length;
    processedFiles++;
  }

  const domainCount = Object.keys(stats).length;
  console.log(`Processed ${processedFiles} record(s), ${totalItems} item(s) → ${domainCount} domain(s)`);

  if (domainCount === 0) {
    console.log("No domain data found in records. domain-stats.json not written.");
    return;
  }

  // Show top 10 by quality score
  const top = Object.entries(stats)
    .sort((a, b) => (b[1].quality_score || 0) - (a[1].quality_score || 0))
    .slice(0, 10);
  console.log("\nTop domains by quality score:");
  for (const [domain, entry] of top) {
    console.log(
      `  ${domain.padEnd(32)} appearances=${String(entry.appearances).padStart(3)}  quality=${Number(entry.quality_score).toFixed(3)}`
    );
  }

  if (dryRun) {
    console.log("\n[dry-run] domain-stats.json not written.");
    return;
  }

  saveDomainStats(stats);
  console.log(`\nWrote ${STATS_FILE}`);
}

main();
