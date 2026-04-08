"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-setup-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createDigestOrchestratorFetchSetupRuntime,
} = runtime;

function buildRuntime(overrides = {}) {
  const state = {
    logs: [],
    adminRegistry: null,
    preferredMatcher: undefined,
    fetchArgs: [],
    preferredDomainShortlist: null,
    preferredSourceFamilyShortlists: null,
    itemEligible: null,
    annotatedItems: null,
  };
  const deps = {
    fs: { label: "fs" },
    path,
    processRef: { env: { NODE_ENV: "test" } },
    appRoot: process.cwd(),
    runtimePaths: {
      standardTopicBrokerSourcesPath: "/tmp/standard-topic-broker-sources.json",
    },
    nodeEnv: "test",
    CONFIG: {
      user: { timezone: "America/New_York" },
      digest: { scoring: { authorityWeight: 0.4 } },
    },
    log: (message) => state.logs.push(String(message)),
    getDigestTriggerSource: () => "scheduler",
    resolveDeliveryModeFromTrigger: (triggerSource) => `mode:${triggerSource}`,
    resolveDeliveryEventSource: (deliveryMode) => `event:${deliveryMode}`,
    buildPublicDigestUrl: (dateKey) => `https://example.com/digest/${dateKey}`,
    createSourceRegistryRuntime: (options) => {
      state.sourceRegistryOptions = options;
      return {
        loadSourceRegistry: () => ({
          domains: {
            "example.com": { tier: "preferred" },
          },
        }),
        buildRegistryMap: (registry) => ({
          domainCount: Object.keys(registry?.domains || {}).length,
        }),
      };
    },
    setAdminSourceRegistry: (registryMap) => {
      state.adminRegistry = registryMap;
    },
    setPreferredSourceMatcher: (matcher) => {
      state.preferredMatcher = matcher;
    },
    loadDigestTuning: (_digestTuningPath, fsRef) => {
      state.digestTuningLoad = fsRef;
      return { freshnessWeight: 0.7 };
    },
    mergeDigestTuning: (baseConfig, rawTuning) => ({
      ...baseConfig,
      ...rawTuning,
      merged: true,
    }),
    digestTuningPath: "/tmp/digest-tuning.json",
    createBrokerCandidateInventoryRuntime: (options) => {
      state.brokerCandidateInventoryOptions = options;
      return { kind: "inventory-runtime" };
    },
    brokerCandidateInventoryPath: "/tmp/broker-candidate-inventory.json",
    createStandardTopicBrokerRuntime: (options) => {
      state.standardTopicBrokerOptions = options;
      return {
        matchPreferredSourceFromConfig: (sourceDomain, tag, matchOptions) => ({
          sourceDomain,
          tag,
          matchOptions,
        }),
        buildPreferredDomainShortlist: ({ topicTag }) => ({
          source_of_truth: "standard_topic_broker",
          domains: [`${String(topicTag).toLowerCase()}.example.com`],
          topic_keys: [String(topicTag).toLowerCase()],
          official_friendly: false,
          active_path: "/tmp/standard-topic-broker-sources.json",
        }),
        buildPreferredSourceFamilyShortlists: ({ topicTag }) => ({
          source_of_truth: "standard_topic_broker",
          reported_domains: [`${String(topicTag).toLowerCase()}.reported.com`],
          official_domains: [`${String(topicTag).toLowerCase()}.gov`],
          combined_domains: [
            `${String(topicTag).toLowerCase()}.reported.com`,
            `${String(topicTag).toLowerCase()}.gov`,
          ],
          topic_keys: [String(topicTag).toLowerCase()],
          official_friendly: true,
          active_path: "/tmp/standard-topic-broker-sources.json",
        }),
      };
    },
    createDigestOrchestratorFetchRuntime: (options) => {
      state.fetchRuntimeOptions = options;
      return {
        orchestrateFetch: async (args) => {
          state.fetchArgs.push(args);
          state.preferredDomainShortlist = options.buildPreferredDomainShortlist({
            topicTag: "TECHNOLOGY",
            dueUserTopics: ["TECHNOLOGY"],
          });
          state.preferredSourceFamilyShortlists = options.buildPreferredSourceFamilyShortlists({
            topicTag: "TECHNOLOGY",
            dueUserTopics: ["TECHNOLOGY"],
          });
          state.itemEligible = options.isFetchedItemEligible({
            headline: "Preferred story",
          });
          state.annotatedItems = options.annotateFetchedItems([{ id: "story-1" }]);
          return {
            selectionTarget: 5,
            tagPriority: { technology: 1 },
            allItems: [{ headline: "Preferred story" }],
            standardFetchCallsPlanned: 2,
            standardFetchCalls: 2,
            fetchDiagnostics: { search_budget_calls_used: 2 },
          };
        },
      };
    },
    normalizeTopicToken: (value) => String(value || "").trim().toLowerCase(),
    fetchTopicNews: async () => ({}),
    emitDigestIncident: async () => false,
    normalizeUrlForDedup: (value) => String(value || ""),
    annotateEditorialSignals: (items) => (
      Array.isArray(items)
        ? items.map((item) => ({ ...item, hard_exclude: false, annotated: true }))
        : []
    ),
    ...overrides,
  };

  return {
    state,
    runtime: createDigestOrchestratorFetchSetupRuntime(deps),
  };
}

(async () => {
  {
    const { state, runtime: fetchSetupRuntime } = buildRuntime();
    const now = new Date("2026-04-08T14:30:00.000Z");
    const out = await fetchSetupRuntime.prepareFetchRun({
      digestDateKey: "2026-04-08",
      fetchDueUsers: [{ chatId: "u1", topics: ["TECHNOLOGY"] }],
      runMode: "scheduled",
      now,
    });

    assert.strictEqual(out.now, now);
    assert.strictEqual(out.deliveryMode, "mode:scheduler");
    assert.strictEqual(out.deliveryEventSource, "event:mode:scheduler");
    assert.strictEqual(out.publicDigestUrl, "https://example.com/digest/2026-04-08");
    assert.deepStrictEqual(out.mergedScoringConfig, {
      authorityWeight: 0.4,
      freshnessWeight: 0.7,
      merged: true,
    });
    assert.strictEqual(out.standardFetchCallsPlanned, 2);
    assert.strictEqual(out.standardFetchCalls, 2);
    assert.deepStrictEqual(out.tagPriority, { technology: 1 });
    assert.strictEqual(out.allItems.length, 1);
    assert.strictEqual(out.fetchDiagnostics.search_budget_calls_used, 2);
    assert.deepStrictEqual(state.adminRegistry, { domainCount: 1 });
    assert.ok(state.logs.some((line) => line.includes("[source-policy] 1 admin source override(s) applied")));
    assert.ok(state.logs.some((line) => line.includes("[digest-tuning] overrides active: freshnessWeight")));
    assert.strictEqual(state.fetchArgs.length, 1);
    assert.deepStrictEqual(state.fetchArgs[0], {
      dueUsers: [{ chatId: "u1", topics: ["TECHNOLOGY"] }],
      runMode: "scheduled",
      scoringConfig: out.mergedScoringConfig,
    });
    assert.deepStrictEqual(state.preferredDomainShortlist.domains, ["technology.example.com"]);
    assert.deepStrictEqual(state.preferredSourceFamilyShortlists.combined_domains, [
      "technology.reported.com",
      "technology.gov",
    ]);
    assert.strictEqual(state.itemEligible, true);
    assert.deepStrictEqual(state.annotatedItems, [{ id: "story-1", hard_exclude: false, annotated: true }]);
    assert.deepStrictEqual(
      state.preferredMatcher("reuters.com", "TECHNOLOGY", { strict: true }),
      {
        sourceDomain: "reuters.com",
        tag: "TECHNOLOGY",
        matchOptions: { strict: true },
      }
    );

    fetchSetupRuntime.resetPreferredSourceMatcher();
    assert.strictEqual(state.preferredMatcher, null);
  }

  {
    const { state, runtime: fetchSetupRuntime } = buildRuntime({
      createSourceRegistryRuntime: () => ({
        loadSourceRegistry: () => ({ domains: {} }),
        buildRegistryMap: () => ({}),
      }),
      loadDigestTuning: () => ({}),
      createStandardTopicBrokerRuntime: () => ({
        matchPreferredSourceFromConfig: () => null,
      }),
    });

    await fetchSetupRuntime.prepareFetchRun({
      digestDateKey: "2026-04-08",
      fetchDueUsers: [{ chatId: "u2", topics: ["HEALTHCARE"] }],
      runMode: "scheduled",
      now: new Date("2026-04-08T14:30:00.000Z"),
    });

    assert.deepStrictEqual(state.preferredDomainShortlist, {
      source_of_truth: "standard_topic_broker",
      domains: [],
      topic_keys: [],
      official_friendly: false,
      active_path: null,
    });
    assert.deepStrictEqual(state.preferredSourceFamilyShortlists, {
      source_of_truth: "standard_topic_broker",
      reported_domains: [],
      official_domains: [],
      combined_domains: [],
      topic_keys: [],
      official_friendly: false,
      active_path: null,
    });
    assert.ok(state.logs.every((line) => !line.includes("[source-policy]")));
    assert.ok(state.logs.every((line) => !line.includes("[digest-tuning]")));
  }

  process.stdout.write("[digest-orchestrator-fetch-setup-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
