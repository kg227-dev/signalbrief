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
        const quality = summarizeEventEntryQuality(matched);
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

    return {
      ...row,
      digest_quality_score: Number.isFinite(digestQualityScore) ? digestQualityScore : null,
      digest_quality_samples: Number.isFinite(digestQualitySamples) ? digestQualitySamples : 0,
      digest_date_key: digestDateKey || null,
      digest_url: digestUrl || "",
    };
  });
}

module.exports = {
  enrichRunsWithDigestMetadata,
  parseRunIdMeta,
  parseDigestDateKey,
  buildDigestUrl,
};
