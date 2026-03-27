"use strict";

const {
  applyStrategicQualityGate,
  buildStorylineCandidates,
  selectDigestItems,
  selectDigestItemsDetailed,
} = require("../domains/digest");

function createDigestOrchestratorPipelineRuntime(deps) {
  const {
    normalizeUrlForDedup,
    parseSourceDomain,
    normalizeTopicToken,
    getConfig,
  } = deps;

  function selectItems(allItems, opts = {}) {
    const CONFIG = getConfig();
    return selectDigestItems(allItems, {
      maxItems: opts.maxItems || CONFIG.digest.itemCount || 7,
      maxItemsPerTag: opts.maxItemsPerTag || CONFIG.digest.maxItemsPerTag || 2,
      maxItemsPerSourceDomain: opts.maxItemsPerSourceDomain || CONFIG.digest.maxItemsPerSourceDomain || 2,
      tagPriority: opts.tagPriority,
      normalizeUrl: normalizeUrlForDedup,
      parseDomain: parseSourceDomain,
      normalizeTopicToken,
      isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
    });
  }

  function selectItemsDetailed(allItems, opts = {}) {
    const CONFIG = getConfig();
    return selectDigestItemsDetailed(allItems, {
      maxItems: opts.maxItems || CONFIG.digest.itemCount || 7,
      maxItemsPerTag: opts.maxItemsPerTag || CONFIG.digest.maxItemsPerTag || 2,
      maxItemsPerSourceDomain: opts.maxItemsPerSourceDomain || CONFIG.digest.maxItemsPerSourceDomain || 2,
      tagPriority: opts.tagPriority,
      normalizeUrl: normalizeUrlForDedup,
      parseDomain: parseSourceDomain,
      normalizeTopicToken,
      isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
    });
  }

  function prepareStorylinePool(enrichedItems, selectionTarget) {
    const storylineCandidates = buildStorylineCandidates(enrichedItems);
    const filtered = applyStrategicQualityGate(storylineCandidates, {
      minStrategicValue: 0.34,
      maxRoutineScore: 0.65,
      minKeep: Math.min(
        Math.max(2, Number(selectionTarget || 3)),
        Math.max(3, storylineCandidates.length)
      ),
    });
    return filtered;
  }

  return {
    selectItems,
    selectItemsDetailed,
    prepareStorylinePool,
  };
}

function resolveDeliveryModeFromTrigger(triggerSource) {
  const source = String(triggerSource || "").trim().toLowerCase();
  if (source.includes("signup_welcome")) return "welcome";
  return "scheduled";
}

function resolveDeliveryEventSource(deliveryMode) {
  if (deliveryMode === "welcome") return "welcome-trigger";
  return "scheduled-job";
}

function filterAlreadySentScheduledDueUsers(dueUsers, digestDateKey, digestDeliveryRecordRuntime) {
  const rows = Array.isArray(dueUsers) ? dueUsers.slice() : [];
  const dateKey = String(digestDateKey || "").trim();
  if (!rows.length || !dateKey || !digestDeliveryRecordRuntime || typeof digestDeliveryRecordRuntime.hasSentDigestRecord !== "function") {
    return {
      dueUsers: rows,
      skippedUsers: [],
    };
  }

  const eligible = [];
  const skipped = [];
  for (const user of rows) {
    const userId = String(user?.chatId || user?.email || "").trim();
    if (!userId) {
      eligible.push(user);
      continue;
    }
    if (digestDeliveryRecordRuntime.hasSentDigestRecord(userId, dateKey, "scheduled")) {
      skipped.push(user);
      continue;
    }
    eligible.push(user);
  }

  return {
    dueUsers: eligible,
    skippedUsers: skipped,
  };
}

module.exports = {
  createDigestOrchestratorPipelineRuntime,
  resolveDeliveryModeFromTrigger,
  resolveDeliveryEventSource,
  filterAlreadySentScheduledDueUsers,
};
