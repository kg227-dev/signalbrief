function createSchedulerHeartbeatAccessor({ fs, schedulerHeartbeatFile, getSchedulerHeartbeatFile }) {
  const CACHE_TTL_MS = 5000;
  const resolveSchedulerHeartbeatFile = typeof getSchedulerHeartbeatFile === "function"
    ? getSchedulerHeartbeatFile
    : () => schedulerHeartbeatFile;
  const cache = {
    at: 0,
    data: null,
  };

  function readCache(now = Date.now()) {
    const ageMs = Math.max(0, now - Number(cache.at || 0));
    if (!cache.data || ageMs > CACHE_TTL_MS) return null;
    return cache.data;
  }

  function refresh(now = Date.now()) {
    const targetFile = resolveSchedulerHeartbeatFile();
    let data;
    if (!targetFile || !fs.existsSync(targetFile)) {
      data = {
        available: false,
        healthy: false,
        summary: "No heartbeat file",
      };
    } else {
      try {
        const raw = JSON.parse(fs.readFileSync(targetFile, "utf8"));
        const updatedTs = Date.parse(raw?.updated_at || "");
        if (!Number.isFinite(updatedTs)) {
          data = {
            available: true,
            healthy: false,
            summary: "Heartbeat malformed",
          };
        } else {
          const ageMs = Math.max(0, now - updatedTs);
          const pollMs = Math.max(60 * 1000, Number(raw?.poll_ms || 5 * 60 * 1000));
          const staleMs = Math.max(15 * 60 * 1000, pollMs * 3);
          const healthy = ageMs <= staleMs;
          data = {
            available: true,
            healthy,
            pid: raw?.pid || null,
            in_flight: !!raw?.in_flight,
            poll_ms: pollMs,
            worker: raw?.worker || "scheduler-worker",
            updated_at: raw?.updated_at || null,
            age_seconds: Math.round(ageMs / 1000),
            last_run: raw?.last_run || null,
            summary: healthy
              ? `ok · heartbeat ${Math.round(ageMs / 1000)}s ago`
              : `stale · last heartbeat ${Math.round(ageMs / 1000)}s ago`,
          };
        }
      } catch {
        data = {
          available: true,
          healthy: false,
          summary: "Heartbeat unreadable",
        };
      }
    }

    cache.at = now;
    cache.data = data;
    return data;
  }

  function getCachedOrRefresh(now = Date.now()) {
    return readCache(now) || refresh(now);
  }

  return {
    getCachedOrRefresh,
  };
}

module.exports = {
  createSchedulerHeartbeatAccessor,
};
