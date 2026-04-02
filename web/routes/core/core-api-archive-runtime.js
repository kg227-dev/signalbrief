const { isDebugWebServerEnabled } = require("../../server-runtime-env-runtime");
const {
  buildDeliveredItemsByDate,
  loadDeliveredSnapshotForDate,
  resolveAllowedArchiveDatesForUser,
  resolveDeliveredDigestItems,
  sortArchiveDatesDescending,
} = require("../../services/archive-digest-stats-runtime");
const { sortDigestItemsByScoreDescending } = require("../../../src/digest/runtime/digest-item-ordering-runtime");

function mapArchiveItem(item, userTopics, archiveRelevanceScore) {
  return {
    tag: item?.tag || "",
    headline: item?.headline || "",
    summary: item?.summary || "",
    wim: item?.wim || null,
    implications: item?.implications || null,
    watch_next: item?.watch_next || null,
    url: item?.url || "",
    source: item?.source || "",
    baseScore: typeof item?.baseScore === "number" ? item.baseScore : null,
    relevanceScore: archiveRelevanceScore(item, userTopics),
  };
}

function buildArchiveDigestFromSnapshot(dateKey, snapshot, userTopics, archiveRelevanceScore) {
  const items = sortDigestItemsByScoreDescending(
    (Array.isArray(snapshot?.items) ? snapshot.items : [])
      .map((item) => mapArchiveItem(item, userTopics, archiveRelevanceScore))
  );
  return {
    date: snapshot?.date_et || dateKey,
    dateStr: snapshot?.date_str || dateKey,
    quickScan: snapshot?.quick_scan || "",
    generatedAt: snapshot?.sent_at || snapshot?.selected_at || null,
    itemCount: items.length,
    items,
  };
}

function resolveArchiveDirFromDeps(deps) {
  const explicit = String(deps?.archiveDir || "").trim();
  if (explicit) return deps.path.resolve(explicit);
  return deps.path.join(deps.APP_ROOT, "archive");
}

function handleArchiveAllRoute(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json,
    findUserByToken,
    readArchiveFiles,
    getAllowedArchiveDates,
    archiveRelevanceScore,
    path,
    fs,
    APP_ROOT,
    archiveDir,
  } = deps;

  if ((pathname !== "/api/archive/all" && pathname !== "/api/archive/all/") || req.method !== "GET") return false;

  const token = url.searchParams.get("token");
  if (!token) {
    json(res, { items: [], requiresAuth: true });
    return true;
  }

  const user = findUserByToken(token);
  if (!user) {
    json(res, { error: "invalid token" }, 401);
    return true;
  }

  const resolvedArchiveDir = resolveArchiveDirFromDeps({ path, APP_ROOT, archiveDir });
  const allowedDates = resolveAllowedArchiveDatesForUser(user, resolvedArchiveDir, deps);
  const allowedDateKeys = sortArchiveDatesDescending(allowedDates);
  const deliveredItemsByDate = buildDeliveredItemsByDate(user, deps);
  if (allowedDateKeys.length === 0) {
    json(res, { items: [], digestCount: 0 });
    return true;
  }

  const userTopics = Array.isArray(user.topics) ? user.topics : [];
  const items = [];
  let digestCount = 0;

  for (const dateKey of allowedDateKeys) {
    try {
      const snapshot = loadDeliveredSnapshotForDate(user, dateKey, deps);
      if (snapshot) {
        const snapshotDigest = buildArchiveDigestFromSnapshot(dateKey, snapshot, userTopics, archiveRelevanceScore);
        if (snapshotDigest.items.length === 0) continue;
        digestCount++;
        snapshotDigest.items.forEach((item, idx) => {
          items.push({
            date: snapshotDigest.date,
            dateStr: snapshotDigest.dateStr,
            generatedAt: snapshotDigest.generatedAt,
            rank: idx + 1,
            ...item,
          });
        });
        continue;
      }
      const digestPath = path.join(resolvedArchiveDir, `${dateKey}.json`);
      if (!fs.existsSync(digestPath)) continue;
      const digest = JSON.parse(fs.readFileSync(digestPath, "utf8"));
      const deliveredDigestItems = sortDigestItemsByScoreDescending(
        resolveDeliveredDigestItems(dateKey, digest.items, deliveredItemsByDate)
          .map(({ item }) => mapArchiveItem(item, userTopics, archiveRelevanceScore))
      );
      if (deliveredDigestItems.length === 0) continue;
      digestCount++;
      deliveredDigestItems.forEach((item, idx) => {
        items.push({
          date: digest.date || dateKey,
          dateStr: digest.dateStr || dateKey,
          generatedAt: digest.generatedAt || null,
          rank: idx + 1,
          ...item,
        });
      });
    } catch (error) {
      if (isDebugWebServerEnabled()) {
        console.warn(`[web] skipping malformed archive file ${dateKey}: ${error.message}`);
      }
    }
  }

  items.sort((a, b) => {
    if (a.date === b.date) return (a.rank || 0) - (b.rank || 0);
    return a.date < b.date ? 1 : -1;
  });

  json(res, { items, digestCount });
  return true;
}

async function handleCoreArchiveRoutes(ctx, deps) {
  if (handleArchiveAllRoute(ctx, deps)) return true;
  return false;
}

module.exports = {
  handleCoreArchiveRoutes,
};
