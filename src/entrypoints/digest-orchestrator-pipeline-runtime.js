"use strict";

const {
  applyStrategicQualityGate,
  buildStorylineCandidates,
  selectDigestItems,
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
      customTags: opts.customTags || [],
      tagPriority: opts.tagPriority,
      maxCustomItems: opts.maxCustomItems,
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
      maxRoutineScore: 0.74,
      minKeep: Math.min(
        Math.max(2, Number(selectionTarget || 3)),
        Math.max(3, storylineCandidates.length)
      ),
    });
    return filtered;
  }

  return {
    selectItems,
    prepareStorylinePool,
  };
}

function resolveDeliveryModeFromTrigger(triggerSource, targetChatId) {
  const source = String(triggerSource || "").trim().toLowerCase();
  if (!targetChatId) return "scheduled";
  if (source.includes("telegram:on_demand")) return "on_demand";
  if (source.includes("signup_welcome")) return "welcome";
  if (source.includes("admin_targeted")) return "manual";
  if (source.includes("admin_full")) return "manual";
  return "manual";
}

function resolveDeliveryEventSource(deliveryMode) {
  if (deliveryMode === "scheduled") return "scheduled-job";
  if (deliveryMode === "on_demand") return "on-demand";
  if (deliveryMode === "welcome") return "welcome-trigger";
  return "manual-rerun";
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
