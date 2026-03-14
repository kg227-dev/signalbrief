"use strict";

function sortArchiveDatesDescending(values) {
  return Array.from(new Set(
    Array.from(values || [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  )).sort((a, b) => (a < b ? 1 : -1));
}

function normalizeArchiveLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function loadDeliveredSnapshotForDate(user, dateKey, deps) {
  const { loadLatestDigestSnapshot } = deps;
  if (typeof loadLatestDigestSnapshot !== "function") return null;
  const userId = String(user?.chatId || "").trim();
  const key = String(dateKey || "").trim();
  if (!userId || !key) return null;
  const snapshot = loadLatestDigestSnapshot(userId, key);
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) return null;
  return snapshot;
}

function buildDeliveredItemsByDate(user, deps) {
  const { loadEngagementEvents } = deps;
  if (typeof loadEngagementEvents !== "function") return new Map();

  const chatId = String(user?.chatId || "").trim();
  if (!chatId) return new Map();

  const events = loadEngagementEvents({ max_age_days: 120, dedupe: true });
  const bestByDate = new Map();

  for (const event of (Array.isArray(events) ? events : [])) {
    if (String(event?.event_type || "") !== "digest_sent") continue;
    if (String(event?.user_chat_id || "").trim() !== chatId) continue;

    const dateKey = String(event?.date_et || String(event?.digest_id || "").split(":")[0] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const items = Array.isArray(event?.metadata?.items) ? event.metadata.items : [];
    if (items.length === 0) continue;

    const current = bestByDate.get(dateKey);
    const currentCount = Array.isArray(current?.items) ? current.items.length : 0;
    const candidateTs = Date.parse(String(event?.ts_utc || ""));
    const currentTs = Number(current?.ts_ms || 0);
    const shouldReplace = !current
      || items.length > currentCount
      || (items.length === currentCount && Number.isFinite(candidateTs) && candidateTs > currentTs);

    if (shouldReplace) {
      bestByDate.set(dateKey, {
        items,
        ts_ms: Number.isFinite(candidateTs) ? candidateTs : 0,
      });
    }
  }

  return new Map(Array.from(bestByDate.entries()).map(([dateKey, value]) => [dateKey, value.items]));
}

function resolveDeliveredDigestItems(dateKey, digestItems, deliveredItemsByDate) {
  const rawItems = Array.isArray(digestItems) ? digestItems : [];
  const deliveredRefs = deliveredItemsByDate instanceof Map ? deliveredItemsByDate.get(dateKey) : null;
  if (!Array.isArray(deliveredRefs) || deliveredRefs.length === 0) {
    return rawItems.map((item, idx) => ({ rank: idx + 1, item }));
  }

  const byUrl = new Map();
  const byHeadlineTag = new Map();
  rawItems.forEach((item, idx) => {
    const urlKey = normalizeArchiveLookupKey(item?.url);
    if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, { rank: idx + 1, item });

    const headlineKey = normalizeArchiveLookupKey(item?.headline);
    const tagKey = normalizeArchiveLookupKey(item?.tag);
    const compositeKey = `${headlineKey}::${tagKey}`;
    if (headlineKey && !byHeadlineTag.has(compositeKey)) {
      byHeadlineTag.set(compositeKey, { rank: idx + 1, item });
    }
  });

  return deliveredRefs
    .map((ref, idx) => {
      const urlKey = normalizeArchiveLookupKey(ref?.url);
      const headlineKey = normalizeArchiveLookupKey(ref?.headline);
      const tagKey = normalizeArchiveLookupKey(ref?.tag);
      const compositeKey = `${headlineKey}::${tagKey}`;
      const matched = (urlKey && byUrl.get(urlKey)) || (headlineKey && byHeadlineTag.get(compositeKey)) || null;
      if (matched) return { rank: Number(ref?.index || idx + 1), item: matched.item };
      return {
        rank: Number(ref?.index || idx + 1),
        item: {
          tag: ref?.tag || "",
          headline: ref?.headline || "",
          summary: "",
          wim: null,
          implications: null,
          watch_next: null,
          url: ref?.url || "",
          source: "",
          baseScore: Number.isFinite(Number(ref?.base_score)) ? Number(ref.base_score) : null,
        },
      };
    })
    .filter((entry) => entry && entry.item);
}

function resolveAllowedArchiveDatesForUser(user, archiveDir, deps) {
  const {
    getAllowedArchiveDates,
    readArchiveFiles,
  } = deps;

  const preferred = getAllowedArchiveDates(user, archiveDir, []);
  if (preferred.size > 0) return preferred;
  if (Number(user?.digests_received || 0) <= 0) return preferred;

  const files = readArchiveFiles(archiveDir);
  if (!Array.isArray(files) || files.length === 0) return preferred;
  const bounded = files.slice(0, Math.max(7, Math.min(files.length, Number(user?.digests_received || 0))));
  return getAllowedArchiveDates(user, archiveDir, bounded);
}

function createArchiveDigestStatsRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
  } = deps;

  function countArchiveDigestsForUser(user) {
    if (!user || !APP_ROOT || !fs || !path) return Math.max(0, Number(user?.digests_received || 0));

    const archiveDir = path.join(APP_ROOT, "archive");
    const allowedDates = resolveAllowedArchiveDatesForUser(user, archiveDir, deps);
    const allowedDateKeys = sortArchiveDatesDescending(allowedDates);
    if (allowedDateKeys.length === 0) return 0;

    const deliveredItemsByDate = buildDeliveredItemsByDate(user, deps);
    let digestCount = 0;

    for (const dateKey of allowedDateKeys) {
      try {
        const snapshot = loadDeliveredSnapshotForDate(user, dateKey, deps);
        if (snapshot) {
          digestCount += 1;
          continue;
        }

        const digestPath = path.join(archiveDir, `${dateKey}.json`);
        if (!fs.existsSync(digestPath)) continue;
        const digest = JSON.parse(fs.readFileSync(digestPath, "utf8"));
        const deliveredDigestItems = resolveDeliveredDigestItems(dateKey, digest.items, deliveredItemsByDate);
        if (deliveredDigestItems.length === 0) continue;
        digestCount += 1;
      } catch {
        continue;
      }
    }

    return digestCount;
  }

  return {
    countArchiveDigestsForUser,
  };
}

module.exports = {
  buildDeliveredItemsByDate,
  createArchiveDigestStatsRuntime,
  loadDeliveredSnapshotForDate,
  normalizeArchiveLookupKey,
  resolveAllowedArchiveDatesForUser,
  resolveDeliveredDigestItems,
  sortArchiveDatesDescending,
};
