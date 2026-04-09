"use strict";

const {
  STAGES,
  normalizeLane,
  normalizeCanonicalUrl,
  normalizeDomain,
  normalizeReason,
  computeDropPct,
  computeConversionRate,
} = require("./admin-api-funnel-shared");
const {
  buildDatesResponse,
  buildSourceRegistry,
  buildSummaryFromAuditDocs,
  expandDateRange,
  listAuditDates,
  readAuditFile,
} = require("./admin-api-funnel-data-runtime");

function buildItemFromDropRecord(record) {
  return {
    url: normalizeCanonicalUrl(String(record?.url || "")),
    title: String(record?.title || ""),
    domain: normalizeDomain(String(record?.domain || "")),
    lane: normalizeLane(String(record?.lane || "broker")),
    published_at: record?.published_at || null,
    status: "dropped",
    reason: normalizeReason(String(record?.reason || "")),
    strategic_relevance: record?.strategic_relevance || null,
    strategic_relevance_reason: record?.strategic_relevance_reason
      ? String(record.strategic_relevance_reason).slice(0, 120)
      : null,
    score: null,
    score_components: null,
    duplicate_of: record?.duplicate_of ? normalizeCanonicalUrl(String(record.duplicate_of)) : null,
    enrichment_status: null,
    freshness_bucket: record?.freshness_bucket || null,
  };
}

function buildItemFromCandidate(candidate) {
  const isSelected = candidate?.selected === true;
  const hasReason = Boolean(candidate?.selection_reason);
  const status = isSelected ? "selected" : hasReason ? "dropped" : "passed";
  return {
    url: normalizeCanonicalUrl(String(candidate?.url || "")),
    title: String(candidate?.headline || ""),
    domain: normalizeDomain(String(candidate?.source_domain || candidate?.source || "")),
    lane: normalizeLane(String(candidate?.lane || "")),
    published_at: candidate?.published_at || null,
    status,
    reason: status === "dropped" ? normalizeReason(String(candidate?.selection_reason || "")) : null,
    strategic_relevance: candidate?.strategic_relevance || null,
    strategic_relevance_reason: candidate?.strategic_relevance_reason || null,
    score: Number.isFinite(Number(candidate?._score)) ? Number(Number(candidate._score).toFixed(3)) : null,
    score_components: candidate?._score_components || null,
    duplicate_of: candidate?.duplicate_of ? normalizeCanonicalUrl(String(candidate.duplicate_of)) : null,
    enrichment_status: candidate?.enrichment_status || (isSelected ? (candidate?.writeup_status || null) : null),
  };
}

function buildTopicResponse(auditDoc, topicTag) {
  const tag = String(topicTag || "").trim().toUpperCase();
  const topicData = auditDoc?.topics?.[tag];
  if (!topicData) return null;

  const fetchDiag = Array.isArray(auditDoc?.fetch?.topic_diagnostics)
    ? auditDoc.fetch.topic_diagnostics.find((t) => t?.tag === tag) : null;

  const fetchedForTopic = fetchDiag
    ? Number(fetchDiag.broker_item_count || 0) + Number(fetchDiag.discovery_item_count || 0)
    : Number(topicData?.total_candidates || 0);

  const candidates = Array.isArray(topicData?.candidates) ? topicData.candidates : [];
  const scoredCount = candidates.length; // items that passed classifier and entered scoring

  const finalSelected = Number(topicData?.selected_count || 0);
  const enrichmentFailed = candidates.filter((c) => c?.selected && c?.writeup_status === "failed").length;
  const enrichmentOut = Math.max(0, finalSelected - enrichmentFailed);

  // Fetch lane breakdown
  const fetchBreakdown = fetchDiag
    ? { broker: Number(fetchDiag.broker_item_count || 0), discovery: Number(fetchDiag.discovery_item_count || 0) }
    : null;

  // Classifier visibility — distribution among items that reached scoring
  const classifierBreakdown = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const c of candidates) {
    const rel = String(c?.strategic_relevance || "").toUpperCase();
    if      (rel === "HIGH")                    classifierBreakdown.high++;
    else if (rel === "MEDIUM" || rel === "MED") classifierBreakdown.medium++;
    else if (rel === "LOW")                     classifierBreakdown.low++;
    else                                        classifierBreakdown.unknown++;
  }

  // All drop arrays carry a topic field (set during fetch/preparation).
  // Filter per-topic; if topic field absent, include the record (conservative).
  function getTopicTaggedDrops(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.filter((r) => !r?.topic || String(r.topic).toUpperCase() === tag);
  }

  const editorialDropItems    = getTopicTaggedDrops(auditDoc?.selectionDiagnostics?.editorial_dropped_items);
  const archiveDedupDropItems = getTopicTaggedDrops(auditDoc?.selectionDiagnostics?.archive_dedup_dropped_items);
  const freshnessDropItems    = getTopicTaggedDrops(auditDoc?.selectionDiagnostics?.freshness_dropped_items);
  const storyDedupDropItems   = getTopicTaggedDrops(auditDoc?.selectionDiagnostics?.story_dedup_dropped_items);
  const classifierDropItems   = getTopicTaggedDrops(auditDoc?.selectionDiagnostics?.classifier_dropped_items);

  // Build stage chain — each stage's out feeds the next stage's in.
  // When a drop array is available, use its length for that stage's dropped count.
  // Stages without drop arrays pass through (0 dropped) so the classifier row
  // absorbs any remaining un-attributed gap between story_dedup.out and scoredCount.
  const chain = {};

  const hasBrokerFetchItems = Array.isArray(auditDoc?.fetch?.broker_fetch_items) && auditDoc.fetch.broker_fetch_items.length > 0;
  const hasDiscoveryFetchItems = Array.isArray(auditDoc?.fetch?.discovery_fetch_items) && auditDoc.fetch.discovery_fetch_items.length > 0;
  chain.fetch = {
    in: fetchedForTopic,
    out: fetchedForTopic,
    dropped: 0,
    instrumented: hasBrokerFetchItems || hasDiscoveryFetchItems,
  };

  const editDropCount = editorialDropItems ? editorialDropItems.length : 0;
  chain.editorial_filter = {
    in: chain.fetch.out,
    out: Math.max(0, chain.fetch.out - editDropCount),
    dropped: editDropCount,
    instrumented: editorialDropItems !== null,
  };

  const archDropCount = archiveDedupDropItems ? archiveDedupDropItems.length : 0;
  chain.archive_dedup = {
    in: chain.editorial_filter.out,
    out: Math.max(0, chain.editorial_filter.out - archDropCount),
    dropped: archDropCount,
    instrumented: archiveDedupDropItems !== null,
  };

  const freshDropCount = freshnessDropItems ? freshnessDropItems.length : 0;
  chain.freshness_filter = {
    in: chain.archive_dedup.out,
    out: Math.max(0, chain.archive_dedup.out - freshDropCount),
    dropped: freshDropCount,
    instrumented: freshnessDropItems !== null,
  };

  const storyDropCount = storyDedupDropItems ? storyDedupDropItems.length : 0;
  chain.story_dedup = {
    in: chain.freshness_filter.out,
    out: Math.max(0, chain.freshness_filter.out - storyDropCount),
    dropped: storyDropCount,
    instrumented: storyDedupDropItems !== null,
  };

  // classifier: in = story_dedup.out when no classifier drop array (absorbs un-attributed gaps),
  // or = scoredCount + classifierDropItems.length when fully instrumented.
  const classifierIn = classifierDropItems !== null
    ? scoredCount + classifierDropItems.length
    : chain.story_dedup.out;
  chain.classifier = {
    in: classifierIn,
    out: scoredCount,
    dropped: classifierDropItems !== null ? classifierDropItems.length : Math.max(0, chain.story_dedup.out - scoredCount),
    instrumented: classifierDropItems !== null,
  };

  // scoring: passthrough (all items that reach scoring pass through to final_selection)
  chain.scoring = {
    in: scoredCount,
    out: scoredCount,
    dropped: 0,
    instrumented: true,
  };

  chain.final_selection = {
    in: scoredCount,
    out: finalSelected,
    dropped: Math.max(0, scoredCount - finalSelected),
    instrumented: true,
  };

  chain.enrichment = {
    in: finalSelected,
    out: enrichmentOut,
    dropped: enrichmentFailed,
    instrumented: Array.isArray(auditDoc?.enrichmentDiagnostics?.item_outcomes),
  };

  const finalItems = candidates.map((c) => buildItemFromCandidate(c));

  // LOW-scored items: candidates that reached scoring but were rated LOW relevance.
  // These are available for classifier-stage item visibility.
  const lowScoredItems = candidates
    .filter((c) => String(c?.strategic_relevance || "").toUpperCase() === "LOW")
    .map((c) => buildItemFromCandidate(c));

  const stages = STAGES.map((stageDef) => {
    const counts = chain[stageDef.key] || { in: 0, out: 0, dropped: 0, instrumented: false };
    let items = [];
    let globalItems = false; // flag: items are from global pool, not topic-specific

    if (stageDef.key === "fetch") {
      function mapFetchItem(i, defaultLane) {
        return {
          url: normalizeCanonicalUrl(String(i?.url || "")),
          title: String(i?.title || ""),
          domain: normalizeDomain(String(i?.domain || "")),
          lane: normalizeLane(String(i?.lane || defaultLane)),
          published_at: i?.published_at || null,
          status: "passed",
          reason: null,
          strategic_relevance: null,
          strategic_relevance_reason: null,
          score: null,
          score_components: null,
          duplicate_of: null,
          enrichment_status: null,
        };
      }
      const discoveryItems = Array.isArray(auditDoc?.fetch?.discovery_fetch_items)
        ? auditDoc.fetch.discovery_fetch_items.filter((i) => !i?.topic || String(i.topic).toUpperCase() === tag)
        : [];
      const brokerItems = Array.isArray(auditDoc?.fetch?.broker_fetch_items)
        ? auditDoc.fetch.broker_fetch_items.filter((i) => !i?.topic || String(i.topic).toUpperCase() === tag)
        : [];
      items = [
        ...brokerItems.map((i) => mapFetchItem(i, "broker")),
        ...discoveryItems.map((i) => mapFetchItem(i, "discovery")),
      ];
    } else if (stageDef.key === "editorial_filter" && editorialDropItems) {
      items = editorialDropItems.map(buildItemFromDropRecord);
    } else if (stageDef.key === "archive_dedup" && archiveDedupDropItems) {
      items = archiveDedupDropItems.map(buildItemFromDropRecord);
    } else if (stageDef.key === "freshness_filter" && freshnessDropItems) {
      items = freshnessDropItems.map(buildItemFromDropRecord);
    } else if (stageDef.key === "story_dedup" && storyDedupDropItems) {
      items = storyDedupDropItems.map(buildItemFromDropRecord);
    } else if (stageDef.key === "classifier") {
      if (classifierDropItems) {
        // True classifier-rejected items (LOW relevance, filtered before scoring)
        items = classifierDropItems.map(buildItemFromDropRecord);
      } else {
        // Fallback: show LOW-scored items from candidates as a proxy
        items = lowScoredItems;
      }
    } else if (stageDef.key === "final_selection") {
      items = finalItems;
    } else if (stageDef.key === "enrichment") {
      const outcomes = Array.isArray(auditDoc?.enrichmentDiagnostics?.item_outcomes)
        ? auditDoc.enrichmentDiagnostics.item_outcomes : null;
      if (outcomes) {
        items = candidates
          .filter((c) => c?.selected === true)
          .map((c) => {
            const outcome = outcomes.find((o) =>
              o.url === c.url ||
              normalizeCanonicalUrl(String(o?.url || "")) === normalizeCanonicalUrl(String(c.url || ""))
            );
            return {
              ...buildItemFromCandidate(c),
              enrichment_status: outcome?.enrichment_status || "success",
              failure_reason: outcome?.failure_reason || null,
            };
          });
      }
    }

    return {
      stage: stageDef.key,
      label: stageDef.label,
      in: counts.in,
      out: counts.out,
      dropped: counts.dropped,
      drop_pct: computeDropPct(counts.dropped, counts.in),
      instrumented: counts.instrumented,
      global_items: globalItems,
      items,
    };
  });

  // Stage consistency check — validates out[n] == in[n+1] across the full chain.
  // The story_dedup→classifier boundary may have a gap when classifier is fully instrumented
  // (classifier.in = scoredCount + dropped, not story_dedup.out). Skip that one boundary.
  let integrityWarning = null;
  for (let i = 0; i < stages.length - 1; i++) {
    const curr = stages[i];
    const next = stages[i + 1];
    // Allow gap at story_dedup→classifier when classifier is fully instrumented
    if (curr.stage === "story_dedup" && next.stage === "classifier" && next.instrumented) continue;
    if (curr.out !== next.in) {
      integrityWarning = `Count mismatch: ${curr.stage}.out (${curr.out}) ≠ ${next.stage}.in (${next.in})`;
      break;
    }
  }

  // Final selection uniqueness check
  const selectedUrls = finalItems.filter((i) => i.status === "selected").map((i) => i.url);
  const uniqueSelected = new Set(selectedUrls);
  if (uniqueSelected.size < selectedUrls.length && !integrityWarning) {
    integrityWarning = "Duplicate canonical_url in final selection — dedup failure detected";
  }

  // Source domain aggregation
  const domainMap = Object.create(null);
  for (const c of candidates) {
    const domain = normalizeDomain(String(c?.source_domain || c?.source || ""));
    if (!domain) continue;
    if (!domainMap[domain]) domainMap[domain] = { domain, fetched: 0, survived_to_scoring: 0, selected: 0 };
    domainMap[domain].fetched++;
    domainMap[domain].survived_to_scoring++;
    if (c?.selected === true) domainMap[domain].selected++;
  }
  const sourceDomains = Object.values(domainMap)
    .map((d) => ({
      ...d,
      conversion_rate: computeConversionRate(d.selected, d.fetched),
      dominant_drop_stage: d.selected < d.fetched ? "final_selection" : null,
    }))
    .sort((a, b) => b.selected - a.selected || b.fetched - a.fetched);

  const response = {
    date: auditDoc.date_et,
    topic: tag,
    fetch_breakdown: fetchBreakdown,
    classifier_breakdown: classifierBreakdown,
    stages,
    source_domains: sourceDomains,
    source_registry: buildSourceRegistry(auditDoc, tag),
  };
  if (integrityWarning) response.integrity_warning = integrityWarning;
  return response;
}

function buildAggregatedTopicResponse(auditDocs, topicTag, from, to) {
  const tag = String(topicTag || "").trim().toUpperCase();

  const dayResponses = auditDocs
    .map((doc) => buildTopicResponse(doc, tag))
    .filter(Boolean);

  if (dayResponses.length === 0) return null;

  // Aggregate stage counts — the chain invariant still holds in aggregate
  // (sum of fetch.out across days == sum of editorial.in across days, etc.)
  const stageAcc = Object.create(null);
  for (const resp of dayResponses) {
    for (const stage of (resp.stages || [])) {
      if (!stageAcc[stage.stage]) {
        stageAcc[stage.stage] = { stage: stage.stage, in: 0, out: 0, dropped: 0, instrumented: false };
      }
      stageAcc[stage.stage].in       += stage.in      || 0;
      stageAcc[stage.stage].out      += stage.out     || 0;
      stageAcc[stage.stage].dropped  += stage.dropped || 0;
      if (stage.instrumented) stageAcc[stage.stage].instrumented = true;
    }
  }
  const stages = STAGES
    .map((def) => {
      const a = stageAcc[def.key];
      if (!a) return null;
      return {
        stage: a.stage,
        in: a.in,
        out: a.out,
        dropped: a.dropped,
        drop_pct: computeDropPct(a.dropped, a.in),
        instrumented: a.instrumented,
        global_items: false,
        items: null,
      };
    })
    .filter(Boolean);

  // Aggregate fetch lane breakdown
  const fbDays = dayResponses.filter((r) => r.fetch_breakdown);
  const fetchBreakdown = fbDays.length
    ? fbDays.reduce((acc, r) => ({
        broker:    acc.broker    + (r.fetch_breakdown.broker    || 0),
        discovery: acc.discovery + (r.fetch_breakdown.discovery || 0),
      }), { broker: 0, discovery: 0 })
    : null;

  // Aggregate classifier distribution
  const cbDays = dayResponses.filter((r) => r.classifier_breakdown);
  const classifierBreakdown = cbDays.length
    ? cbDays.reduce((acc, r) => ({
        high:    acc.high    + (r.classifier_breakdown.high    || 0),
        medium:  acc.medium  + (r.classifier_breakdown.medium  || 0),
        low:     acc.low     + (r.classifier_breakdown.low     || 0),
        unknown: acc.unknown + (r.classifier_breakdown.unknown || 0),
      }), { high: 0, medium: 0, low: 0, unknown: 0 })
    : null;

  // Aggregate source registry — group by source id across all days
  const srcAcc = Object.create(null);
  for (const resp of dayResponses) {
    for (const s of (resp.source_registry?.sources || [])) {
      if (!srcAcc[s.id]) {
        srcAcc[s.id] = {
          id: s.id, name: s.name, domains: s.domains,
          tier: s.tier, lane: s.lane, enabled: s.enabled,
          fetched: 0, to_scoring: 0, selected: 0,
          active_days: 0, total_days: 0,
          feed_parsed: 0, feed_retained: 0, feed_stale: 0,
          feed_ok_days: 0, feed_error_days: 0,
        };
      }
      const a = srcAcc[s.id];
      a.fetched     += s.fetched     || 0;
      a.to_scoring  += s.to_scoring  || 0;
      a.selected    += s.selected    || 0;
      a.total_days++;
      if (s.status === "active") a.active_days++;
      if (s.feed) {
        a.feed_parsed   += s.feed.parsed   || 0;
        a.feed_retained += s.feed.retained || 0;
        a.feed_stale    += s.feed.stale    || 0;
        if (s.feed.ok) a.feed_ok_days++; else a.feed_error_days++;
      }
    }
  }

  const aggregatedSources = Object.values(srcAcc).map((a) => {
    let status;
    if (!a.enabled)                                          status = "disabled";
    else if (a.fetched > 0)                                  status = "active";
    else if (a.feed_error_days > 0 && a.feed_ok_days === 0) status = "error";
    else if (a.feed_parsed === 0 && a.total_days > 0)        status = "empty";
    else if (a.feed_retained === 0 && a.feed_parsed > 0)     status = "stale";
    else                                                     status = "silent";

    const hasFeedData = (a.feed_ok_days + a.feed_error_days) > 0;
    return {
      id: a.id, name: a.name, domains: a.domains,
      tier: a.tier, lane: a.lane, enabled: a.enabled,
      status,
      fetched: a.fetched, to_scoring: a.to_scoring, selected: a.selected,
      active_days: a.active_days, total_days: a.total_days,
      feed: hasFeedData ? {
        ok: a.feed_error_days === 0,
        parsed: a.feed_parsed, retained: a.feed_retained, stale: a.feed_stale,
        ok_days: a.feed_ok_days, error_days: a.feed_error_days,
      } : null,
    };
  });

  const sourceRegistry = {
    configured_count: aggregatedSources.length,
    active_count:  aggregatedSources.filter((s) => s.status === "active").length,
    silent_count:  aggregatedSources.filter((s) => !["active", "disabled"].includes(s.status)).length,
    days_in_range: dayResponses.length,
    sources: aggregatedSources,
  };

  return {
    topic: tag,
    from,
    to,
    days_with_data: dayResponses.length,
    is_range: true,
    fetch_breakdown: fetchBreakdown,
    classifier_breakdown: classifierBreakdown,
    stages,
    source_registry: sourceRegistry,
  };
}

async function handleAdminFunnelRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const { json, isAdminAuthed, digestAuditDir } = deps;

  if (!pathname.startsWith("/api/admin/funnel")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const auditDir = String(digestAuditDir || "");

  if (pathname === "/api/admin/funnel/dates") {
    json(res, { ok: true, ...buildDatesResponse(auditDir) });
    return true;
  }

  if (pathname === "/api/admin/funnel/summary") {
    const dateParam = url.searchParams.get("date");
    const fromParam = url.searchParams.get("from");
    const toParam   = url.searchParams.get("to");

    let from, to;
    if (dateParam) {
      from = to = dateParam;
    } else if (fromParam && toParam) {
      from = fromParam;
      to   = toParam;
    } else {
      json(res, { ok: false, error: "date or from+to required" }, 400);
      return true;
    }

    const dates = expandDateRange(from, to);
    const auditDocs = dates.map((d) => readAuditFile(auditDir, d)).filter(Boolean);
    const summary = buildSummaryFromAuditDocs(auditDocs, { from, to });
    json(res, { ok: true, ...summary });
    return true;
  }

  if (pathname === "/api/admin/funnel/topic") {
    const dateParam  = url.searchParams.get("date");
    const fromParam  = url.searchParams.get("from");
    const toParam    = url.searchParams.get("to");
    const topicParam = url.searchParams.get("topic");

    if (!topicParam) {
      json(res, { ok: false, error: "topic required" }, 400);
      return true;
    }

    if (dateParam) {
      const doc = readAuditFile(auditDir, dateParam);
      if (!doc) { json(res, { ok: false, error: "no_data_for_date" }, 404); return true; }
      const topicResp = buildTopicResponse(doc, topicParam);
      if (!topicResp) { json(res, { ok: false, error: "topic_not_found" }, 404); return true; }
      json(res, { ok: true, ...topicResp });
      return true;
    }

    if (fromParam && toParam) {
      const dates = expandDateRange(fromParam, toParam);
      const auditDocs = dates.map((d) => readAuditFile(auditDir, d)).filter(Boolean);
      if (auditDocs.length === 0) { json(res, { ok: false, error: "no_data_for_range" }, 404); return true; }
      const topicResp = buildAggregatedTopicResponse(auditDocs, topicParam, fromParam, toParam);
      if (!topicResp) { json(res, { ok: false, error: "topic_not_found" }, 404); return true; }
      json(res, { ok: true, ...topicResp });
      return true;
    }

    json(res, { ok: false, error: "date or from+to required" }, 400);
    return true;
  }

  json(res, { ok: false, error: "not_implemented" }, 501);
  return true;
}

module.exports = {
  handleAdminFunnelRoutes,
  buildDatesResponse,
  buildSummaryFromAuditDocs,
  buildTopicResponse,
  expandDateRange,
  listAuditDates,
  readAuditFile,
};
