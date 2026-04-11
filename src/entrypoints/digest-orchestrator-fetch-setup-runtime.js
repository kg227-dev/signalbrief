"use strict";

function createEmptyPreferredDomainShortlist() {
  return {
    source_of_truth: "standard_topic_broker",
    domains: [],
    topic_keys: [],
    official_friendly: false,
    active_path: null,
  };
}

function createEmptyPreferredSourceFamilyShortlists() {
  return {
    source_of_truth: "standard_topic_broker",
    reported_domains: [],
    official_domains: [],
    combined_domains: [],
    topic_keys: [],
    official_friendly: false,
    active_path: null,
  };
}

function createDigestOrchestratorFetchSetupRuntime(deps) {
  const {
    fs,
    path,
    processRef = process,
    appRoot,
    runtimePaths,
    nodeEnv,
    CONFIG,
    log,
    getDigestTriggerSource,
    resolveDeliveryModeFromTrigger,
    resolveDeliveryEventSource,
    buildPublicDigestUrl,
    createSourceRegistryRuntime,
    setAdminSourceRegistry,
    setPreferredSourceMatcher,
    loadDigestTuning,
    mergeDigestTuning,
    digestTuningPath,
    createBrokerCandidateInventoryRuntime,
    brokerCandidateInventoryPath,
    createStandardTopicBrokerRuntime,
    createDigestOrchestratorFetchRuntime,
    normalizeTopicToken,
    fetchTopicNews,
    emitDigestIncident,
    normalizeUrlForDedup,
    annotateEditorialSignals,
  } = deps;

  const bundledStandardTopicBrokerSourcesPath = path.join(
    appRoot,
    "config",
    "standard-topic-broker-sources.json"
  );
  const sourceRegistryRuntime = createSourceRegistryRuntime({
    fs,
    path,
    appRoot,
    env: processRef.env,
    nodeEnv,
    standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
    bundledStandardTopicBrokerSourcesPath,
  });

  function resetPreferredSourceMatcher() {
    setPreferredSourceMatcher(null);
  }

  async function prepareFetchRun({ digestDateKey, fetchDueUsers, runMode, now = new Date() }) {
    const triggerSource = getDigestTriggerSource();
    const deliveryMode = resolveDeliveryModeFromTrigger(triggerSource);
    const deliveryEventSource = resolveDeliveryEventSource(deliveryMode);
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: CONFIG.user.timezone,
    });
    const shortDate = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: CONFIG.user.timezone,
    });
    const publicDigestUrl = buildPublicDigestUrl(digestDateKey);

    const sourceRegistry = sourceRegistryRuntime.loadSourceRegistry();
    setAdminSourceRegistry(sourceRegistryRuntime.buildRegistryMap(sourceRegistry));
    if (sourceRegistry && sourceRegistry.domains && Object.keys(sourceRegistry.domains).length > 0) {
      log(`[source-policy] ${Object.keys(sourceRegistry.domains).length} admin source override(s) applied`);
    }

    const rawTuning = loadDigestTuning(digestTuningPath, fs);
    const mergedScoringConfig = mergeDigestTuning(CONFIG.digest?.scoring || {}, rawTuning);
    if (Object.keys(rawTuning).length > 0) {
      log(`[digest-tuning] overrides active: ${Object.keys(rawTuning).join(", ")}`);
    }

    const brokerCandidateInventoryRuntime = createBrokerCandidateInventoryRuntime({
      fs,
      path,
      inventoryPath: brokerCandidateInventoryPath,
      log,
    });
    const standardTopicBrokerRuntime = createStandardTopicBrokerRuntime({
      fs,
      path,
      appRoot,
      env: processRef.env,
      nodeEnv,
      standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
      bundledStandardTopicBrokerSourcesPath,
      log,
    });
    setPreferredSourceMatcher((sourceDomain, tag, options = {}) => (
      standardTopicBrokerRuntime.matchPreferredSourceFromConfig(sourceDomain, tag, options)
    ));

    const fetchRuntime = createDigestOrchestratorFetchRuntime({
      CONFIG,
      log,
      normalizeTopicToken,
      fetchTopicNews,
      buildPreferredDomainShortlist: (options = {}) => (
        standardTopicBrokerRuntime?.buildPreferredDomainShortlist?.(options)
        || createEmptyPreferredDomainShortlist()
      ),
      buildPreferredSourceFamilyShortlists: (options = {}) => (
        standardTopicBrokerRuntime?.buildPreferredSourceFamilyShortlists?.(options)
        || createEmptyPreferredSourceFamilyShortlists()
      ),
      emitDigestIncident,
      normalizeUrlForDedup,
      isFetchedItemEligible: (item) => {
        const annotated = annotateEditorialSignals([item]);
        return annotated.length > 0 && annotated[0].hard_exclude !== true;
      },
      annotateFetchedItems: annotateEditorialSignals,
      standardTopicBrokerRuntime,
      brokerCandidateInventoryRuntime,
    });
    const {
      selectionTarget,
      tagPriority,
      allItems,
      standardFetchCallsPlanned,
      standardFetchCalls,
      searchUsage,
      fetchDiagnostics,
    } = await fetchRuntime.orchestrateFetch({
      dueUsers: fetchDueUsers,
      runMode,
      scoringConfig: mergedScoringConfig,
    });

    return {
      now,
      deliveryMode,
      deliveryEventSource,
      dateStr,
      shortDate,
      publicDigestUrl,
      mergedScoringConfig,
      selectionTarget,
      tagPriority,
      allItems,
      standardFetchCallsPlanned,
      standardFetchCalls,
      searchUsage,
      fetchDiagnostics,
    };
  }

  return {
    prepareFetchRun,
    resetPreferredSourceMatcher,
  };
}

module.exports = {
  createDigestOrchestratorFetchSetupRuntime,
};
