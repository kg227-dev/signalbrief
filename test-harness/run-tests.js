#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  ROOT_DIR,
  RESULTS_DIR,
  RUNS_DIR,
  IMPROVEMENT_LOG_FILE,
  COSTS,
  SUITE_IDS,
  etDateKey,
  ensureHarnessPaths,
  parseArgs,
  loadAppConfig,
  writeJson,
  readJson,
} = require("./config");
const {
  loadBudget,
  fetchTopicNewsCached,
  enrichItemsCached,
  loadArchiveDigests,
} = require("./cache");
const { buildPersonas } = require("./personas");
const { selectItems } = require("./pipeline");
const { buildEvaluator } = require("./evaluator");
const { printConsoleReport } = require("./reporters/console");
const { writeRunReport } = require("./reporters/json");

const suiteModules = [
  require("./suites/01-topic-matching"),
  require("./suites/02-relevance-scoring"),
  require("./suites/03-analysis-quality"),
  require("./suites/04-diversity"),
  require("./suites/05-custom-topics"),
  require("./suites/06-depth-control"),
  require("./suites/07-item-count"),
  require("./suites/08-cross-day-freshness"),
  require("./suites/09-end-to-end"),
];

function syncBudget(target, next) {
  if (!next || typeof next !== "object") return;
  target.cap = next.cap;
  target.spent = next.spent;
  target.remaining = next.remaining;
  target.calls = next.calls;
}

function normalizeCustomKeyword(topic) {
  return String(topic || "")
    .replace(/^custom_/, "")
    .replace(/_/g, " ")
    .trim();
}

function normalizeTopicToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^custom_/i, "")
    .replace(/×/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function standardTopicUniverse(appConfig) {
  return (appConfig.topics || []).map((t) => t.tag).filter(Boolean);
}

function collectCustomTopics(personas, limit = 5) {
  const values = [];
  for (const p of personas) {
    for (const t of p.topics || []) {
      if (!String(t).startsWith("custom_")) continue;
      values.push(normalizeCustomKeyword(t));
    }
  }
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function maxRequestedItems(personas, fallback = 7) {
  const requested = (personas || [])
    .map((p) => Number(p?.preferences?.items_per_digest))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Math.max(Number(fallback || 7), requested.length ? Math.max(...requested) : 0);
}

function loadOfflineDataset(appConfig) {
  const archiveDir = path.join(ROOT_DIR, "archive");
  const archives = loadArchiveDigests(archiveDir);
  if (!archives.length) {
    throw new Error("Offline mode requested but no archive data found. Use --live to warm cache first.");
  }

  const latest = archives[archives.length - 1];
  const items = (latest.items || []).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    url: item.url,
    tag: item.tag,
    wim: item.wim || null,
    implications: item.implications || null,
    watch_next: item.watch_next || null,
    baseScore: typeof item.baseScore === "number" ? item.baseScore : 5,
  }));

  const digestConfig = appConfig.digest || {};
  const itemCount = Number(digestConfig.itemCount || 7);

  return {
    mode: "offline_archive",
    generated_at: new Date().toISOString(),
    date_key: latest.date || etDateKey(),
    standard_fetch_topics: [],
    custom_fetch_topics: [],
    raw_items: items,
    selected_items: items.slice(0, itemCount),
    enriched_items: items.slice(0, itemCount),
    metadata: {
      archive_date: latest.date,
      archive_item_count: items.length,
      selection_target: itemCount,
      max_custom_items: 0,
    },
  };
}

async function buildLiveOrCachedDataset({ appConfig, personas, args, budget }) {
  const digestConfig = appConfig.digest || {};
  const topics = appConfig.topics || [];
  const dateKey = etDateKey();
  const selectionTarget = maxRequestedItems(personas, Number(digestConfig.itemCount || 7));

  const standardItemsByTopic = [];
  for (const topic of topics) {
    const query = Array.isArray(topic.queries) && topic.queries.length ? topic.queries[0] : topic.tag;
    const fetchResult = await fetchTopicNewsCached({
      topicTag: topic.tag,
      query,
      dateKey,
      appConfig,
      budget,
      allowLiveApi: args.allow_live_api,
      refreshCache: args.refresh_cache,
      costs: COSTS,
    });
    if (fetchResult.budget) syncBudget(budget, fetchResult.budget);
    standardItemsByTopic.push({
      tag: topic.tag,
      from_cache: fetchResult.from_cache,
      cache_file: fetchResult.cache_file,
      item_count: (fetchResult.items || []).length,
      items: fetchResult.items || [],
    });
  }

  const customKeywords = collectCustomTopics(personas, 5);
  const customItemsByTopic = [];
  for (const keyword of customKeywords) {
    const topicTag = keyword.toUpperCase();
    const query = `${keyword} company news business strategy developments last 48 hours`;
    const fetchResult = await fetchTopicNewsCached({
      topicTag,
      query,
      dateKey,
      appConfig,
      budget,
      allowLiveApi: args.allow_live_api,
      refreshCache: args.refresh_cache,
      costs: COSTS,
    });
    if (fetchResult.budget) syncBudget(budget, fetchResult.budget);
    customItemsByTopic.push({
      keyword,
      tag: topicTag,
      from_cache: fetchResult.from_cache,
      cache_file: fetchResult.cache_file,
      item_count: (fetchResult.items || []).length,
      items: fetchResult.items || [],
    });
  }

  const standardRawItems = standardItemsByTopic.flatMap((x) => x.items || []);
  const customRawItems = customItemsByTopic.flatMap((x) => x.items || []);
  const allRawItems = [...customRawItems, ...standardRawItems];
  const customTags = customItemsByTopic.map((x) => x.tag);
  const tagPriority = {};
  for (const persona of personas || []) {
    for (const topic of persona.topics || []) {
      const key = normalizeTopicToken(topic);
      if (!key) continue;
      tagPriority[key] = (tagPriority[key] || 0) + 1;
    }
  }
  const configuredMaxCustom = Number(digestConfig.maxCustomItemsPerRun);
  const defaultMaxCustom = customTags.length > 0 ? Math.max(1, Math.floor(selectionTarget * 0.4)) : 0;
  const maxCustomItems = Number.isFinite(configuredMaxCustom) && configuredMaxCustom >= 0
    ? configuredMaxCustom
    : defaultMaxCustom;

  const selectedItems = selectItems(
    allRawItems,
    selectionTarget,
    Number(digestConfig.maxItemsPerTag || 2),
    { customTags, maxCustomItems, tagPriority }
  );

  const enrichResult = await enrichItemsCached({
    items: selectedItems,
    appConfig,
    budget,
    allowLiveApi: args.allow_live_api,
    refreshCache: args.refresh_cache,
    costs: COSTS,
  });
  if (enrichResult.budget) syncBudget(budget, enrichResult.budget);

  return {
    mode: args.allow_live_api ? "live_or_cache" : "cache_only",
    generated_at: new Date().toISOString(),
    date_key: dateKey,
    standard_fetch_topics: standardItemsByTopic.map((x) => ({
      tag: x.tag,
      item_count: x.item_count,
      from_cache: x.from_cache,
      cache_file: x.cache_file,
    })),
    custom_fetch_topics: customItemsByTopic.map((x) => ({
      keyword: x.keyword,
      tag: x.tag,
      item_count: x.item_count,
      from_cache: x.from_cache,
      cache_file: x.cache_file,
    })),
    raw_items: allRawItems,
    selected_items: selectedItems,
    enriched_items: enrichResult.items || [],
    metadata: {
      standard_raw_item_count: standardRawItems.length,
      custom_raw_item_count: customRawItems.length,
      selected_item_count: selectedItems.length,
      selection_target: selectionTarget,
      max_custom_items: maxCustomItems,
      enrichment_usage: enrichResult.usage || { input_tokens: 0, output_tokens: 0 },
      enrichment_from_cache: enrichResult.from_cache,
    },
  };
}

function selectSuites(args) {
  if (!args.run_suite_ids || !args.run_suite_ids.length) return suiteModules;

  const wanted = new Set(
    args.run_suite_ids.map((raw) =>
      String(raw)
        .trim()
        .toLowerCase()
    )
  );

  return suiteModules.filter((suite) => {
    const id = String(suite.id || "").toLowerCase();
    const shortId = id.slice(0, 2);
    const key = id.replace(/^\d+-/, "");
    return wanted.has(id) || wanted.has(shortId) || wanted.has(key);
  });
}

function buildImprovementPriorities(suites) {
  const guide = {
    "01-topic-matching": {
      issue: "Topic filter leakage under low-match fallback",
      suite: "01",
      fix: "Adjust top-up behavior in digest user filter to avoid unrelated tag fill-ins unless explicitly allowed.",
      file: `${ROOT_DIR}/digest.js:758`,
    },
    "02-relevance-scoring": {
      issue: "Weak weight-to-rank sensitivity",
      suite: "02",
      fix: "Tune topicMatch and weightBonus contributions in applyRelevanceScores for stronger ordering separation.",
      file: `${ROOT_DIR}/digest.js:337`,
    },
    "03-analysis-quality": {
      issue: "Why-it-matters lacks specificity/actionability",
      suite: "03",
      fix: "Strengthen enrichment prompt constraints for concrete entities, numbers, and decision-maker implications.",
      file: `${ROOT_DIR}/digest.js:190`,
    },
    "04-diversity": {
      issue: "Tag clustering or weak interleaving",
      suite: "04",
      fix: "Improve selectItems interleaving and cap logic to maximize unique-tag spread.",
      file: `${ROOT_DIR}/digest.js:149`,
    },
    "05-custom-topics": {
      issue: "Custom topic signals not consistently represented",
      suite: "05",
      fix: "Refine custom query generation and post-score prioritization for matched custom keywords.",
      file: `${ROOT_DIR}/digest.js:688`,
    },
    "06-depth-control": {
      issue: "Deep mode adds length without enough extra insight",
      suite: "06",
      fix: "Introduce depth-specific generation rather than simple one-line truncation from deep output.",
      file: `${ROOT_DIR}/digest.js:801`,
    },
    "07-item-count": {
      issue: "Requested item counts constrained by global selection cap",
      suite: "07",
      fix: "Align global selection count with max supported per-user items_per_digest or make selection count dynamic.",
      file: `${ROOT_DIR}/digest.js:162`,
    },
    "08-cross-day-freshness": {
      issue: "Repeat story overlap across days",
      suite: "08",
      fix: "Add cross-day dedup against recent archives before final selection.",
      file: `${ROOT_DIR}/digest.js:149`,
    },
  };

  const severity = { fail: 2, warn: 1, pass: 0, skip: 0 };
  const actionable = suites
    .filter((s) => ["fail", "warn"].includes(String(s.status || "").toLowerCase()))
    .sort((a, b) => {
      const sev = severity[String(b.status || "").toLowerCase()] - severity[String(a.status || "").toLowerCase()];
      if (sev !== 0) return sev;
      return Number(a.score || 0) - Number(b.score || 0);
    })
    .map((suite, idx) => {
      const row = guide[suite.id] || {
        issue: `${suite.name} under target`,
        suite: suite.id,
        fix: (suite.suggestions && suite.suggestions[0]) || "Investigate suite findings and tune logic.",
        file: null,
      };
      return {
        rank: idx + 1,
        issue: row.issue,
        suite: row.suite,
        fix: row.fix,
        file: row.file,
      };
    });

  return actionable;
}

async function main() {
  ensureHarnessPaths();

  const args = parseArgs(process.argv.slice(2));
  const appConfig = loadAppConfig();
  const budget = loadBudget();

  const personas = buildPersonas(standardTopicUniverse(appConfig));

  let dataset;
  try {
    dataset = await buildLiveOrCachedDataset({ appConfig, personas, args, budget });
  } catch (err) {
    if (!args.offline_fallback) throw err;
    dataset = loadOfflineDataset(appConfig);
  }

  const datasetSnapshotPath = path.join(RESULTS_DIR, "dataset-latest.json");
  writeJson(datasetSnapshotPath, dataset);

  if (!fs.existsSync(IMPROVEMENT_LOG_FILE)) {
    writeJson(IMPROVEMENT_LOG_FILE, []);
  }

  const archiveDir = path.join(ROOT_DIR, "archive");
  const archives = loadArchiveDigests(archiveDir);

  const runtime = {
    defaultItemCount: Number(dataset?.metadata?.selection_target || appConfig?.digest?.itemCount || 7),
    maxItemsPerTag: Number(appConfig?.digest?.maxItemsPerTag || 2),
    minFilteredItems: 3,
    max_analysis_samples: args.max_analysis_samples,
    max_depth_pairs: args.max_depth_pairs,
    allow_live_api: args.allow_live_api,
    refresh_cache: args.refresh_cache,
    no_judge: args.no_judge,
  };

  const evaluator = buildEvaluator({
    appConfig,
    budget,
    allowLiveApi: args.allow_live_api,
    refreshCache: args.refresh_cache,
    noJudge: args.no_judge,
    costs: COSTS,
  });

  const chosenSuites = selectSuites(args);
  const suiteResults = [];
  const suiteResultsById = {};

  for (const suite of chosenSuites) {
    if (!SUITE_IDS.includes(suite.id)) continue;

    const result = await suite.run({
      personas,
      dataset,
      archives,
      runtime,
      evaluator,
      appConfig,
      budget,
      suiteResultsById,
    });

    suiteResults.push(result);
    suiteResultsById[suite.id] = result;
  }

  const compositeSuite = suiteResultsById["09-end-to-end"] || null;
  const compositeScoresByPersona = compositeSuite?.per_persona || {};
  const rankedComposite = compositeSuite?.details?.ranking || [];

  const compositeSummary = {
    average_score: compositeSuite ? Number(compositeSuite.score || 0) : 0,
    best_persona: rankedComposite[0] || null,
    worst_persona: rankedComposite[rankedComposite.length - 1] || null,
  };

  const timestamp = new Date().toISOString();
  const runId = timestamp.replace(/[:.]/g, "-");

  const improvementPriorities = buildImprovementPriorities(suiteResults);

  const report = writeRunReport({
    timestamp,
    runId,
    runsDir: RUNS_DIR,
    budget,
    suites: suiteResults,
    compositeScoresByPersona,
    improvementPriorities,
  });

  printConsoleReport({
    timestamp,
    suites: suiteResults,
    budget,
    compositeSummary,
  });

  console.log(`Report written: ${report.file}`);
  console.log(`Dataset snapshot: ${datasetSnapshotPath}`);
}

main().catch((err) => {
  console.error("[test-harness] fatal:", err.message);
  process.exit(1);
});
