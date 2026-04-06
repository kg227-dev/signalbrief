"use strict";

const fs = require("fs");
const path = require("path");
const {
  STAGES,
  normalizeLane,
  normalizeCanonicalUrl,
  normalizeDomain,
  normalizeReason,
  computeDropPct,
  computeConversionRate,
} = require("./admin-api-funnel-shared");

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function readAuditFile(auditDir, dateKey) {
  try {
    const raw = fs.readFileSync(path.join(auditDir, `${dateKey}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listAuditDates(auditDir) {
  try {
    return fs.readdirSync(auditDir)
      .map((f) => { const m = DATE_FILE_RE.exec(f); return m ? m[1] : null; })
      .filter(Boolean)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function buildDatesResponse(auditDir) {
  const dates = listAuditDates(auditDir);
  return {
    available_dates: dates,
    oldest: dates.length > 0 ? dates[dates.length - 1] : null,
    newest: dates.length > 0 ? dates[0] : null,
    total_run_days: dates.length,
  };
}

// Expand "from"/"to" range into individual date strings (inclusive), most recent first
function expandDateRange(from, to) {
  const dates = [];
  const start = new Date(from + "T00:00:00Z");
  const end   = new Date(to   + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || start > end) return dates;
  for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function getFetchedCount(auditDoc) {
  const f = auditDoc?.fetch || {};
  const broker = Number(f.broker_candidate_count || 0);
  const discovery = Number(f.discovery_candidate_count || 0);
  if (broker > 0 || discovery > 0) return broker + discovery;
  return Number(auditDoc?.summary?.candidate_pool_before_dedup || 0);
}

function buildSummaryFromAuditDocs(auditDocs, period) {
  const validDocs = auditDocs.filter(Boolean);
  const docMap = Object.fromEntries(validDocs.map((d) => [d.date_et, d]));

  const allDates = expandDateRange(period.from, period.to);
  const runDates = allDates.filter((d) => docMap[d]);
  const missingDates = allDates.filter((d) => !docMap[d]);

  let totalFetched = 0;
  let totalSelected = 0;
  let totalEnrichmentFailures = 0;
  let totalBroker = 0;
  let totalDiscovery = 0;
  const sumClassifier = { high: 0, medium: 0, low: 0, unknown: 0 };
  const stageDrop = Object.fromEntries(
    STAGES.filter((s) => s.type === "drop-capable").map((s) => [s.key, 0])
  );
  const globalDomainMap = Object.create(null);

  for (const doc of validDocs) {
    totalFetched += getFetchedCount(doc);
    totalBroker   += Number(doc?.fetch?.broker_candidate_count || 0);
    totalDiscovery += Number(doc?.fetch?.discovery_candidate_count || 0);
    const topics = doc?.topics && typeof doc.topics === "object" ? doc.topics : {};
    for (const [, topicData] of Object.entries(topics)) {
      totalSelected += Number(topicData?.selected_count || 0);
      const candidates = Array.isArray(topicData?.candidates) ? topicData.candidates : [];
      for (const c of candidates) {
        if (c?.writeup_status === "failed") totalEnrichmentFailures++;
        const rel = String(c?.strategic_relevance || "").toUpperCase();
        if      (rel === "HIGH")                 sumClassifier.high++;
        else if (rel === "MEDIUM" || rel === "MED") sumClassifier.medium++;
        else if (rel === "LOW")                  sumClassifier.low++;
        else                                     sumClassifier.unknown++;
        const domain = normalizeDomain(String(c?.source_domain || c?.source || ""));
        if (!domain) continue;
        if (!globalDomainMap[domain]) globalDomainMap[domain] = { domain, fetched: 0, selected: 0 };
        globalDomainMap[domain].fetched++;
        if (c?.selected === true) globalDomainMap[domain].selected++;
      }
    }
    const sm = doc?.summary || {};
    const beforeDedup = Number(sm.candidate_pool_before_dedup || 0);
    stageDrop.editorial_filter  += Math.max(0, beforeDedup - Number(sm.candidate_pool_after_editorial || beforeDedup));
    stageDrop.archive_dedup     += Number(sm.dedup_removed || 0);
    stageDrop.freshness_filter  += Number(sm.stale_removed || 0);
    stageDrop.story_dedup       += Number(sm.continuation_removed || 0);
    const allCandidates = Object.values(doc?.topics || {}).flatMap((t) => Array.isArray(t?.candidates) ? t.candidates : []);
    stageDrop.classifier += allCandidates.filter((c) => c?.strategic_relevance === "LOW" && c?.selected !== true).length;
    const rejCounts = allCandidates.reduce((acc, c) => {
      const r = String(c?.selection_reason || "");
      if (r) acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {});
    stageDrop.final_selection += Number(rejCounts.selection_not_selected || 0) + Number(rejCounts.selection_source_cap || 0);
  }

  const topDropStage = Object.entries(stageDrop)
    .filter(([key]) => key !== "final_selection")
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const topDropDomains = Object.values(globalDomainMap)
    .map((d) => ({ ...d, conversion_rate: computeConversionRate(d.selected, d.fetched) }))
    .sort((a, b) => (b.fetched - b.selected) - (a.fetched - a.selected))
    .slice(0, 10);

  const topicMap = Object.create(null);
  for (const doc of validDocs) {
    const topics = doc?.topics && typeof doc.topics === "object" ? doc.topics : {};
    for (const [tag, topicData] of Object.entries(topics)) {
      if (!topicMap[tag]) topicMap[tag] = { tag, fetched: 0, selected: 0, domainMap: Object.create(null) };
      const t = topicMap[tag];
      const topicFetchDiag = Array.isArray(doc?.fetch?.topic_diagnostics)
        ? doc.fetch.topic_diagnostics.find((td) => td?.tag === tag) : null;
      t.fetched += topicFetchDiag
        ? Number(topicFetchDiag.broker_item_count || 0) + Number(topicFetchDiag.discovery_item_count || 0)
        : Number(topicData?.total_candidates || 0);
      t.selected += Number(topicData?.selected_count || 0);
      for (const c of (Array.isArray(topicData?.candidates) ? topicData.candidates : [])) {
        const domain = normalizeDomain(String(c?.source_domain || c?.source || ""));
        if (!domain) continue;
        if (!t.domainMap[domain]) t.domainMap[domain] = { domain, fetched: 0, selected: 0 };
        t.domainMap[domain].fetched++;
        if (c?.selected === true) t.domainMap[domain].selected++;
      }
    }
  }

  const topics = Object.values(topicMap).map((t) => ({
    tag: t.tag,
    fetched: t.fetched,
    selected: t.selected,
    drop_rate_pct: t.fetched > 0 ? Number((((t.fetched - t.selected) / t.fetched) * 100).toFixed(2)) : 0,
    dominant_drop_stage: null,
    top_domains: Object.values(t.domainMap)
      .map((d) => ({ ...d, conversion_rate: computeConversionRate(d.selected, d.fetched) }))
      .sort((a, b) => b.selected - a.selected)
      .slice(0, 5),
    instrumentation_gaps: ["editorial_filter", "archive_dedup", "freshness_filter", "story_dedup", "enrichment"],
  })).sort((a, b) => b.fetched - a.fetched);

  const isDayView = period.from === period.to;
  const dailyTrend = isDayView ? undefined : runDates.map((dateKey) => {
    const doc = docMap[dateKey];
    if (!doc) return null;
    const fetched = getFetchedCount(doc);
    const selected = Object.values(doc?.topics || {}).reduce((s, t) => s + Number(t?.selected_count || 0), 0);
    const classifierIn = Number(doc?.summary?.candidate_pool_after_story_relationship || doc?.summary?.candidate_pool_scored || 0);
    const allCands = Object.values(doc?.topics || {}).flatMap((t) => Array.isArray(t?.candidates) ? t.candidates : []);
    const classifierDropped = allCands.filter((c) => c?.strategic_relevance === "LOW" && c?.selected !== true).length;
    return {
      date: dateKey,
      fetched,
      selected,
      classifier_drop_rate_pct: computeDropPct(classifierDropped, classifierIn),
    };
  }).filter(Boolean);

  const result = {
    period,
    run_dates: runDates,
    missing_dates: missingDates,
    totals: {
      fetched: totalFetched,
      dropped: totalFetched - totalSelected,
      selected: totalSelected,
      enrichment_failures: totalEnrichmentFailures,
      fetch_breakdown: { broker: totalBroker, discovery: totalDiscovery },
      classifier_breakdown: sumClassifier,
    },
    top_drop_stage: topDropStage,
    top_drop_domains: topDropDomains,
    topics,
  };
  if (dailyTrend !== undefined) result.daily_trend = dailyTrend;
  return result;
}

function buildItemFromDropRecord(record) {
  return {
    url: normalizeCanonicalUrl(String(record?.url || "")),
    title: String(record?.title || ""),
    domain: normalizeDomain(String(record?.domain || "")),
    lane: record?.lane ? normalizeLane(record.lane) : null,
    published_at: record?.published_at || null,
    status: "dropped",
    reason: normalizeReason(String(record?.reason || "")),
    strategic_relevance: null,
    strategic_relevance_reason: null,
    score: null,
    score_components: null,
    duplicate_of: record?.duplicate_of ? normalizeCanonicalUrl(String(record.duplicate_of)) : null,
    enrichment_status: null,
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

  // Resolve per-topic drop arrays from instrumentation.
  // If records carry a topic field, filter by this topic.
  // If no topic field: only usable when there's a single topic in the audit (avoids double-counting).
  const topicCount = Object.keys(auditDoc?.topics || {}).length;
  function getTopicDrops(arr) {
    if (!Array.isArray(arr)) return null;
    const hasTopic = arr.some((r) => r?.topic != null);
    if (hasTopic) return arr.filter((r) => !r?.topic || r.topic === tag);
    // No topic tagging — only attribute to this topic when it's the sole topic
    return topicCount === 1 ? arr : null;
  }

  const editorialDropped  = getTopicDrops(auditDoc?.selectionDiagnostics?.editorial_dropped_items);
  const archiveDedupDropped = getTopicDrops(auditDoc?.selectionDiagnostics?.archive_dedup_dropped_items);
  const freshnessDropped  = getTopicDrops(auditDoc?.selectionDiagnostics?.freshness_dropped_items);

  // Build stage chain: each stage's out feeds the next stage's in.
  // Ground truth anchors: fetchedForTopic (start), scoredCount (post-classifier), finalSelected (end).
  // For stages without per-topic instrumentation, pass count through (0 drops) so the
  // classifier absorbs the true cumulative drop rather than fabricating broken counts.
  const chain = {};

  chain.fetch = {
    in: fetchedForTopic,
    out: fetchedForTopic,
    dropped: 0,
    instrumented: fetchDiag != null,
  };

  const editDropCount = editorialDropped ? editorialDropped.length : 0;
  chain.editorial_filter = {
    in: chain.fetch.out,
    out: Math.max(0, chain.fetch.out - editDropCount),
    dropped: editDropCount,
    instrumented: editorialDropped !== null,
  };

  const archDropCount = archiveDedupDropped ? archiveDedupDropped.length : 0;
  chain.archive_dedup = {
    in: chain.editorial_filter.out,
    out: Math.max(0, chain.editorial_filter.out - archDropCount),
    dropped: archDropCount,
    instrumented: archiveDedupDropped !== null,
  };

  const freshDropCount = freshnessDropped ? freshnessDropped.length : 0;
  chain.freshness_filter = {
    in: chain.archive_dedup.out,
    out: Math.max(0, chain.archive_dedup.out - freshDropCount),
    dropped: freshDropCount,
    instrumented: freshnessDropped !== null,
  };

  // story_dedup: count-only — no dedicated per-topic drop array yet
  chain.story_dedup = {
    in: chain.freshness_filter.out,
    out: chain.freshness_filter.out,
    dropped: 0,
    instrumented: false,
  };

  // classifier: in = story_dedup.out, out = scoredCount.
  // dropped absorbs true classifier + any un-instrumented upstream drops — never negative.
  chain.classifier = {
    in: chain.story_dedup.out,
    out: scoredCount,
    dropped: Math.max(0, chain.story_dedup.out - scoredCount),
    instrumented: false,
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

  const stages = STAGES.map((stageDef) => {
    const counts = chain[stageDef.key] || { in: 0, out: 0, dropped: 0, instrumented: false };
    let items = [];

    if (stageDef.key === "fetch") {
      const discoveryItems = Array.isArray(auditDoc?.fetch?.discovery_fetch_items)
        ? auditDoc.fetch.discovery_fetch_items.filter((i) => !i?.topic || i.topic === tag)
        : [];
      items = discoveryItems.map((i) => ({
        url: normalizeCanonicalUrl(String(i?.url || "")),
        title: String(i?.title || ""),
        domain: normalizeDomain(String(i?.domain || "")),
        lane: normalizeLane(String(i?.lane || "discovery")),
        published_at: i?.published_at || null,
        status: "passed",
        reason: null,
        strategic_relevance: null,
        strategic_relevance_reason: null,
        score: null,
        score_components: null,
        duplicate_of: null,
        enrichment_status: null,
      }));
    } else if (stageDef.key === "editorial_filter" && editorialDropped) {
      items = editorialDropped.map(buildItemFromDropRecord);
    } else if (stageDef.key === "archive_dedup" && archiveDedupDropped) {
      items = archiveDedupDropped.map(buildItemFromDropRecord);
    } else if (stageDef.key === "freshness_filter" && freshnessDropped) {
      items = freshnessDropped.map(buildItemFromDropRecord);
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
      items,
    };
  });

  // Stage consistency check
  let integrityWarning = null;
  for (let i = 0; i < stages.length - 1; i++) {
    const curr = stages[i];
    const next = stages[i + 1];
    if (curr.out !== next.in) {
      integrityWarning = `Count mismatch: ${curr.stage}.out (${curr.out}) ≠ ${next.stage}.in (${next.in})`;
      break; // report first mismatch only
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
  };
  if (integrityWarning) response.integrity_warning = integrityWarning;
  return response;
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
    const topicParam = url.searchParams.get("topic");
    if (!dateParam || !topicParam) {
      json(res, { ok: false, error: "date and topic required" }, 400);
      return true;
    }
    const doc = readAuditFile(auditDir, dateParam);
    if (!doc) {
      json(res, { ok: false, error: "no_data_for_date" }, 404);
      return true;
    }
    const topicResp = buildTopicResponse(doc, topicParam);
    if (!topicResp) {
      json(res, { ok: false, error: "topic_not_found" }, 404);
      return true;
    }
    json(res, { ok: true, ...topicResp });
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
