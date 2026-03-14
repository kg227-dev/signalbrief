const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID_RE = /^([a-z_]+):(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/i;

function normalizeRecipientKey(raw) {
  return String(raw || "").trim().toLowerCase();
}

function parseRunIdMeta(runId) {
  const match = String(runId || "").trim().match(RUN_ID_RE);
  if (!match) return null;
  const mode = String(match[1] || "").toLowerCase();
  const iso = `${match[2]}T${match[3]}:${match[4]}:${match[5]}.${match[6]}Z`;
  const tsMs = Date.parse(iso);
  if (!Number.isFinite(tsMs)) return null;
  return { mode, tsMs };
}

function parseDigestDateKey(digestId) {
  const match = String(digestId || "").trim().match(/^(\d{4}-\d{2}-\d{2}):/);
  return match ? match[1] : "";
}

function buildDigestUrl(dateKey) {
  const key = String(dateKey || "").trim();
  if (!DATE_KEY_RE.test(key)) return "";
  return `/digest/${encodeURIComponent(key)}`;
}

function buildPreferredDigestUrl({ digestDateKey, recipients, tokenByRecipient, runId }) {
  const base = buildDigestUrl(digestDateKey);
  if (!base) return "";

  const params = new URLSearchParams();
  const normalizedRunId = String(runId || "").trim();
  if (normalizedRunId) params.set("run", normalizedRunId);

  if (recipients instanceof Set && recipients.size === 1) {
    const onlyRecipient = Array.from(recipients)[0];
    const token = String(tokenByRecipient?.get?.(onlyRecipient) || "").trim();
    if (token) params.set("ref", token);
  }

  if (params.size > 0) return `${base}?${params.toString()}`;
  return base;
}

function summarizeQuality(values) {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numeric.length) return { score: null, samples: 0 };
  const avg = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return {
    score: Number(avg.toFixed(1)),
    samples: numeric.length,
  };
}

function summarizePerUserMeta(perUserRows) {
  const rows = Array.isArray(perUserRows) ? perUserRows : [];
  const recipients = new Set();
  const qualityScores = [];
  let digestUrl = "";
  let digestDateKey = "";
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const recipient = normalizeRecipientKey(row.id);
    if (recipient) recipients.add(recipient);

    const score = Number(row.digest_quality_score);
    if (Number.isFinite(score)) qualityScores.push(score);

    const rowDigestUrl = String(row.digest_url || "").trim();
    if (!digestUrl && rowDigestUrl) digestUrl = rowDigestUrl;

    const rowDigestDate = parseDigestDateKey(row.digest_id);
    if (!digestDateKey && rowDigestDate) digestDateKey = rowDigestDate;
  }

  const quality = summarizeQuality(qualityScores);
  return {
    recipients,
    digestUrl,
    digestDateKey,
    digestQualityScore: quality.score,
    digestQualitySamples: quality.samples,
  };
}

function normalizeDebugItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : null,
      headline: item.headline || null,
      url: item.url || null,
      tag: item.tag || null,
      base_score: Number.isFinite(Number(item.base_score)) ? Number(item.base_score) : null,
      topic_match: Number.isFinite(Number(item.topic_match)) ? Number(item.topic_match) : null,
      relevance_score: Number.isFinite(Number(item.relevance_score)) ? Number(item.relevance_score) : null,
      entity_keys: Array.isArray(item.entity_keys) ? item.entity_keys.slice() : [],
      storyline_id: item.storyline_id || null,
      storyline_key: item.storyline_key || null,
      storyline_size: Number.isFinite(Number(item.storyline_size)) ? Number(item.storyline_size) : null,
      source_domain: item.source_domain || null,
      source_tier: item.source_tier || null,
      strategic_value: Number.isFinite(Number(item.strategic_value)) ? Number(item.strategic_value) : null,
      routine_item_score: Number.isFinite(Number(item.routine_item_score)) ? Number(item.routine_item_score) : null,
      score_breakdown: item.score_breakdown && typeof item.score_breakdown === "object"
        ? { ...item.score_breakdown }
        : null,
    }));
}

function createRecipientDebug(recipient) {
  return {
    recipient,
    channels: new Set(),
    sources: new Set(),
    digestIds: new Set(),
    deliveryModes: new Set(),
    deliveryVersions: new Set(),
    qualityScores: [],
    qualityComponents: null,
    items: [],
    sentAt: null,
  };
}

function mergeRecipientDebug(detail, event) {
  if (!detail || !event || typeof event !== "object") return detail;
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};

  const channel = String(event.channel || "").trim();
  if (channel) detail.channels.add(channel);

  const source = String(event.source || "").trim();
  if (source) detail.sources.add(source);

  const digestId = String(event.digest_id || "").trim();
  if (digestId) detail.digestIds.add(digestId);

  const deliveryMode = String(metadata.delivery_mode || "").trim();
  if (deliveryMode) detail.deliveryModes.add(deliveryMode);

  const deliveryVersion = Number(metadata.delivery_version);
  if (Number.isFinite(deliveryVersion)) detail.deliveryVersions.add(deliveryVersion);

  const qualityScore = Number(metadata.quality_score);
  if (Number.isFinite(qualityScore)) detail.qualityScores.push(qualityScore);

  const qualityComponents = metadata.quality_components && typeof metadata.quality_components === "object"
    ? metadata.quality_components
    : null;
  if (qualityComponents) {
    const existingKeys = detail.qualityComponents ? Object.keys(detail.qualityComponents).length : 0;
    const candidateKeys = Object.keys(qualityComponents).length;
    if (!detail.qualityComponents || candidateKeys >= existingKeys) {
      detail.qualityComponents = { ...qualityComponents };
    }
  }

  const items = normalizeDebugItems(metadata.items);
  if (items.length >= detail.items.length) detail.items = items;

  const sentAt = String(event.ts_utc || "").trim();
  if (sentAt && (!detail.sentAt || sentAt > detail.sentAt)) detail.sentAt = sentAt;

  return detail;
}

function materializeRecipientDebug(detail) {
  if (!detail) return null;
  const qualitySummary = summarizeQuality(detail.qualityScores);
  const items = normalizeDebugItems(detail.items);
  const entityKeys = Array.from(new Set(items.flatMap((item) => item.entity_keys || []))).sort();
  const storylineIds = Array.from(new Set(items.map((item) => String(item.storyline_id || "").trim()).filter(Boolean))).sort();
  const deliveryVersions = Array.from(detail.deliveryVersions).sort((a, b) => a - b);
  const deliveryModes = Array.from(detail.deliveryModes).sort();

  return {
    id: detail.recipient,
    channels: Array.from(detail.channels).sort(),
    sources: Array.from(detail.sources).sort(),
    digest_ids: Array.from(detail.digestIds).sort(),
    delivery_modes: deliveryModes,
    delivery_versions: deliveryVersions,
    quality_score: qualitySummary.score,
    quality_score_samples: qualitySummary.samples,
    quality_components: detail.qualityComponents ? { ...detail.qualityComponents } : null,
    items,
    debug_entities: entityKeys,
    debug_storyline_ids: storylineIds,
    sent_at: detail.sentAt || null,
  };
}

function buildRunEventIndex(events) {
  const index = new Map();
  for (const event of (Array.isArray(events) ? events : [])) {
    if (String(event?.event_type || "") !== "digest_sent") continue;
    const runId = String(event?.run_id || "").trim();
    if (!runId) continue;
    const runMeta = parseRunIdMeta(runId);
    if (!runMeta) continue;

    let entry = index.get(runId);
    if (!entry) {
      entry = {
        runId,
        mode: runMeta.mode,
        tsMs: runMeta.tsMs,
        recipients: new Set(),
        qualityByRecipient: new Map(),
        qualityFallback: [],
        digestDateKey: "",
        digestUrl: "",
        recipientDebug: new Map(),
      };
      index.set(runId, entry);
    }

    const recipient = normalizeRecipientKey(event?.user_email || event?.user_chat_id || "");
    const qualityScore = Number(event?.metadata?.quality_score);
    if (recipient) {
      entry.recipients.add(recipient);
      if (Number.isFinite(qualityScore) && !entry.qualityByRecipient.has(recipient)) {
        entry.qualityByRecipient.set(recipient, qualityScore);
      }
      const detail = entry.recipientDebug.get(recipient) || createRecipientDebug(recipient);
      mergeRecipientDebug(detail, event);
      entry.recipientDebug.set(recipient, detail);
    } else if (Number.isFinite(qualityScore)) {
      entry.qualityFallback.push(qualityScore);
    }

    const digestDateKey = parseDigestDateKey(event?.digest_id);
    if (!entry.digestDateKey && digestDateKey) {
      entry.digestDateKey = digestDateKey;
      entry.digestUrl = buildDigestUrl(digestDateKey);
    }
  }
  return index;
}

function enrichPerUserRows(perUserRows, matchedEntry) {
  const rows = (Array.isArray(perUserRows) ? perUserRows : []).map((row) => ({ ...row }));
  return rows.map((row) => {
    const recipient = normalizeRecipientKey(row.id);
    const detail = recipient ? materializeRecipientDebug(matchedEntry?.recipientDebug?.get?.(recipient)) : null;
    const rowDeliveryVersion = Number(row.delivery_version);
    const rowDeliveryMode = String(row.delivery_mode || "").trim();

    return {
      ...row,
      channels: Array.isArray(detail?.channels) ? detail.channels : [],
      event_sources: Array.isArray(detail?.sources) ? detail.sources : [],
      sent_at: detail?.sent_at || null,
      digest_ids: Array.isArray(detail?.digest_ids) ? detail.digest_ids : [],
      delivery_modes: Array.isArray(detail?.delivery_modes) && detail.delivery_modes.length
        ? detail.delivery_modes
        : (rowDeliveryMode ? [rowDeliveryMode] : []),
      delivery_mode: rowDeliveryMode || (Array.isArray(detail?.delivery_modes) ? detail.delivery_modes[0] || null : null),
      delivery_versions: Array.isArray(detail?.delivery_versions) && detail.delivery_versions.length
        ? detail.delivery_versions
        : (Number.isFinite(rowDeliveryVersion) ? [rowDeliveryVersion] : []),
      delivery_version: Number.isFinite(rowDeliveryVersion)
        ? rowDeliveryVersion
        : (Array.isArray(detail?.delivery_versions) && detail.delivery_versions.length
          ? detail.delivery_versions[detail.delivery_versions.length - 1]
          : null),
      quality_components: detail?.quality_components || null,
      debug_items: Array.isArray(detail?.items) ? detail.items : [],
      debug_entities: Array.isArray(detail?.debug_entities) ? detail.debug_entities : [],
      debug_storyline_ids: Array.isArray(detail?.debug_storyline_ids) ? detail.debug_storyline_ids : [],
    };
  });
}

function findBestRunEventEntry(run, runEventIndex, runRecipients) {
  const existingRunId = String(run?.run_id || "").trim();
  if (existingRunId && runEventIndex.has(existingRunId)) {
    return runEventIndex.get(existingRunId);
  }

  const runMs = Date.parse(String(run?.run_at || ""));
  if (!Number.isFinite(runMs)) return null;
  const runMode = run?.on_demand ? "targeted" : "scheduled";
  const usersServed = Math.max(0, Number(run?.users_served || 0));

  let best = null;
  let bestScore = -Infinity;

  for (const entry of runEventIndex.values()) {
    if (entry.mode !== runMode) continue;
    const deltaMs = Math.abs(entry.tsMs - runMs);
    if (!Number.isFinite(deltaMs) || deltaMs > 10 * 60 * 1000) continue;

    let score = 0;
    if (deltaMs <= 1_000) score += 7;
    else if (deltaMs <= 5_000) score += 6;
    else if (deltaMs <= 15_000) score += 5;
    else if (deltaMs <= 60_000) score += 4;
    else if (deltaMs <= 180_000) score += 3;
    else score += 1;

    if (runRecipients.size > 0) {
      let overlap = 0;
      for (const recipient of runRecipients) {
        if (entry.recipients.has(recipient)) overlap += 1;
      }
      if (overlap === 0) continue;
      score += overlap * 5;
      if (overlap === runRecipients.size) score += 3;
    }

    if (usersServed > 0 && entry.recipients.size === usersServed) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (bestScore < 6) return null;
  return best;
}

function summarizeEventEntryQuality(entry) {
  const recipientScores = Array.from(entry?.qualityByRecipient?.values?.() || []);
  if (recipientScores.length > 0) return summarizeQuality(recipientScores);
  return summarizeQuality(Array.isArray(entry?.qualityFallback) ? entry.qualityFallback : []);
}

function summarizeMatchedQualityForRecipients(entry, recipients) {
  const recipientSet = recipients instanceof Set ? recipients : new Set();
  if (recipientSet.size === 1) {
    const recipient = Array.from(recipientSet)[0];
    const directScore = Number(entry?.qualityByRecipient?.get?.(recipient));
    if (Number.isFinite(directScore)) {
      return {
        score: Number(directScore.toFixed(1)),
        samples: 1,
      };
    }
  }
  return summarizeEventEntryQuality(entry);
}

function expandRunsByRecipient(runs) {
  const rows = Array.isArray(runs) ? runs : [];
  const expanded = [];

  for (const run of rows) {
    const row = run && typeof run === "object" ? { ...run } : {};
    const perUserRows = (Array.isArray(row.per_user) ? row.per_user : [])
      .filter((entry) => entry && typeof entry === "object" && String(entry.id || "").trim())
      .map((entry) => ({ ...entry }));

    if (perUserRows.length <= 1) {
      row.per_user = perUserRows;
      expanded.push(row);
      continue;
    }

    for (const perUserRow of perUserRows) {
      expanded.push({
        ...row,
        users_served: 1,
        per_user: [{ ...perUserRow }],
      });
    }
  }

  return expanded;
}

function enrichRunsWithDigestMetadata(runs, engagementEvents, opts = {}) {
  const rows = Array.isArray(runs) ? runs : [];
  if (!rows.length) return [];

  const runEventIndex = buildRunEventIndex(engagementEvents);
  const tokenByRecipient = opts?.recipientTokenById instanceof Map
    ? opts.recipientTokenById
    : new Map();

  return rows.map((run) => {
    const row = run && typeof run === "object" ? { ...run } : {};
    const perUserMeta = summarizePerUserMeta(row.per_user);

    let digestQualityScore = perUserMeta.digestQualityScore;
    let digestQualitySamples = perUserMeta.digestQualitySamples;
    let digestDateKey = perUserMeta.digestDateKey;
    let digestUrl = perUserMeta.digestUrl || String(row.digest_url || "").trim();

    const matched = findBestRunEventEntry(row, runEventIndex, perUserMeta.recipients);
    if (matched) {
      if (!row.run_id) row.run_id = matched.runId;
      if (!Number.isFinite(digestQualityScore)) {
        const quality = summarizeMatchedQualityForRecipients(matched, perUserMeta.recipients);
        digestQualityScore = quality.score;
        digestQualitySamples = quality.samples;
      }
      if (!digestDateKey && matched.digestDateKey) digestDateKey = matched.digestDateKey;
      if (!digestUrl && matched.digestUrl) digestUrl = matched.digestUrl;
    }

    if (!digestDateKey && DATE_KEY_RE.test(String(row.date || ""))) {
      digestDateKey = String(row.date);
    }

    if (digestDateKey) {
      const preferredDigestUrl = buildPreferredDigestUrl({
        digestDateKey,
        recipients: perUserMeta.recipients,
        tokenByRecipient,
        runId: matched?.runId || row.run_id,
      });
      if (preferredDigestUrl) {
        digestUrl = preferredDigestUrl;
      }
    }
    if (!digestUrl && digestDateKey) {
      digestUrl = buildDigestUrl(digestDateKey);
    }

    const enrichedPerUser = enrichPerUserRows(row.per_user, matched);
    const debugEntities = Array.from(new Set(enrichedPerUser.flatMap((entry) => entry.debug_entities || []))).slice(0, 12);
    const debugStorylineIds = Array.from(new Set(enrichedPerUser.flatMap((entry) => entry.debug_storyline_ids || []))).slice(0, 12);
    const deliveryModes = Array.from(new Set(enrichedPerUser.flatMap((entry) => entry.delivery_modes || []))).slice(0, 6);

    return {
      ...row,
      per_user: enrichedPerUser,
      digest_quality_score: Number.isFinite(digestQualityScore) ? digestQualityScore : null,
      digest_quality_samples: Number.isFinite(digestQualitySamples) ? digestQualitySamples : 0,
      digest_date_key: digestDateKey || null,
      digest_url: digestUrl || "",
      debug_entities: debugEntities,
      debug_storyline_ids: debugStorylineIds,
      delivery_modes: deliveryModes,
    };
  });
}

module.exports = {
  enrichRunsWithDigestMetadata,
  expandRunsByRecipient,
  parseRunIdMeta,
  parseDigestDateKey,
  buildDigestUrl,
};
