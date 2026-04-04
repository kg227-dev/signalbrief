"use strict";

const fs = require("fs");
const path = require("path");
const {
  writeJsonAtomic,
  readJson,
  readManifest,
  updateManifest,
  markPhaseComplete,
} = require("./manifest-runtime");

function resolveArchiveDates(archiveDir, requestedDates) {
  if (requestedDates && requestedDates.length > 0) return requestedDates;
  const indexPath = path.join(archiveDir, "index.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return (index.dates || []).slice().sort().reverse().slice(0, 7);
  }
  return fs.readdirSync(archiveDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace(".json", ""))
    .sort().reverse()
    .slice(0, 7);
}

function loadArchiveItems(archiveDir, dates) {
  const items = [];
  for (const date of dates) {
    const filePath = path.join(archiveDir, `${date}.json`);
    if (!fs.existsSync(filePath)) continue;
    const archive = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const topicCount = {};
    for (const raw of archive.items || []) {
      const topic = raw.tag || "UNKNOWN";
      const idx = topicCount[topic] || 0;
      topicCount[topic] = idx + 1;
      items.push({
        id: `${date}:${topic}:${idx}`,
        date,
        topic,
        headline: raw.headline || null,
        summary: raw.summary || null,
        source: raw.source || null,
        source_domain: raw.source_domain || null,
        url: raw.url || null,
        publishedAt: raw.published_date || null,
        existing_wim: raw.wim || null,
        baselinePromptVersion: "production-snapshot",
        excerpt: raw.raw_content || null,
        baseScore: raw.baseScore != null ? raw.baseScore : null,
        strategic_value: raw.strategic_value != null ? raw.strategic_value : null,
        signal_shift: raw.signal_shift || null,
        writeup_status: raw.writeup_status || null,
        writeup_rejection_reasons: raw.writeup_rejection_reasons || [],
        cross_source_count: raw.cross_source_count || 0,
        content_flags: raw.content_flags || [],
        storyline_hints: raw.storyline_hints || [],
        inGoldSet: false,
      });
    }
  }
  return items;
}

function proposeGoldSet(items, targetSize) {
  targetSize = targetSize || 25;
  const selected = [];
  const usedIds = new Set();

  function addItem(item, reason) {
    if (usedIds.has(item.id)) return false;
    usedIds.add(item.id);
    selected.push({ item, reason });
    return true;
  }

  // Hard constraint: 2 per topic, ranked by baseScore
  const topics = Array.from(new Set(items.map(i => i.topic)));
  for (const topic of topics) {
    const sorted = items
      .filter(i => i.topic === topic)
      .sort((a, b) => (b.baseScore || 0) - (a.baseScore || 0));
    if (sorted[0]) addItem(sorted[0], "top-per-topic");
    if (sorted[1]) addItem(sorted[1], "top-per-topic");
  }

  function isTooClean(item) {
    return (
      (item.baseScore || 0) >= 8 &&
      (item.writeup_rejection_reasons || []).length === 0 &&
      item.writeup_status !== "repair_pass"
    );
  }

  // Tier 1: Importance (~35%)
  const importanceSlots = Math.round(targetSize * 0.35);
  items
    .filter(i => !usedIds.has(i.id))
    .filter(i => ((i.baseScore || 0) >= 7.5 || (i.strategic_value || 0) >= 0.75) && !isTooClean(i))
    .sort((a, b) => {
      const aH = ((a.baseScore || 0) >= 7.5 ? 1 : 0) + ((a.strategic_value || 0) >= 0.75 ? 1 : 0);
      const bH = ((b.baseScore || 0) >= 7.5 ? 1 : 0) + ((b.strategic_value || 0) >= 0.75 ? 1 : 0);
      return bH - aH || (b.baseScore || 0) - (a.baseScore || 0);
    })
    .slice(0, importanceSlots)
    .forEach(i => addItem(i, "high-importance"));

  // Tier 2: Borderline/tricky (~40%)
  const trickySlots = Math.round(targetSize * 0.40);
  items
    .filter(i => !usedIds.has(i.id))
    .filter(i => i.writeup_status === "repair_pass" || (i.writeup_rejection_reasons || []).length > 0)
    .slice(0, trickySlots)
    .forEach(i => addItem(i, "borderline-tricky"));

  // Tier 3: Generic-risk (~15%)
  const genericSlots = Math.round(targetSize * 0.15);
  items
    .filter(i => !usedIds.has(i.id))
    .filter(i => {
      const flags = i.content_flags || [];
      return flags.includes("generic_commentary") || flags.includes("conference_recap") || !i.signal_shift;
    })
    .slice(0, genericSlots)
    .forEach(i => addItem(i, "generic-risk"));

  // Tier 4: Diversity fill
  items
    .filter(i => !usedIds.has(i.id))
    .forEach(i => { if (selected.length < targetSize) addItem(i, "diversity-fill"); });

  // Shuffle to avoid anchoring bias during human review
  const arr = selected.slice(0, targetSize);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }

  return arr.map(function(entry) {
    return {
      id: entry.item.id,
      topic: entry.item.topic,
      headline: entry.item.headline,
      selectionReason: entry.reason,
      notes: "",
    };
  });
}

function runDatasetPhase(opts) {
  const { archiveDir, runDir, dates, limit, overwrite } = opts;

  const datasetPath = path.join(runDir, "dataset.json");
  const goldSetPath = path.join(runDir, "gold-set.json");

  if (!overwrite && fs.existsSync(datasetPath)) {
    throw new Error(`dataset.json already exists in ${runDir}. Use --overwrite=true to overwrite.`);
  }

  const items = loadArchiveItems(archiveDir, dates);
  const limited = limit ? items.slice(0, limit) : items;
  const topics = Array.from(new Set(limited.map(i => i.topic)));

  const dataset = {
    items: limited,
    meta: { dates, totalItems: limited.length, topics },
  };
  writeJsonAtomic(datasetPath, dataset);

  const goldItems = proposeGoldSet(limited, 25);
  const goldSet = {
    goldSetApproved: false,
    proposedAt: new Date().toISOString(),
    targetSize: 25,
    items: goldItems,
  };
  writeJsonAtomic(goldSetPath, goldSet);

  // Mark inGoldSet on dataset items and rewrite
  const goldIds = new Set(goldItems.map(g => g.id));
  limited.forEach(item => { item.inGoldSet = goldIds.has(item.id); });
  writeJsonAtomic(datasetPath, dataset);

  updateManifest(runDir, {
    archiveDates: dates,
    itemCount: limited.length,
    goldSetSize: goldItems.length,
    goldSetApproved: false,
  });
  markPhaseComplete(runDir, "dataset");

  return { dataset, goldSet };
}

module.exports = {
  resolveArchiveDates,
  loadArchiveItems,
  proposeGoldSet,
  runDatasetPhase,
};
