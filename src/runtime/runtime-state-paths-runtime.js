"use strict";

const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..", "..");

function resolveAppRoot(appRoot) {
  return appRoot ? path.resolve(String(appRoot)) : APP_ROOT;
}

function readEnvValue(env, key) {
  return String(env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : "").trim();
}

function resolveOptionalPath(rawValue, fallbackPath) {
  const explicit = String(rawValue || "").trim();
  return explicit ? path.resolve(explicit) : path.resolve(fallbackPath);
}

function defaultDataDir(options = {}) {
  const appRoot = resolveAppRoot(options.appRoot);
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const explicit = readEnvValue(env, "SIGNALBRIEF_DATA_DIR");
  if (explicit) return path.resolve(explicit);

  const nodeEnv = String(options.nodeEnv || env.NODE_ENV || "").toLowerCase().trim();
  if (nodeEnv === "test") {
    return path.resolve(path.join(appRoot, ".tmp", "test-data"));
  }
  return path.resolve(path.join(appRoot, "data"));
}

function resolveSignalBriefRuntimePaths(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const appRoot = resolveAppRoot(options.appRoot);
  const dataDir = options.dataDir
    ? path.resolve(String(options.dataDir))
    : defaultDataDir({ appRoot, env, nodeEnv: options.nodeEnv });

  const sqlitePath = resolveOptionalPath(
    options.sqlitePath || readEnvValue(env, "SIGNALBRIEF_SQLITE_PATH"),
    path.join(dataDir, "signalbrief.sqlite")
  );
  const archiveDir = resolveOptionalPath(
    options.archiveDir || readEnvValue(env, "SIGNALBRIEF_ARCHIVE_DIR"),
    path.join(dataDir, "archive")
  );
  const digestRecordsDir = resolveOptionalPath(
    options.digestRecordsDir || readEnvValue(env, "SIGNALBRIEF_DIGEST_RECORDS_DIR"),
    path.join(dataDir, "digest-records")
  );
  const digestRetryStatePath = resolveOptionalPath(
    options.digestRetryStatePath || readEnvValue(env, "SIGNALBRIEF_DIGEST_RETRY_STATE_PATH"),
    path.join(dataDir, "digest-retry-state.json")
  );
  const costLogPath = resolveOptionalPath(
    options.costLogPath || readEnvValue(env, "SIGNALBRIEF_COST_LOG_PATH"),
    path.join(dataDir, "cost-log.json")
  );
  const engagementEventsPath = resolveOptionalPath(
    options.engagementEventsPath || readEnvValue(env, "SIGNALBRIEF_ENGAGEMENT_EVENTS_PATH"),
    path.join(dataDir, "engagement-events.jsonl")
  );
  const adminActionLogPath = resolveOptionalPath(
    options.adminActionLogPath || readEnvValue(env, "SIGNALBRIEF_ADMIN_ACTION_LOG_PATH"),
    path.join(dataDir, "admin-action-log.json")
  );
  const adminMessageLogPath = resolveOptionalPath(
    options.adminMessageLogPath || readEnvValue(env, "SIGNALBRIEF_ADMIN_MESSAGE_LOG_PATH"),
    path.join(dataDir, "admin-message-log.json")
  );
  const digestIncidentLogPath = resolveOptionalPath(
    options.digestIncidentLogPath || readEnvValue(env, "SIGNALBRIEF_DIGEST_INCIDENT_LOG_PATH"),
    path.join(dataDir, "digest-incident-log.jsonl")
  );
  const archiveLegacyUsageLogPath = resolveOptionalPath(
    options.archiveLegacyUsageLogPath || readEnvValue(env, "SIGNALBRIEF_ARCHIVE_LEGACY_USAGE_LOG_PATH"),
    path.join(dataDir, "archive-legacy-usage.jsonl")
  );
  const schedulerHeartbeatPath = resolveOptionalPath(
    options.schedulerHeartbeatPath || readEnvValue(env, "SCHEDULER_HEARTBEAT_FILE"),
    path.join(dataDir, "scheduler-heartbeat.json")
  );
  const schedulerControlPath = resolveOptionalPath(
    options.schedulerControlPath || readEnvValue(env, "SCHEDULER_CONTROL_FILE"),
    path.join(path.dirname(schedulerHeartbeatPath), "scheduler-control.json")
  );
  const digestRunLockPath = resolveOptionalPath(
    options.digestRunLockPath || readEnvValue(env, "SIGNALBRIEF_DIGEST_RUN_LOCK_PATH"),
    path.join(dataDir, "digest-run.lock")
  );
  const digestOnDemandCooldownPath = resolveOptionalPath(
    options.digestOnDemandCooldownPath || readEnvValue(env, "DIGEST_ON_DEMAND_COOLDOWN_FILE"),
    path.join(dataDir, "digest-on-demand-cooldown.json")
  );
  const domainStatsPath = resolveOptionalPath(
    options.domainStatsPath || readEnvValue(env, "SIGNALBRIEF_DOMAIN_STATS_PATH"),
    path.join(dataDir, "domain-stats.json")
  );
  const sourceRegistryPath = resolveOptionalPath(
    options.sourceRegistryPath || readEnvValue(env, "SIGNALBRIEF_SOURCE_REGISTRY_PATH"),
    path.join(dataDir, "source-registry.json")
  );
  const preferredSourcesPath = resolveOptionalPath(
    options.preferredSourcesPath || readEnvValue(env, "SIGNALBRIEF_PREFERRED_SOURCES_PATH"),
    path.join(dataDir, "preferred-sources.json")
  );
  const standardTopicBrokerSourcesPath = resolveOptionalPath(
    options.standardTopicBrokerSourcesPath || readEnvValue(env, "SIGNALBRIEF_STANDARD_TOPIC_BROKER_SOURCES_PATH"),
    path.join(dataDir, "standard-topic-broker-sources.json")
  );
  const spendGuardStatePath = resolveOptionalPath(
    options.spendGuardStatePath || readEnvValue(env, "SIGNALBRIEF_SPEND_GUARD_STATE_PATH"),
    path.join(dataDir, "spend-guard-state.json")
  );
  const circuitBreakerStatePath = resolveOptionalPath(
    options.circuitBreakerStatePath || readEnvValue(env, "SIGNALBRIEF_CIRCUIT_BREAKER_STATE_PATH"),
    path.join(dataDir, "circuit-breaker.json")
  );

  return {
    appRoot,
    dataDir,
    sqlitePath,
    archiveDir,
    digestRecordsDir,
    digestRetryStatePath,
    costLogPath,
    engagementEventsPath,
    adminActionLogPath,
    adminMessageLogPath,
    digestIncidentLogPath,
    archiveLegacyUsageLogPath,
    schedulerHeartbeatPath,
    schedulerControlPath,
    digestRunLockPath,
    digestOnDemandCooldownPath,
    domainStatsPath,
    sourceRegistryPath,
    preferredSourcesPath,
    standardTopicBrokerSourcesPath,
    spendGuardStatePath,
    circuitBreakerStatePath,
    legacyDataDir: path.join(appRoot, "data"),
    legacyArchiveDir: path.join(appRoot, "archive"),
  };
}

function isWithinPath(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deriveComponentRoot(targetPath, dataDir, options = {}) {
  const resolvedTarget = path.resolve(String(targetPath || ""));
  const anchor = options.isDir ? resolvedTarget : path.dirname(resolvedTarget);
  return isWithinPath(dataDir, anchor) ? path.resolve(dataDir) : anchor;
}

function uniqSorted(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function describeRuntimePathAlignment(runtimePaths) {
  const paths = runtimePaths && typeof runtimePaths === "object"
    ? runtimePaths
    : resolveSignalBriefRuntimePaths();
  const dataRoot = path.resolve(paths.dataDir);
  const logRoots = uniqSorted([
    deriveComponentRoot(paths.costLogPath, dataRoot),
    deriveComponentRoot(paths.engagementEventsPath, dataRoot),
    deriveComponentRoot(paths.adminActionLogPath, dataRoot),
    deriveComponentRoot(paths.adminMessageLogPath, dataRoot),
    deriveComponentRoot(paths.digestIncidentLogPath, dataRoot),
    deriveComponentRoot(paths.archiveLegacyUsageLogPath, dataRoot),
  ]);
  const schedulerRoots = uniqSorted([
    deriveComponentRoot(paths.schedulerHeartbeatPath, dataRoot),
    deriveComponentRoot(paths.schedulerControlPath, dataRoot),
    deriveComponentRoot(paths.digestRunLockPath, dataRoot),
    deriveComponentRoot(paths.digestOnDemandCooldownPath, dataRoot),
  ]);

  const componentRoots = {
    store: dataRoot,
    sqlite: deriveComponentRoot(paths.sqlitePath, dataRoot),
    archive: deriveComponentRoot(paths.archiveDir, dataRoot, { isDir: true }),
    digest_records: deriveComponentRoot(paths.digestRecordsDir, dataRoot, { isDir: true }),
    digest_retry_state: deriveComponentRoot(paths.digestRetryStatePath, dataRoot),
    domain_stats: deriveComponentRoot(paths.domainStatsPath, dataRoot),
    source_registry: deriveComponentRoot(paths.sourceRegistryPath, dataRoot),
    preferred_sources: deriveComponentRoot(paths.preferredSourcesPath, dataRoot),
    standard_topic_broker_sources: deriveComponentRoot(paths.standardTopicBrokerSourcesPath, dataRoot),
    spend_guard: deriveComponentRoot(paths.spendGuardStatePath, dataRoot),
    circuit_breaker: deriveComponentRoot(paths.circuitBreakerStatePath, dataRoot),
    logs: logRoots.length === 1 ? logRoots[0] : null,
    scheduler: schedulerRoots.length === 1 ? schedulerRoots[0] : null,
  };
  const divergentComponents = [];

  if (componentRoots.sqlite !== dataRoot) divergentComponents.push("sqlite");
  if (componentRoots.archive !== dataRoot) divergentComponents.push("archive");
  if (componentRoots.digest_records !== dataRoot) divergentComponents.push("digest_records");
  if (componentRoots.digest_retry_state !== dataRoot) divergentComponents.push("digest_retry_state");
  if (componentRoots.domain_stats !== dataRoot) divergentComponents.push("domain_stats");
  if (componentRoots.source_registry !== dataRoot) divergentComponents.push("source_registry");
  if (componentRoots.preferred_sources !== dataRoot) divergentComponents.push("preferred_sources");
  if (componentRoots.standard_topic_broker_sources !== dataRoot) divergentComponents.push("standard_topic_broker_sources");
  if (componentRoots.spend_guard !== dataRoot) divergentComponents.push("spend_guard");
  if (componentRoots.circuit_breaker !== dataRoot) divergentComponents.push("circuit_breaker");
  if (logRoots.length !== 1 || logRoots[0] !== dataRoot) divergentComponents.push("logs");
  if (schedulerRoots.length !== 1 || schedulerRoots[0] !== dataRoot) divergentComponents.push("scheduler");

  return {
    ok: divergentComponents.length === 0,
    data_root: dataRoot,
    component_roots: componentRoots,
    log_roots: logRoots,
    scheduler_roots: schedulerRoots,
    divergent_components: divergentComponents,
    mismatch_flags: {
      sqlite_outside_data_root: componentRoots.sqlite !== dataRoot,
      archive_outside_data_root: componentRoots.archive !== dataRoot,
      digest_records_outside_data_root: componentRoots.digest_records !== dataRoot,
      digest_retry_state_outside_data_root: componentRoots.digest_retry_state !== dataRoot,
      domain_stats_outside_data_root: componentRoots.domain_stats !== dataRoot,
      source_registry_outside_data_root: componentRoots.source_registry !== dataRoot,
      preferred_sources_outside_data_root: componentRoots.preferred_sources !== dataRoot,
      standard_topic_broker_sources_outside_data_root: componentRoots.standard_topic_broker_sources !== dataRoot,
      spend_guard_outside_data_root: componentRoots.spend_guard !== dataRoot,
      circuit_breaker_outside_data_root: componentRoots.circuit_breaker !== dataRoot,
      multiple_log_roots: logRoots.length > 1,
      logs_outside_data_root: logRoots.some((root) => root !== dataRoot),
      multiple_scheduler_roots: schedulerRoots.length > 1,
      scheduler_outside_data_root: schedulerRoots.some((root) => root !== dataRoot),
    },
  };
}

function listRuntimeStateTargets(runtimePaths) {
  const paths = runtimePaths && typeof runtimePaths === "object"
    ? runtimePaths
    : resolveSignalBriefRuntimePaths();
  return [
    { key: "dataDir", path: paths.dataDir, kind: "dir" },
    { key: "sqlitePath", path: paths.sqlitePath, kind: "file" },
    { key: "archiveDir", path: paths.archiveDir, kind: "dir" },
    { key: "digestRecordsDir", path: paths.digestRecordsDir, kind: "dir" },
    { key: "digestRetryStatePath", path: paths.digestRetryStatePath, kind: "file" },
    { key: "costLogPath", path: paths.costLogPath, kind: "file" },
    { key: "engagementEventsPath", path: paths.engagementEventsPath, kind: "file" },
    { key: "adminActionLogPath", path: paths.adminActionLogPath, kind: "file" },
    { key: "adminMessageLogPath", path: paths.adminMessageLogPath, kind: "file" },
    { key: "digestIncidentLogPath", path: paths.digestIncidentLogPath, kind: "file" },
    { key: "archiveLegacyUsageLogPath", path: paths.archiveLegacyUsageLogPath, kind: "file" },
    { key: "schedulerHeartbeatPath", path: paths.schedulerHeartbeatPath, kind: "file" },
    { key: "schedulerControlPath", path: paths.schedulerControlPath, kind: "file" },
    { key: "digestRunLockPath", path: paths.digestRunLockPath, kind: "file" },
    { key: "digestOnDemandCooldownPath", path: paths.digestOnDemandCooldownPath, kind: "file" },
    { key: "domainStatsPath", path: paths.domainStatsPath, kind: "file" },
    { key: "sourceRegistryPath", path: paths.sourceRegistryPath, kind: "file" },
    { key: "preferredSourcesPath", path: paths.preferredSourcesPath, kind: "file" },
    { key: "standardTopicBrokerSourcesPath", path: paths.standardTopicBrokerSourcesPath, kind: "file" },
    { key: "spendGuardStatePath", path: paths.spendGuardStatePath, kind: "file" },
    { key: "circuitBreakerStatePath", path: paths.circuitBreakerStatePath, kind: "file" },
  ];
}

module.exports = {
  APP_ROOT,
  defaultDataDir,
  resolveSignalBriefRuntimePaths,
  describeRuntimePathAlignment,
  listRuntimeStateTargets,
  isWithinPath,
  deriveComponentRoot,
};
