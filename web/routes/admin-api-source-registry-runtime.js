"use strict";

const {
  buildSourceRegistryOverview,
  buildSourceRegistryDomainDetail,
} = require("../services/admin-source-registry-runtime");
const {
  normalizeSourcePolicyDomain,
  clampAuthority,
  sanitizeOriginalityProfile,
  sanitizeReviewStatus,
  sanitizeSourcePolicy,
  sanitizeSourceType,
  sanitizeTierOverride,
  sanitizeTopicFitMap,
} = require("../../src/runtime/source-policy-registry-runtime");

function parseLimitParam(url) {
  const requested = parseInt(url.searchParams.get("limit"), 10);
  if (!Number.isFinite(requested)) return 20;
  return Math.min(100, Math.max(1, requested));
}

function sanitizeBody(body = {}) {
  const domain = normalizeSourcePolicyDomain(body?.domain);
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
  const note = String(body?.note || "").trim();
  return {
    domain,
    source_type: sourceType,
    policy: hardBlock ? "blocked" : policy,
    review_status: reviewStatus,
    topic_fit: topicFit,
    originality_profile: originalityProfile,
    tier_override: tierOverride,
    authority_override: authorityOverride,
    hard_block: hardBlock,
    note,
  };
}

async function handleAdminSourceRegistryRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    getAdminActor,
    requireJsonBody,
    loadSourceRegistry,
    loadPreferredSourceRegistry,
    inspectPreferredSourceRegistry,
    buildSourceRegistryMap,
    setAdminSourceRegistry,
    buildRecentDigestsExport,
    readJsonLineLog,
    ADMIN_ACTION_LOG,
    sourceRegistryPath,
    preferredSourcesPath,
    bundledPreferredSourcesPath,
    upsertSourceRegistryEntry,
    resetSourceRegistryEntry,
    logAdminActionEvent,
  } = deps;

  if (pathname === "/api/admin/source-registry" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const payload = buildSourceRegistryOverview({
      loadSourceRegistry,
      loadPreferredSourceRegistry,
      inspectPreferredSourceRegistry,
      buildSourceRegistryMap,
      setAdminSourceRegistry,
      buildRecentDigestsExport,
      preferredSourcesPath,
      bundledPreferredSourcesPath,
      query: url.searchParams.get("query") || "",
      limit: parseLimitParam(url),
    });
    payload.source_registry_path = sourceRegistryPath || null;
    return json(res, payload);
  }

  if (pathname === "/api/admin/source-registry/domain" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const domain = normalizeSourcePolicyDomain(url.searchParams.get("domain"));
    if (!domain) return json(res, { error: "domain required" }, 400);
    const payload = buildSourceRegistryDomainDetail({
      domain,
      loadSourceRegistry,
      buildSourceRegistryMap,
      setAdminSourceRegistry,
      buildRecentDigestsExport,
      readJsonLineLog,
      adminActionLog: ADMIN_ACTION_LOG,
    });
    return json(res, payload || { error: "domain not found" }, payload ? 200 : 404);
  }

  if (pathname === "/api/admin/source-registry/domain" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const input = sanitizeBody(body);
    if (!input.domain) return json(res, { error: "valid domain required" }, 400);
    try {
      const result = upsertSourceRegistryEntry(input, {
        updated_by: typeof getAdminActor === "function" ? getAdminActor(req) : null,
      });
      if (typeof setAdminSourceRegistry === "function" && typeof buildSourceRegistryMap === "function") {
        setAdminSourceRegistry(buildSourceRegistryMap(result.registry));
      }
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "source_policy_upsert",
          success: true,
          details: {
            domain: input.domain,
            note: input.note,
            before: result.before,
            after: result.after,
          },
        });
      }
      const payload = buildSourceRegistryDomainDetail({
        domain: input.domain,
        loadSourceRegistry: () => result.registry,
        buildSourceRegistryMap,
        setAdminSourceRegistry,
        buildRecentDigestsExport,
        readJsonLineLog,
        adminActionLog: ADMIN_ACTION_LOG,
      });
      return json(res, { success: true, detail: payload });
    } catch (error) {
      return json(res, { error: error?.message || "failed to update source policy" }, 400);
    }
  }

  if (pathname === "/api/admin/source-registry/domain/reset" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const domain = normalizeSourcePolicyDomain(body?.domain);
    if (!domain) return json(res, { error: "valid domain required" }, 400);
    try {
      const result = resetSourceRegistryEntry(domain, {
        updated_by: typeof getAdminActor === "function" ? getAdminActor(req) : null,
      });
      if (typeof setAdminSourceRegistry === "function" && typeof buildSourceRegistryMap === "function") {
        setAdminSourceRegistry(buildSourceRegistryMap(result.registry));
      }
      if (typeof logAdminActionEvent === "function") {
        logAdminActionEvent(req, {
          action: "source_policy_reset",
          success: true,
          details: {
            domain,
            before: result.before,
            after: null,
          },
        });
      }
      const payload = buildSourceRegistryDomainDetail({
        domain,
        loadSourceRegistry: () => result.registry,
        buildSourceRegistryMap,
        setAdminSourceRegistry,
        buildRecentDigestsExport,
        readJsonLineLog,
        adminActionLog: ADMIN_ACTION_LOG,
      });
      return json(res, { success: true, detail: payload });
    } catch (error) {
      return json(res, { error: error?.message || "failed to reset source policy" }, 400);
    }
  }

  return false;
}

module.exports = {
  handleAdminSourceRegistryRoutes,
  parseLimitParam,
  sanitizeBody,
};
