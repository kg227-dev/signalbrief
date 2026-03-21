"use strict";

const {
  describeRuntimePathAlignment,
  listRuntimeStateTargets,
} = require("../../src/runtime/runtime-state-paths-runtime");

function safeStat(fs, targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function summarizeTarget(fs, target) {
  const filePath = String(target?.path || "").trim();
  const kind = String(target?.kind || "file").trim() || "file";
  const stat = filePath ? safeStat(fs, filePath) : null;
  const exists = !!stat;
  let entryCount = null;

  if (exists && kind === "dir") {
    try {
      entryCount = fs.readdirSync(filePath).length;
    } catch {
      entryCount = null;
    }
  }

  return {
    path: filePath,
    kind,
    exists,
    is_file: !!stat?.isFile?.(),
    is_dir: !!stat?.isDirectory?.(),
    size_bytes: exists && kind !== "dir" ? Number(stat.size || 0) : null,
    entry_count: entryCount,
    mtime_utc: exists && stat?.mtime ? stat.mtime.toISOString() : null,
  };
}

function resolveGitSha({ childProcess, cwd }) {
  try {
    const result = childProcess.spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (Number(result?.status || 0) !== 0) return null;
    const sha = String(result?.stdout || "").trim();
    return sha || null;
  } catch {
    return null;
  }
}

function buildLatestCostRun(loadCostRunsNewest) {
  if (typeof loadCostRunsNewest !== "function") return null;
  const run = (loadCostRunsNewest() || [])[0];
  if (!run || typeof run !== "object") return null;
  return {
    ts_utc: String(run.run_at || "").trim() || null,
    date_et: String(run.date || "").trim() || null,
    run_id: String(run.run_id || "").trim() || null,
    users_served: Number.isFinite(Number(run.users_served)) ? Number(run.users_served) : null,
  };
}

function buildLatestEngagementEvent(loadEngagementEvents) {
  if (typeof loadEngagementEvents !== "function") return null;
  const events = loadEngagementEvents({
    max_age_days: 3650,
    dedupe: false,
    capture_parse_error_lines: false,
  });
  let latest = null;
  for (const event of (Array.isArray(events) ? events : [])) {
    const ts = String(event?.ts_utc || "").trim();
    if (!ts) continue;
    if (!latest || ts > latest.ts_utc) {
      latest = {
        ts_utc: ts,
        event_type: String(event?.event_type || "").trim() || null,
        digest_id: String(event?.digest_id || "").trim() || null,
        run_id: String(event?.run_id || "").trim() || null,
      };
    }
  }
  return latest;
}

function buildDeliveryRecordSummary(digestDeliveryRecordRuntime) {
  if (!digestDeliveryRecordRuntime || typeof digestDeliveryRecordRuntime.summarizeRecordsState !== "function") {
    return null;
  }
  const summary = digestDeliveryRecordRuntime.summarizeRecordsState();
  return summary && typeof summary === "object" ? summary : null;
}

function createRuntimeStateInspector(deps) {
  const {
    fs,
    childProcess,
    os,
    processRef,
    runtimePaths,
    store,
    loadCostRunsNewest,
    loadEngagementEvents,
    digestDeliveryRecordRuntime,
  } = deps;
  let cachedGitSha;

  function getRuntimeStateDiagnostics() {
    const alignment = describeRuntimePathAlignment(runtimePaths);
    const targets = listRuntimeStateTargets(runtimePaths);
    const files = {};
    for (const target of targets) {
      files[target.key] = summarizeTarget(fs, target);
    }

    const storeSnapshot = store && typeof store.getStateSnapshot === "function"
      ? store.getStateSnapshot()
      : {};
    const latestCostRun = buildLatestCostRun(loadCostRunsNewest);
    const latestEngagementEvent = buildLatestEngagementEvent(loadEngagementEvents);
    const deliveryRecords = buildDeliveryRecordSummary(digestDeliveryRecordRuntime);

    return {
      ok: alignment.ok,
      status: alignment.ok ? "ok" : "mismatch",
      generated_at: new Date().toISOString(),
      runtime: {
        cwd: processRef.cwd(),
        host: os.hostname(),
        pid: processRef.pid,
        node_env: String(processRef.env.NODE_ENV || "").trim() || null,
        git_sha: cachedGitSha !== undefined
          ? cachedGitSha
          : (cachedGitSha = resolveGitSha({ childProcess, cwd: runtimePaths.appRoot })),
      },
      store: {
        backend: String(storeSnapshot.backend || "").trim() || null,
        data_dir: String(storeSnapshot.dataDir || runtimePaths.dataDir).trim(),
        sqlite_path: String(storeSnapshot.sqlitePath || runtimePaths.sqlitePath).trim() || null,
        initialized: storeSnapshot.initialized === true,
      },
      paths: {
        dataDir: runtimePaths.dataDir,
        sqlitePath: runtimePaths.sqlitePath,
        archiveDir: runtimePaths.archiveDir,
        digestRecordsDir: runtimePaths.digestRecordsDir,
        costLogPath: runtimePaths.costLogPath,
        engagementEventsPath: runtimePaths.engagementEventsPath,
        adminActionLogPath: runtimePaths.adminActionLogPath,
        adminMessageLogPath: runtimePaths.adminMessageLogPath,
        digestIncidentLogPath: runtimePaths.digestIncidentLogPath,
        archiveLegacyUsageLogPath: runtimePaths.archiveLegacyUsageLogPath,
        schedulerHeartbeatPath: runtimePaths.schedulerHeartbeatPath,
        schedulerControlPath: runtimePaths.schedulerControlPath,
        digestRunLockPath: runtimePaths.digestRunLockPath,
        digestOnDemandCooldownPath: runtimePaths.digestOnDemandCooldownPath,
        domainStatsPath: runtimePaths.domainStatsPath,
        sourceRegistryPath: runtimePaths.sourceRegistryPath,
      },
      files,
      latest: {
        cost_run: latestCostRun,
        engagement_event: latestEngagementEvent,
        delivery_record: deliveryRecords,
      },
      latest_timestamps: {
        cost_log: latestCostRun?.ts_utc || null,
        engagement_event: latestEngagementEvent?.ts_utc || null,
        delivery_record: deliveryRecords?.latest_timestamp || null,
      },
      roots: alignment,
      mismatch_flags: alignment.mismatch_flags,
    };
  }

  function getRuntimeStateHealth() {
    const diagnostics = getRuntimeStateDiagnostics();
    const divergent = Array.isArray(diagnostics?.roots?.divergent_components)
      ? diagnostics.roots.divergent_components
      : [];
    return {
      ok: diagnostics?.ok === true,
      status: diagnostics?.ok === true ? "ok" : "mismatch",
      reason: diagnostics?.ok === true
        ? "runtime state paths aligned"
        : `divergent runtime roots: ${divergent.join(", ") || "unknown"}`,
      divergent_components: divergent,
      store_backend: String(diagnostics?.store?.backend || "").trim() || null,
      store_sqlite_path: String(diagnostics?.store?.sqlite_path || "").trim() || null,
      mismatch_flags: diagnostics?.mismatch_flags || {},
      component_roots: diagnostics?.roots?.component_roots || {},
    };
  }

  return {
    getRuntimeStateDiagnostics,
    getRuntimeStateHealth,
  };
}

module.exports = {
  createRuntimeStateInspector,
  summarizeTarget,
  resolveGitSha,
};
