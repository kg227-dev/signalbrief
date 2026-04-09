"use strict";

const {
  buildSourceRegistryOverview,
  buildSourceRegistryDomainDetail,
} = require("../../services/admin");
const {
  normalizeSourcePolicyDomain,
  normalizeSourceIdentityKey,
  inferSourceDomainFromIdentityKey,
  clampAuthority,
  sanitizeOriginalityProfile,
  sanitizeReviewStatus,
  sanitizeSourcePolicy,
  sanitizeSourceType,
  sanitizeStopNagging,
  sanitizeTierOverride,
  sanitizeTopicFitMap,
} = require("../../../src/runtime/source-policy-registry-runtime");

function parseLimitParam(url) {
  const requested = parseInt(url.searchParams.get("limit"), 10);
  if (!Number.isFinite(requested)) return 20;
  return Math.min(100, Math.max(1, requested));
}

function parseHistoryModeParam(url) {
  const mode = String(url.searchParams.get("history_mode") || "").trim().toLowerCase();
  if (mode === "all_tracked_history") return "all_tracked_history";
  if (mode === "last_24h") return "last_24h";
  if (mode === "rolling_7d") return "rolling_7d";
  if (mode === "validation_week_1") return "validation_week_1";
  return "all_tracked_history";
}

function sanitizeBody(body = {}) {
  const domain = normalizeSourcePolicyDomain(body?.domain);
  const identityKey = normalizeSourceIdentityKey(body?.identity_key);
  const sourceType = sanitizeSourceType(body?.source_type);
  const policy = sanitizeSourcePolicy(body?.policy);
  const reviewStatus = sanitizeReviewStatus(body?.review_status);
  const originalityProfile = sanitizeOriginalityProfile(body?.originality_profile);
  const topicFit = sanitizeTopicFitMap(body?.topic_fit);
  const tierOverride = sanitizeTierOverride(body?.tier_override);
  const authorityOverride = body?.authority_override === "" || body?.authority_override == null
    ? null
    : clampAuthority(body.authority_override);
  const hardBlock = body?.hard_block === true || policy === "blocked";
  const stopNagging = sanitizeStopNagging(body?.stop_nagging) && !hardBlock;
  const note = String(body?.note || "").trim();
  return {
    domain,
    identity_key: identityKey,
    source_type: sourceType,
    policy: hardBlock ? "blocked" : policy,
    review_status: reviewStatus,
    topic_fit: topicFit,
    originality_profile: originalityProfile,
    tier_override: tierOverride,
    authority_override: authorityOverride,
    hard_block: hardBlock,
    stop_nagging: stopNagging,
    note,
  };
}

function sanitizeBrokerTopicBody(body = {}) {
  const topic = String(body?.topic || body?.topic_tag || "").trim().toUpperCase();
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  const publisherFeedEnabled = typeof body?.publisher_feed_enabled === "boolean"
    ? body.publisher_feed_enabled
    : null;
  const officialEnabled = typeof body?.official_enabled === "boolean"
    ? body.official_enabled
    : null;
  return {
    topic,
    enabled,
    publisher_feed_enabled: publisherFeedEnabled,
    official_enabled: officialEnabled,
  };
}

function sanitizeBrokerSourceBody(body = {}) {
  const sourceId = String(body?.source_id || body?.sourceId || "").trim();
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  const tier = body?.tier == null || body.tier === ""
    ? null
    : Number(body.tier);
  return {
    source_id: sourceId,
    enabled,
    tier: Number.isFinite(tier) ? tier : null,
  };
}

function resolveInspectableDomain(domain, identityKey) {
  return normalizeSourcePolicyDomain(domain)
    || inferSourceDomainFromIdentityKey(identityKey)
    || "";
}

async function handleAdminSourceRegistryRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    getAdminActor,
    requireJsonBody,
    loadSourceRegistry,
    inspectStandardTopicBrokerConfig,
    buildSourceRegistryMap,
    setAdminSourceRegistry,
    buildRecentDigestsExport,
    readJsonLineLog,
    ADMIN_ACTION_LOG,
    sourceRegistryPath,
    updateBrokerTopicConfig,
    updateBrokerSourceConfig,
    upsertSourceRegistryEntry,
    resetSourceRegistryEntry,
    resetSourceRegistryIdentityEntry,
    logAdminActionEvent,
  } = deps;

  if (pathname === "/api/admin/source-registry" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const payload = buildSourceRegistryOverview({
      loadSourceRegistry,
      inspectStandardTopicBrokerConfig,
      buildSourceRegistryMap,
      setAdminSourceRegistry,
      buildRecentDigestsExport,
      sourceRegistryPath,
      historyMode: parseHistoryModeParam(url),
      query: url.searchParams.get("query") || "",
      limit: parseLimitParam(url),
    });
    payload.source_registry_path = payload?.governance_registry?.active_path || sourceRegistryPath || null;
    return json(res, payload);
  }

  if (pathname === "/api/admin/source-registry/domain" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const identityKey = normalizeSourceIdentityKey(url.searchParams.get("identity_key"));
    const domain = resolveInspectableDomain(url.searchParams.get("domain"), identityKey);
    if (!domain) return json(res, { error: "domain required" }, 400);
    const payload = buildSourceRegistryDomainDetail({
      domain,
      identityKey,
      loadSourceRegistry,
      buildSourceRegistryMap,
      setAdminSourceRegistry,
      buildRecentDigestsExport,
      readJsonLineLog,
      adminActionLog: ADMIN_ACTION_LOG,
      historyMode: parseHistoryModeParam(url),
    });
    return json(res, payload || { error: "domain not found" }, payload ? 200 : 404);
  }

  if (pathname === "/api/admin/source-registry/domain" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const input = sanitizeBody(body);
    if (!input.domain && !input.identity_key) {
      return json(res, { error: "valid domain or identity_key required" }, 400);
    }
    try {
      const result = upsertSourceRegistryEntry(input, {
        updated_by: typeof getAdminActor === "function" ? getAdminActor(req) : null,
      });
      const detailDomain = resolveInspectableDomain(input.domain, input.identity_key);
      if (typeof setAdminSourceRegistry === "function" && typeof buildSourceRegistryMap === "function") {
        setAdminSourceRegistry(buildSourceRegistryMap(result.registry));
      }
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "source_policy_upsert",
          success: true,
          details: {
            domain: detailDomain || input.domain || null,
            identity_key: input.identity_key || null,
            note: input.note,
            before: result.before,
            after: result.after,
          },
        });
      }
      const payload = detailDomain
        ? buildSourceRegistryDomainDetail({
          domain: detailDomain,
          identityKey: input.identity_key || null,
          loadSourceRegistry: () => result.registry,
          buildSourceRegistryMap,
          setAdminSourceRegistry,
          buildRecentDigestsExport,
          readJsonLineLog,
          adminActionLog: ADMIN_ACTION_LOG,
        })
        : null;
      return json(res, { success: true, detail: payload });
    } catch (error) {
      return json(res, { error: error?.message || "failed to update source policy" }, 400);
    }
  }

  if (pathname === "/api/admin/source-registry/domain/reset" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const identityKey = normalizeSourceIdentityKey(body?.identity_key);
    const domain = resolveInspectableDomain(body?.domain, identityKey);
    if (!domain && !identityKey) return json(res, { error: "valid domain or identity_key required" }, 400);
    try {
      const result = identityKey
        ? resetSourceRegistryIdentityEntry(identityKey, {
          updated_by: typeof getAdminActor === "function" ? getAdminActor(req) : null,
        })
        : resetSourceRegistryEntry(domain, {
          updated_by: typeof getAdminActor === "function" ? getAdminActor(req) : null,
        });
      const detailDomain = resolveInspectableDomain(domain, identityKey);
      if (typeof setAdminSourceRegistry === "function" && typeof buildSourceRegistryMap === "function") {
        setAdminSourceRegistry(buildSourceRegistryMap(result.registry));
      }
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "source_policy_reset",
          success: true,
          details: {
            domain: detailDomain || domain || null,
            identity_key: identityKey || null,
            before: result.before,
            after: null,
          },
        });
      }
      const payload = detailDomain
        ? buildSourceRegistryDomainDetail({
          domain: detailDomain,
          identityKey: identityKey || null,
          loadSourceRegistry: () => result.registry,
          buildSourceRegistryMap,
          setAdminSourceRegistry,
          buildRecentDigestsExport,
          readJsonLineLog,
          adminActionLog: ADMIN_ACTION_LOG,
        })
        : null;
      return json(res, { success: true, detail: payload });
    } catch (error) {
      return json(res, { error: error?.message || "failed to reset source policy" }, 400);
    }
  }

  if (pathname === "/api/admin/source-registry/broker/topic" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const input = sanitizeBrokerTopicBody(body);
    if (!input.topic) return json(res, { error: "valid topic required" }, 400);
    if (input.enabled == null && input.publisher_feed_enabled == null && input.official_enabled == null) {
      return json(res, { error: "at least one topic control is required" }, 400);
    }
    try {
      const result = updateBrokerTopicConfig(input);
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "broker_topic_update",
          success: true,
          details: {
            topic: input.topic,
            before: result.before,
            after: result.after,
          },
        });
      }
      return json(res, {
        success: true,
        topic: input.topic,
        before: result.before,
        after: result.after,
        broker_config: result.snapshot,
      });
    } catch (error) {
      return json(res, { error: error?.message || "failed to update broker topic" }, 400);
    }
  }

  if (pathname === "/api/admin/source-registry/broker/source" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const input = sanitizeBrokerSourceBody(body);
    if (!input.source_id) return json(res, { error: "valid source_id required" }, 400);
    if (input.enabled == null && input.tier == null) {
      return json(res, { error: "enabled or tier update required" }, 400);
    }
    try {
      const result = updateBrokerSourceConfig(input);
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "broker_source_update",
          success: true,
          details: {
            source_id: input.source_id,
            before: result.before,
            after: result.after,
          },
        });
      }
      return json(res, {
        success: true,
        source_id: input.source_id,
        before: result.before,
        after: result.after,
        broker_config: result.snapshot,
      });
    } catch (error) {
      return json(res, { error: error?.message || "failed to update broker source" }, 400);
    }
  }

  return false;
}

module.exports = {
  handleAdminSourceRegistryRoutes,
  parseLimitParam,
  sanitizeBody,
  sanitizeBrokerTopicBody,
  sanitizeBrokerSourceBody,
};
