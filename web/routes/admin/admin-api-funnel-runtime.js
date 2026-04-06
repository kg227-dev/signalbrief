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

const BROKER_SOURCES_CONFIG = require("../../../config/standard-topic-broker-sources.json");

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

// Normalize topic tag for config matching: "LIFE SCIENCES", "LIFE_SCIENCES" → "lifesciences"
function normalizeTopicTag(str) {
  return String(str || "").replace(/[\s_]+/g, "").toLowerCase();
}

// Extract human name from _comment field: "STAT News — gold standard..." → "STAT News"
function parseSourceName(comment, id) {
  if (comment) {
    const idx = comment.indexOf(" \u2014 ");
    if (idx > 0) return comment.slice(0, idx).trim();
    const emIdx = comment.indexOf("\u2014");
    if (emIdx > 0) return comment.slice(0, emIdx).trim();
    const dashIdx = comment.indexOf(" -- ");
    if (dashIdx > 0) return comment.slice(0, dashIdx).trim();
  }
  return String(id || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSourceRegistry(auditDoc, tag) {
  const normTag = normalizeTopicTag(tag);
  const allSources = Array.isArray(BROKER_SOURCES_CONFIG.sources) ? BROKER_SOURCES_CONFIG.sources : [];

  const configuredSources = allSources.filter(
    (s) => Array.isArray(s.topic_tags) && s.topic_tags.some((t) => normalizeTopicTag(t) === normTag)
  );

  // Domain → fetched count from broker_fetch_items (filtered to this topic)
  const fetchDomainMap = Object.create(null);
  const brokerFetchItems = Array.isArray(auditDoc?.fetch?.broker_fetch_items)
    ? auditDoc.fetch.broker_fetch_items.filter(
        (i) => !i?.topic || String(i.topic).toUpperCase() === tag
      )
    : [];
  for (const item of brokerFetchItems) {
    const d = normalizeDomain(String(item?.domain || ""));
    if (d) fetchDomainMap[d] = (fetchDomainMap[d] || 0) + 1;
  }

  // Domain → {to_scoring, selected} from scored candidates
  const topicData = auditDoc?.topics?.[tag] || {};
  const candidates = Array.isArray(topicData.candidates) ? topicData.candidates : [];
  const candidateDomainMap = Object.create(null);
  for (const c of candidates) {
    const d = normalizeDomain(String(c?.source_domain || c?.source || ""));
    if (!d) continue;
    if (!candidateDomainMap[d]) candidateDomainMap[d] = { to_scoring: 0, selected: 0 };
    candidateDomainMap[d].to_scoring++;
    if (c?.selected === true) candidateDomainMap[d].selected++;
  }

  // Source ID → broker fetch diagnostic (parsed/retained/error per source)
  const brokerSourceDiags = Array.isArray(auditDoc?.fetch?.standard_topic_broker?.source_diagnostics)
    ? auditDoc.fetch.standard_topic_broker.source_diagnostics
    : [];
  const sourceDiagById = Object.create(null);
  for (const d of brokerSourceDiags) {
    if (d?.id) sourceDiagById[d.id] = d;
  }

  const sources = configuredSources.map((s) => {
    const domains = Array.isArray(s.domains) ? s.domains : [];
    let fetched = 0, to_scoring = 0, selected = 0;
    for (const d of domains) {
      fetched    += fetchDomainMap[d]                  || 0;
      to_scoring += candidateDomainMap[d]?.to_scoring || 0;
      selected   += candidateDomainMap[d]?.selected   || 0;
    }

    const diag = sourceDiagById[s.id] || null;
    const attempted = diag !== null;
    const fetchOk = diag?.ok === true;
    const parsedCount = Number(diag?.parsed_count || 0);
    const retainedCount = Number(diag?.retained_count || 0);
    const staleCount = Number(diag?.stale_count || 0);
    const feedError = diag?.error ? String(diag.error).slice(0, 120) : null;

    // Granular status: disabled > no_data > error > empty > stale > silent > active
    let status;
    if (!s.enabled)       status = "disabled";
    else if (!attempted)  status = "no_data";   // old audit or source not polled
    else if (!fetchOk)    status = "error";     // HTTP/network failure
    else if (parsedCount === 0) status = "empty";  // feed had no articles
    else if (retainedCount === 0) status = "stale"; // all articles too old
    else if (fetched === 0) status = "silent";  // items passed normalization but none for this topic
    else                  status = "active";

    return {
      id: s.id,
      name: parseSourceName(s._comment, s.id),
      domains,
      tier: s.tier || null,
      lane: s.lane || null,
      enabled: s.enabled !== false,
      status,
      fetched,
      to_scoring,
      selected,
      feed: attempted ? { ok: fetchOk, parsed: parsedCount, retained: retainedCount, stale: staleCount, error: feedError } : null,
    };
  });

  return {
    configured_count: sources.length,
    active_count:  sources.filter((s) => s.status === "active").length,
    silent_count:  sources.filter((s) => s.status === "silent" || s.status === "empty" || s.status === "stale" || s.status === "error").length,
    sources,
  };
}

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
