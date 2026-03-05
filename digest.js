#!/usr/bin/env node
/**
 * SignalBrief — digest.js
 * Fetches news via Perplexity Sonar, summarizes via Claude,
 * delivers via Telegram + Gmail.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf8")
);
const EMAIL_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "templates/email.html"),
  "utf8"
);
const { readUser, writeUser, allUsers } = require("./store");
const { sendEmail: sendEmailViaMailer } = require("./mailer");
const { appendEngagementEvent, buildDigestId, loadEngagementEvents } = require("./engagement-events");
const { computeDigestQualityScore } = require("./quality-score");
const { applyAutoTopicLearning } = require("./personalization");

const LOG_FILE = "/tmp/signalbrief.log";
const COST_LOG = path.join(__dirname, "data", "cost-log.json");
const DIGEST_RUN_LOCK = path.join(__dirname, "data", "digest-run.lock");
const DIGEST_INCIDENT_LOG = path.join(__dirname, "data", "digest-incident-log.jsonl");
const DIGEST_LOCK_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000)));
const BASE_URL = process.env.BASE_URL || "https://getsignalbrief.com";

function buildPublicDigestUrl(dateKey) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return `${BASE_URL}/digest/${key}`;
}

// ET time helpers
function getETNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function toETDateStr(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}
function etDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// API cost estimates
const PERPLEXITY_COST_PER_CALL  = 0.005;   // Sonar model per call
const CLAUDE_HAIKU_IN_PER_MTOK  = 0.80;    // $/million input tokens
const CLAUDE_HAIKU_OUT_PER_MTOK = 4.00;    // $/million output tokens

function appendCostLog(entry) {
  try {
    const dir = path.dirname(COST_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(COST_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    log(`⚠️  Cost log write failed: ${e.message}`);
  }
}

function appendIncidentLog(entry) {
  try {
    const dir = path.dirname(DIGEST_INCIDENT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(DIGEST_INCIDENT_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    log(`⚠️ Incident log write failed: ${e.message}`);
  }
}

function incidentKeySeenRecently(eventKey, maxAgeHours = 24) {
  try {
    if (!eventKey || !fs.existsSync(DIGEST_INCIDENT_LOG)) return false;
    const cutoff = Date.now() - Math.max(1, Number(maxAgeHours || 24)) * 60 * 60 * 1000;
    const lines = fs.readFileSync(DIGEST_INCIDENT_LOG, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const ts = Date.parse(row?.ts_utc || "");
        if (Number.isFinite(ts) && ts < cutoff) break;
        if (String(row?.event_key || "") === String(eventKey)) return true;
      } catch {
        // skip malformed rows
      }
    }
  } catch {
    // ignore read errors
  }
  return false;
}

async function emitDigestIncident(type, summary, metadata = {}) {
  const now = new Date();
  const hourBucket = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const eventKey = `digest-incident:${String(type || "unknown")}:${hourBucket}`;
  if (incidentKeySeenRecently(eventKey, 48)) return false;

  const entry = {
    ts_utc: now.toISOString(),
    date_et: etDateKey(now),
    event_key: eventKey,
    type: String(type || "unknown"),
    summary: String(summary || "").trim(),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
  appendIncidentLog(entry);

  const opsChatId = process.env.OPS_ALERT_CHAT_ID || CONFIG?.user?.telegramChatId || null;
  if (opsChatId) {
    const lines = [
      "ALERT SignalBrief incident",
      `Type: ${entry.type}`,
      `Summary: ${entry.summary}`,
      `ET date: ${entry.date_et}`,
      `Mode: ${entry.metadata.mode || "scheduled"}`,
      `Due users: ${entry.metadata.due_users != null ? entry.metadata.due_users : "-"}`,
      `Standard topics: ${entry.metadata.standard_topics != null ? entry.metadata.standard_topics : "-"}`,
      `Selected items: ${entry.metadata.selected_items != null ? entry.metadata.selected_items : "-"}`,
    ];
    try {
      await sendTelegram(lines.join("\n"), opsChatId);
    } catch (e) {
      log(`⚠️ Incident alert send failed: ${e.message}`);
    }
  }
  return true;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

let digestLockOwned = false;
function readDigestLock() {
  if (!fs.existsSync(DIGEST_RUN_LOCK)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(DIGEST_RUN_LOCK, "utf8"));
    const ts = Date.parse(lock?.startedAt || "");
    if (!Number.isFinite(ts)) return { stale: true, raw: lock };
    const ageMs = Date.now() - ts;
    return { ...lock, ageMs, stale: ageMs > DIGEST_LOCK_STALE_MS };
  } catch {
    return { stale: true };
  }
}

function clearDigestLock() {
  try {
    if (fs.existsSync(DIGEST_RUN_LOCK)) fs.unlinkSync(DIGEST_RUN_LOCK);
  } catch {
    // ignore cleanup errors
  }
}

function acquireDigestLock(mode) {
  const existing = readDigestLock();
  if (existing && !existing.stale) {
    return { ok: false, lock: existing };
  }
  if (existing && existing.stale) clearDigestLock();
  const dir = path.dirname(DIGEST_RUN_LOCK);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    mode: mode || "scheduled",
  };
  try {
    const fd = fs.openSync(DIGEST_RUN_LOCK, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify(payload));
    } finally {
      fs.closeSync(fd);
    }
    digestLockOwned = true;
    return { ok: true, lock: payload };
  } catch {
    const lock = readDigestLock();
    return { ok: false, lock };
  }
}

function releaseDigestLock() {
  if (!digestLockOwned) return;
  digestLockOwned = false;
  clearDigestLock();
}

// ── User state helpers ────────────────────────────────────────────────────────
// Uses store.js — per-user JSON in data/ directory

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsPost(hostname, path_, headers, body, isForm = false) {
  return new Promise((resolve, reject) => {
    const data = isForm ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path: path_, method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
          catch { resolve({ status: res.statusCode, body: out }); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("HTTP timeout after 30s")); });
    req.write(data);
    req.end();
  });
}

async function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
  const retries = Math.max(0, Number(opts.retries ?? 2));
  const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
  const isForm = !!opts.isForm;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsPost(hostname, path_, headers, body, isForm);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      const retryable = /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
      if (!retryable || attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastErr || new Error("HTTP request failed");
}

// ── 1. Fetch news via Perplexity Sonar (with real URLs from citations) ───────

async function fetchTopicNews(topic) {
  log(`Fetching: ${topic.tag}`);
  const queries = Array.isArray(topic?.queries) && topic.queries.length
    ? topic.queries.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  if (!queries.length) {
    const empty = [];
    empty.__apiCalls = 0;
    return empty;
  }

  const maxAttempts = topic?.isCustom ? Math.min(2, queries.length) : 1;
  const collected = [];
  const seenUrl = new Set();
  const seenHeadline = new Set();
  let apiCalls = 0;

  for (let idx = 0; idx < maxAttempts; idx++) {
    const query = queries[idx];
    if (idx > 0) log(`↳ ${topic.tag} fallback query ${idx + 1}/${maxAttempts}`);

    let res;
    try {
      res = await httpsPostWithRetry(
        "api.perplexity.ai", "/chat/completions",
        { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.keys.perplexity}` },
        {
          model: "sonar",
          messages: [
            {
              role: "system",
              content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.
Return ONLY a JSON array of up to 3 distinct news items from the last 48 hours.
Each item MUST include the direct article URL from your citations — not the homepage.
Format: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "tag": "${topic.tag}"}]
No markdown. No explanation. JSON array only.`,
            },
            {
              role: "user",
              content: `Find the 3 most important news items from the last 48 hours about: ${query}
IMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
            },
          ],
          max_tokens: 1000,
        }
      );
      apiCalls += 1;
    } catch (e) {
      log(`⚠️ Perplexity ${topic.tag} query failed (${idx + 1}/${maxAttempts}): ${String(e?.message || e).slice(0, 180)}`);
      continue;
    }

    if (res.status >= 400) {
      const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
      log(`⚠️ Perplexity ${topic.tag} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
      continue;
    }

    // Extract article URLs from Perplexity citations if available
    const citations = res.body?.citations || [];

    try {
      let content = res.body?.choices?.[0]?.message?.content || "[]";
      if (!res.body?.choices?.[0]?.message?.content) {
        const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
        log(`⚠️ Perplexity returned empty payload for ${topic.tag}: ${String(errDetail).slice(0, 180)}`);
      }
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let items = JSON.parse(content);
      if (!Array.isArray(items)) {
        log(`⚠️ Perplexity payload for ${topic.tag} was not an array`);
        continue;
      }

      // Patch URLs: if item URL looks like a homepage (no path), try to match from citations
      items = items.map((item) => {
        if (!item.url || item.url === "#") return { ...item, tag: topic.tag };
        try {
          const u = new URL(item.url);
          // Homepage if path is "/" or empty
          if (u.pathname === "/" || u.pathname === "") {
            // Find citation from same domain
            const match = citations.find((c) => {
              try { return new URL(c).hostname === u.hostname; } catch { return false; }
            });
            if (match) return { ...item, url: match, tag: topic.tag };
          }
        } catch {}
        return { ...item, tag: topic.tag };
      });

      for (const item of items) {
        if (!item || !item.headline) continue;
        const headKey = String(item.headline || "").toLowerCase().trim().slice(0, 80);
        const urlKey = normalizeUrlForDedup(item.url || "");
        if (headKey && seenHeadline.has(headKey)) continue;
        if (urlKey && seenUrl.has(urlKey)) continue;
        if (headKey) seenHeadline.add(headKey);
        if (urlKey) seenUrl.add(urlKey);
        collected.push(item);
        if (collected.length >= 3) break;
      }
    } catch (e) {
      log(`Parse error for ${topic.tag}: ${e.message}`);
    }

    if (collected.length >= 3) break;
    if (!topic?.isCustom && collected.length >= 1) break;
    if (topic?.isCustom && collected.length >= 2) break;
  }

  const out = collected.slice(0, 3);
  out.__apiCalls = apiCalls;
  return out;
}

// ── 2. Select best N (interleaved, max per tag/source, capped custom share) ──

function parseSourceDomain(item) {
  const rawUrl = String(item?.url || "").trim();
  if (rawUrl) {
    try {
      return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {}
  }

  const rawSource = String(item?.source || "").trim().toLowerCase();
  if (!rawSource) return "unknown";
  return rawSource.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0] || "unknown";
}

function normalizeUrlForDedup(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function headlineFingerprint(text, width = 60) {
  return normalizeMatchText(text).slice(0, width);
}

function loadRecentArchiveItems(days = 3) {
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) return [];
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return [];

  const recent = files.slice(-Math.max(1, Number(days || 3)));
  const items = [];
  for (const file of recent) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(archiveDir, file), "utf8"));
      items.push(...(parsed?.items || []));
    } catch {}
  }
  return items;
}

function dedupAgainstRecentArchives(items, opts = {}) {
  const dedupDays = Math.max(1, Number(opts.days || 3));
  const target = Math.max(1, Number(opts.targetCount || 7));
  const recentItems = loadRecentArchiveItems(dedupDays);
  if (!recentItems.length) {
    return { items: items || [], removed: 0, archive_days_used: 0 };
  }

  const seenUrls = new Set(
    recentItems.map((i) => normalizeUrlForDedup(i?.url)).filter(Boolean)
  );
  const seenHeadlines = new Set(
    recentItems.map((i) => headlineFingerprint(i?.headline)).filter(Boolean)
  );

  const kept = [];
  const removed = [];
  for (const item of (items || [])) {
    const urlKey = normalizeUrlForDedup(item?.url);
    const headKey = headlineFingerprint(item?.headline);
    const duplicate = (urlKey && seenUrls.has(urlKey)) || (headKey && seenHeadlines.has(headKey));
    if (duplicate) removed.push(item);
    else kept.push(item);
  }

  if (kept.length < target && removed.length > 0) {
    const backfill = removed.slice(0, target - kept.length);
    kept.push(...backfill);
  }

  return {
    items: kept,
    removed: removed.length,
    archive_days_used: dedupDays,
  };
}

function selectItems(allItems, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems || CONFIG.digest.itemCount || 7));
  const maxItemsPerTag = Math.max(1, Number(opts.maxItemsPerTag || CONFIG.digest.maxItemsPerTag || 2));
  const maxItemsPerSourceDomain = Math.max(1, Number(opts.maxItemsPerSourceDomain || CONFIG.digest.maxItemsPerSourceDomain || 2));
  const customTagOrder = [...new Set((opts.customTags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean))];
  const customTags = new Set(customTagOrder);
  const tagPriority = opts.tagPriority && typeof opts.tagPriority === "object" ? opts.tagPriority : {};
  const explicitCustomCap = Number(opts.maxCustomItems);
  const maxCustomItems = Number.isFinite(explicitCustomCap)
    ? Math.max(0, explicitCustomCap)
    : (customTags.size > 0 ? Math.max(1, Math.floor(maxItems * 0.4)) : Infinity);

  const seen = new Set();
  const seenUrls = new Set();
  const deduped = (allItems || []).filter((item) => {
    const headline = String(item?.headline || "").toLowerCase().trim();
    if (!headline) return false;
    const key = headline.slice(0, 40);
    if (seen.has(key)) return false;
    const urlKey = normalizeUrlForDedup(item?.url);
    if (urlKey && seenUrls.has(urlKey)) return false;
    seen.add(key);
    if (urlKey) seenUrls.add(urlKey);
    return true;
  });

  const tagCounts = {};
  const domainCounts = {};
  let customCount = 0;
  const selected = [];
  const pool = [...deduped];

  const underCaps = (item) => {
    const tag = String(item?.tag || "");
    if (!tag) return false;
    if ((tagCounts[tag] || 0) >= maxItemsPerTag) return false;
    if (customTags.size > 0 && customTags.has(tag.toLowerCase()) && customCount >= maxCustomItems) return false;
    const domain = parseSourceDomain(item);
    if ((domainCounts[domain] || 0) >= maxItemsPerSourceDomain) return false;
    return true;
  };

  const pickIndex = (lastTag, allowAdjacentTag = false) => {
    let bestIdx = -1;
    let bestCount = Infinity;
    let bestDomainCount = Infinity;
    let bestPriority = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      if (!underCaps(item)) continue;
      const tag = String(item?.tag || "");
      if (!allowAdjacentTag && lastTag && tag === lastTag) continue;
      const count = tagCounts[tag] || 0;
      const domainCount = domainCounts[parseSourceDomain(item)] || 0;
      const priority = Number(tagPriority[normalizeTopicToken(tag)] || 0);
      if (
        count < bestCount
        || (count === bestCount && domainCount < bestDomainCount)
        || (count === bestCount && domainCount === bestDomainCount && priority > bestPriority)
      ) {
        bestCount = count;
        bestDomainCount = domainCount;
        bestPriority = priority;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  // Guarantee baseline custom-topic coverage without letting custom tags dominate.
  if (customTagOrder.length > 0 && maxCustomItems > 0) {
    for (const customTag of customTagOrder) {
      if (selected.length >= maxItems || customCount >= maxCustomItems) break;
      const idx = pool.findIndex((item) => {
        const tag = String(item?.tag || "").toLowerCase();
        return tag === customTag && underCaps(item);
      });
      if (idx === -1) continue;
      const item = pool.splice(idx, 1)[0];
      const domain = parseSourceDomain(item);
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      customCount += 1;
      selected.push({ ...item, source_domain: item.source_domain || domain });
    }
  }

  while (selected.length < maxItems && pool.length > 0) {
    const lastTag = selected.length > 0 ? selected[selected.length - 1].tag : null;
    const idx = pickIndex(lastTag, false);
    const fallback = idx === -1 ? pickIndex(lastTag, true) : idx;
    if (fallback === -1) break;
    const item = pool.splice(fallback, 1)[0];
    const domain = parseSourceDomain(item);
    tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    if (customTags.has(String(item.tag || "").toLowerCase())) customCount += 1;
    selected.push({ ...item, source_domain: item.source_domain || domain });
  }

  return selected;
}

// ── 3. Enrich with Claude (sharp consultant lens) ────────────────────────────

async function enrichItems(items) {
  log("Enriching with Claude...");

  const prompt = `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants and business professionals. Your readers work at MBB, Big 4, boutique strategy firms, corporate strategy functions, and PE/investment shops. They work across multiple industries and need to sound informed in client meetings across healthcare, tech, financial services, PE, energy, consumer, and policy. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, return five fields:

1. "wim_brief" — one sentence, max 18 words.
   RULES:
   - Capture only the core strategic punchline for a busy executive.
   - Keep this descriptive only (what changed + why now); do not include role-specific actions or "Watch:" language.
   - No filler, no hedging, no repetition of the headline.
   - Do not use HTML tags in this field.

2. "wim" — a "why it matters" analysis of exactly 2-3 sentences.
   RULES:
   - Use 2 sentences by default; use 3 only when there is a concrete near-term catalyst.
   - First sentence: sharp strategic implication with one named entity and one explicit business impact (pricing, margin, demand, cost, capex, valuation, or market share). Wrap in <strong> tags.
   - Second sentence: start with "For <role>," and state a concrete action for the next 1-2 quarters. Include a causal link ("because", "as", or "which means") plus at least one specific company, regulator, or investor type AND one business lever (pricing, margin, demand, cost, capex, valuation, or market share).
   - Avoid hedging and filler: do NOT use "could", "may", "might", "potentially", "likely", "industry broadly", "stakeholders", or "monitor developments".
   - Include at least one concrete proper noun in sentence 1 or 2 (company, regulator, buyer segment, or fund type).
   - Include one concrete quantitative anchor when available from the source context (deal value, percentage, timeline, or count). If not available, use a bounded near-term qualifier (for example "next 2 quarters").
   - Third sentence (optional): must start with "Watch:" and name a specific catalyst in the next 2-4 weeks (filing, ruling, earnings call, close date, or vote). Skip only if no concrete catalyst exists.

3. "baseScore" — a number 0.0–10.0 measuring the story's strategic importance and consultant relevance, independent of any user's topic preferences.
   - 8.5–10.0: Major development (landmark M&A, significant policy shift, key earnings miss with broad implications)
   - 7.0–8.4: Notable development (meaningful deal, regulatory move, sector-level change)
   - 5.0–6.9: Moderate interest (incremental update, early-stage signal worth watching)
   - Below 5.0: Routine or narrow-interest item

4. "implications" — one actionable sentence naming a specific role (e.g. "CFO", "deal team", "payer CMO", "PE portfolio team") and the concrete action, question, or client meeting flag this story creates. Return null if it is fully covered by the wim already.

5. "watch_next" — one forward-looking sentence: name the specific signal, filing, earnings call, or regulatory decision to monitor in the next 2–4 weeks. Start with an entity name or date. Return null if this is a one-time development with no near-term pending catalysts.

WHAT TO AVOID (too generic):
❌ "This could have significant implications for the industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)
❌ "This may affect stakeholders over time." (vague hedge)
❌ "Keep an eye on developments." (no actionable signal)

WHAT TO AIM FOR (specific, implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."

Return ONLY a JSON array with the same items plus "wim_brief", "wim", "baseScore", "implications", and "watch_next" fields. No markdown, no explanation.

Items:
${JSON.stringify(items.map(i => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;

  const res = await httpsPostWithRetry(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-haiku-4-5", max_tokens: 4500, messages: [{ role: "user", content: prompt }] }
  );

  const usage = {
    input_tokens:  res.body?.usage?.input_tokens  || 0,
    output_tokens: res.body?.usage?.output_tokens || 0,
  };

  function parseJsonArrayLenient(raw) {
    const cleaned = String(raw || "")
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
    if (!cleaned) return [];
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      // Claude occasionally appends prose after a valid JSON array.
      const start = cleaned.indexOf("[");
      if (start === -1) throw err;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") { inString = true; continue; }
        if (ch === "[") depth++;
        else if (ch === "]") {
          depth--;
          if (depth === 0) {
            const candidate = cleaned.slice(start, i + 1);
            return JSON.parse(candidate);
          }
        }
      }
      throw err;
    }
  }

  try {
    const enriched = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
    if (!Array.isArray(enriched)) throw new Error("Claude response was not a JSON array");
    // Merge wim + baseScore back onto original items (which have URLs)
    return {
      items: items.map((item, i) => ({
        ...item,
        wim_brief:    typeof enriched[i]?.wim_brief === "string" && enriched[i].wim_brief.trim() ? enriched[i].wim_brief.trim() : null,
        wim:          typeof enriched[i]?.wim === "string" && enriched[i].wim.trim() ? enriched[i].wim.trim() : null,
        baseScore:    typeof enriched[i]?.baseScore === "number" ? enriched[i].baseScore : 5.0,
        implications: typeof enriched[i]?.implications === "string" && enriched[i].implications.trim() ? enriched[i].implications.trim() : null,
        watch_next:   typeof enriched[i]?.watch_next === "string" && enriched[i].watch_next.trim() ? enriched[i].watch_next.trim() : null,
      })),
      usage,
    };
  } catch (e) {
    log(`Claude parse error: ${e.message}`);
    return {
      // Degrade gracefully (no "analysis unavailable" placeholder shown to end users).
      items: items.map((i) => ({ ...i, wim: null, implications: null, watch_next: null })),
      usage,
    };
  }
}

// ── 3b. Score items by relevance (zero extra API cost) ───────────────────────
// baseScore comes from enrichItems (already paid for in that call).
// topicMatch is computed locally — free.
// finalScore = baseScore (60%) + topicMatch (40%) + weightBonus (+ optional specialist bonus)
//
// topic_weights (from "more X" / "less X" commands) are keyed by whatever string
// Claude returns from intent parsing (e.g., "AI", "healthcare") — not necessarily
// the canonical tag. matchWeightToTag() does case-insensitive substring matching
// so "AI" matches "AI×TECH" and "health" matches "HEALTHCARE".
// Each weight unit = ±0.6 points on the 0–10 scale (range: -5 to +5 → -3.0 to +3.0).
// Specialist mode adds an additional boost/penalty for narrow-topic users so exact matches
// are preserved at the top of the ranking before broad balancing.

function scoreColor(score) {
  if (score >= 8.5) return { bg: "#16A34A", text: "#fff" };    // strong green
  if (score >= 7.0) return { bg: "#22C55E", text: "#fff" };    // green
  if (score >= 5.0) return { bg: "#EAB308", text: "#111827" }; // yellow
  if (score >= 3.5) return { bg: "#F97316", text: "#fff" };    // orange
  return { bg: "#EF4444", text: "#fff" };                       // red
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicToken(value) {
  return normalizeMatchText(String(value || "").replace(/^custom_/i, "").replace(/×/g, " "));
}

const CUSTOM_KEYWORD_ALIASES = {
  "rate cuts": ["federal reserve rate cut", "interest rate cuts", "fed rate decision"],
  "sec rulemaking": ["sec proposed rules", "securities and exchange commission rules", "sec disclosure rule"],
  "semicap": ["semiconductor equipment", "chip equipment", "wafer fab equipment"],
  "agentic ai": ["ai agents", "enterprise ai agents", "autonomous ai agent"],
  "quantum computing": ["quantum hardware", "quantum platform", "quantum commercial deployment"],
  "glp 1": ["obesity drugs", "weight loss drug", "novo nordisk eli lilly"],
  "doge": ["dogecoin", "crypto regulation", "crypto market"],
};

const CUSTOM_TOPIC_STOPWORDS = new Set(["the", "and", "for", "with", "from", "into", "over", "under", "news"]);

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWordBoundary(text, token) {
  const t = String(text || "");
  const w = String(token || "");
  if (!t || !w) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(w)}(?:\\s|$)`, "i");
  return pattern.test(t);
}

function tokenizeCustomTopic(topicNormalized) {
  return normalizeTopicToken(topicNormalized)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !CUSTOM_TOPIC_STOPWORDS.has(t))
    .filter((t) => t.length > 2 || ["ai", "pe", "sec", "fed"].includes(t));
}

function customKeywordMatches(topicNormalized, bodyText, tagNormalized = "") {
  const topic = normalizeTopicToken(topicNormalized);
  if (!topic) return false;

  const haystack = normalizeMatchText(`${bodyText || ""} ${tagNormalized || ""}`);
  if (!haystack) return false;

  if (haystack.includes(topic)) return true;

  const aliases = CUSTOM_KEYWORD_ALIASES[topic] || [];
  for (const alias of aliases) {
    const aliasToken = normalizeTopicToken(alias);
    if (aliasToken && haystack.includes(aliasToken)) return true;
  }

  const tokens = tokenizeCustomTopic(topic);
  if (!tokens.length) return false;

  const hitCount = tokens.reduce((sum, token) => (
    sum + (hasWordBoundary(haystack, token) ? 1 : 0)
  ), 0);
  const requiredHits = tokens.length >= 3 ? 2 : tokens.length;
  return hitCount >= Math.max(1, requiredHits);
}

function buildCustomTopicQueries(keywordRaw) {
  const keyword = String(keywordRaw || "").trim().replace(/\s+/g, " ");
  if (!keyword) return [];
  const normalized = normalizeTopicToken(keyword);
  const aliases = CUSTOM_KEYWORD_ALIASES[normalized] || [];
  const base = [
    `${keyword} business strategy developments last 48 hours`,
    `${keyword} market impact regulation deals earnings last 72 hours`,
    `${keyword} strategy and investment implications last 72 hours`,
  ];
  if (keyword.split(" ").length <= 2) {
    base.unshift(`${keyword} company and sector news last 48 hours`);
  }
  const merged = [...base, ...aliases.map((a) => `${a} business and market developments last 72 hours`)];
  const seen = new Set();
  const queries = [];
  for (const q of merged) {
    const clean = String(q || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(clean);
    if (queries.length >= 4) break;
  }
  return queries;
}

const RELATED_TOPIC_GROUPS = [
  ["healthcare", "life sciences"],
  ["ai tech", "technology", "digital"],
  ["pe m a", "m a advisory", "financial services"],
  ["public sector", "policy regulatory"],
  ["energy", "sustainability"],
];

function topicsRelated(a, b) {
  const left = normalizeTopicToken(a);
  const right = normalizeTopicToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return RELATED_TOPIC_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function computeTopicSignals(item, userTopics) {
  const tagNormalized = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  let best = 3;
  let customKeywordMatch = false;
  let exactMatch = false;
  let partialMatch = false;

  for (const topic of (userTopics || [])) {
    const rawTopic = String(topic || "");
    const topicNormalized = normalizeTopicToken(rawTopic);
    if (!topicNormalized) continue;

    const exact = tagNormalized && topicNormalized === tagNormalized;
    const partial = tagNormalized && !exact
      && topicsRelated(tagNormalized, topicNormalized);

    if (exact) {
      exactMatch = true;
      best = Math.max(best, 10);
    } else if (partial) {
      partialMatch = true;
      best = Math.max(best, 7);
    }

    if (rawTopic.toLowerCase().startsWith("custom_") && customKeywordMatches(topicNormalized, bodyText, tagNormalized)) {
      customKeywordMatch = true;
      best = Math.max(best, 10);
    }
  }

  return {
    topicMatch: best,
    customKeywordMatch,
    exactMatch,
    partialMatch,
  };
}

function computeTopicMatch(item, userTopics) {
  return computeTopicSignals(item, userTopics).topicMatch;
}

// Find the total weight adjustment for a given item tag from the user's topic_weights map.
// Weight keys may be partial/informal ("AI" → "AI×TECH"), so we fuzzy-match.
function matchWeightToTag(tag, topicWeights) {
  if (!topicWeights || typeof topicWeights !== "object") return 0;
  const tagToken = normalizeTopicToken(tag);
  let total = 0;
  for (const [key, w] of Object.entries(topicWeights)) {
    if (!w) continue;
    const keyToken = normalizeTopicToken(key);
    if (!keyToken) continue;
    if (topicsRelated(tagToken, keyToken)) {
      total += w;
    }
  }
  return total;
}

function applyRelevanceScores(items, userTopics, topicWeights = {}, opts = {}) {
  const specialistMode = !!opts.specialistMode;
  return items.map(item => {
    const signals     = computeTopicSignals(item, userTopics);
    const topicMatch  = signals.topicMatch;
    const base        = typeof item.baseScore === "number" ? item.baseScore : 5.0;
    const weight      = matchWeightToTag(item.tag, topicWeights);
    const weightBonus = weight * 0.6; // ±0.6 pts per "more"/"less" step
    let specialistBonus = 0;
    if (specialistMode) {
      if (topicMatch >= 10) specialistBonus = 1.1;
      else if (topicMatch >= 7) specialistBonus = 0.45;
      else specialistBonus = -0.6;
    }
    const raw         = base * 0.6 + topicMatch * 0.4 + weightBonus + specialistBonus;

    const whyShown = [];
    if (topicMatch >= 7) whyShown.push("topic_match");
    if (signals.customKeywordMatch) whyShown.push("custom_keyword");
    if (weightBonus > 0.25) whyShown.push("weight_boost");
    if (base >= 8.0) whyShown.push("high_base_score");

    return {
      ...item,
      source_domain: item.source_domain || parseSourceDomain(item),
      topicMatch,
      weightBonus,
      specialistBonus,
      why_shown: whyShown,
      relevanceScore: Math.min(10, Math.max(0, Math.round(raw * 10) / 10)),
    };
  });
}

// ── 4. Format Telegram message ───────────────────────────────────────────────

function buildCommandMenu(state) {
  const isNewUser = state.digests_received < 5;
  if (isNewUser) {
    return [
      "───",
      "📧 Deeper takes in your email",
      "",
      "💾 save 3 → bookmarks item 3",
      "💾 save 1,4,6 → bookmarks multiple",
      "📊 more AI → see more AI stories",
      "📉 less M&A → see fewer M&A stories",
      "➕ add GLP-1 → track a new topic",
      "⚙️ settings → view/change all preferences",
    ].join("\n");
  }
  return [
    "───",
    "📧 Deeper takes in your email",
    "💾 save [#] · 📊 more/less [topic] · ⚙️ settings",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTopicDisplay(topic) {
  const raw = String(topic || "")
    .replace(/^custom_/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "topic";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildLearningSummary(adjustments, maxTopics = 2) {
  const rows = (Array.isArray(adjustments) ? adjustments : [])
    .map((adj) => ({
      topic: formatTopicDisplay(adj?.topic),
      delta: Number(adj?.delta),
    }))
    .filter((row) => row.topic && Number.isFinite(row.delta) && row.delta !== 0);
  if (!rows.length) return "";

  const shown = rows.slice(0, Math.max(1, Number(maxTopics) || 2));
  const parts = shown.map((row) => `${row.topic} ${row.delta > 0 ? `+${row.delta}` : row.delta}`);
  const remaining = rows.length - shown.length;
  const suffix = remaining > 0 ? ` · +${remaining} more` : "";
  return `Applied from your recent saves, clicks, and skips: ${parts.join(" · ")}${suffix}.`;
}

function digestQualityLabel(digestQuality) {
  const score = Number(digestQuality?.score);
  if (!Number.isFinite(score)) return null;
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const band = String(digestQuality?.band || "").toLowerCase();
  const bandLabel = band === "strong" ? "strong" : (band === "watch" ? "watch" : "tuning");
  return {
    score: rounded,
    band: bandLabel,
  };
}

function formatTelegram(items, dateStr, state, opts = {}) {
  const NUM_LABELS = ["1⃣","2⃣","3⃣","4⃣","5⃣","6⃣","7⃣","8⃣","9⃣","🔟"];
  const quality = digestQualityLabel(opts.digestQuality);
  const learningSummary = String(opts.learningSummary || "").trim();
  const publicDigestUrl = String(opts.publicDigestUrl || "").trim();
  const lines = [
    `☀️ *SignalBrief — ${dateStr}*`,
    `_Your daily signal across AI, strategy, and business_`,
  ];
  if (quality) lines.push(`🎯 Digest match: ${quality.score}% · ${quality.band}`);
  if (learningSummary) lines.push(`🧠 ${learningSummary}`);
  if (publicDigestUrl) lines.push(`🔗 [Share today's brief](${publicDigestUrl})`);
  lines.push("");
  items.forEach((item, i) => {
    const num = NUM_LABELS[i] || `${i + 1}.`;
    // Strip ALL HTML first (including <strong>) before splitting — bold asterisks break
    // the sentence-boundary lookbehind. Cap at 250 chars (plaintext sentence avg ~200).
    const rawWim = item.wim
      ? item.wim
          .replace(/<\/?[^>]+>/g, "")
          .split(/(?<=[a-z][.!?]|[!?])\s+(?=[A-Z])/)[0]
      : null;
    const wim = rawWim
      ? (rawWim.length > 250 ? rawWim.slice(0, 247).replace(/\s+\S*$/, "") + "…" : rawWim)
      : null;
    lines.push(`${num} *[${item.tag}]* ${item.headline}`);
    if (wim) lines.push(`_${wim}_`);
    if (item.url && item.url !== "#") {
      lines.push(`→ [${item.source}](${item.url})`);
    } else {
      lines.push(`→ ${item.source}`);
    }
    const whyShown = Array.isArray(item.why_shown) && item.why_shown.length
      ? item.why_shown.map((k) => String(k).replace(/_/g, " ")).join(", ")
      : null;
    if (whyShown) lines.push(`· why shown: ${whyShown}`);
    lines.push("");
  });
  lines.push(buildCommandMenu(state));
  return lines.join("\n");
}

function buildDigestInlineKeyboard(items) {
  const inlineKeyboard = [];
  const safeItems = Array.isArray(items) ? items : [];

  safeItems.slice(0, 10).forEach((_, idx) => {
    const itemNum = idx + 1;
    inlineKeyboard.push([
      { text: `💾 ${itemNum}`, callback_data: `sb:save:${itemNum}` },
      { text: `➕ ${itemNum}`, callback_data: `sb:more:${itemNum}` },
      { text: `➖ ${itemNum}`, callback_data: `sb:less:${itemNum}` },
    ]);
  });

  // P1-5 feedback capture row (one response per digest).
  inlineKeyboard.push([
    { text: "🔥 Great", callback_data: "sb:fb:great" },
    { text: "👍 Fine", callback_data: "sb:fb:fine" },
    { text: "👎 Meh", callback_data: "sb:fb:meh" },
  ]);

  return { inline_keyboard: inlineKeyboard };
}

// ── 5. Build HTML email ──────────────────────────────────────────────────────

function buildEmail(
  items,
  dateStr,
  quickScan,
  userToken = "",
  isFirstDigest = false,
  wasFiltered = true,
  depth = "headline_plus_why",
  user = null,
  digestDateKey = "",
  digestId = "",
  opts = {}
) {
  const filterNote = wasFiltered
    ? "filtered to your selected topics"
    : "today's top signals across all areas";
  const quality = digestQualityLabel(opts.digestQuality);
  const learningSummary = String(opts.learningSummary || "").trim();
  const publicDigestUrl = String(opts.publicDigestUrl || "").trim()
    || buildPublicDigestUrl(digestDateKey)
    || BASE_URL;
  const publicDigestUrlEncoded = encodeURIComponent(publicDigestUrl);

  // ── Welcome banner (first digest only — placed BEFORE Quick Scan via template placeholder) ──
  const welcomeBanner = isFirstDigest ? `
  <div style="padding:28px 40px 24px;background:#F0FDF4;border-bottom:2px solid #BBF7D0;">
    <div style="font-size:21px;font-weight:700;color:#15803D;margin-bottom:8px;">👋 Welcome to SignalBrief</div>
    <div style="font-size:14px;color:#166534;line-height:1.6;margin-bottom:20px;">Your first briefing is below — ${filterNote}. Here's what you're looking at:</div>
    <div style="font-size:13px;color:#374151;margin-bottom:20px;">
      <div style="margin-bottom:12px;">
        <strong>📰 Headline + "Why it matters"</strong><br>
        <span style="color:#6B7280;">Each signal includes a strategic analysis written for how consultants think about implications — not just what happened, but who feels it and what moves next.</span>
      </div>
      <div style="margin-bottom:12px;">
        <strong>🎯 Relevance scores</strong> — the colored badges like <span style="background:#DCFCE7;color:#15803D;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;">8.5</span><br>
        <span style="color:#6B7280;">Ranked 0–10 per story: 40% topic match · 35% market significance · 25% strategic utility. Green = high signal, yellow = moderate, red = low.</span>
      </div>
      <div>
        <strong>⚙️ Personalized to your topics</strong><br>
        <span style="color:#6B7280;">This digest is ${filterNote}. Tune anytime — email "more [topic]" or "less [topic]" to adjust what you see, or update your full preferences below.</span>
      </div>
    </div>
    <a href="${BASE_URL}/settings?token=${userToken}" style="display:inline-block;background:#15803D;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 28px;border-radius:100px;">Update preferences →</a>
  </div>` : "";
  const personalizationNote = learningSummary ? `
  <div style="padding:12px 40px;background:#F8FAFC;border-bottom:1px solid #E5E7EB;">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748B;margin-bottom:4px;">Personalization update</div>
    <div style="font-size:13px;line-height:1.5;color:#334155;">🧠 ${escapeHtml(learningSummary)}</div>
  </div>` : "";
  const itemsHtml = items.map((item, i) => {
    const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;
    const trackedLinkUrl = userToken && digestId
      ? `${BASE_URL}/api/click?token=${encodeURIComponent(userToken)}&did=${encodeURIComponent(digestId)}&item=${i + 1}&url=${encodeURIComponent(linkUrl)}`
      : linkUrl;
    // Relevance score badge (color-coded, embedded in enrichment — no extra API cost)
    const score = item.relevanceScore;
    const scoreHtml = score !== undefined ? (() => {
      const c = scoreColor(score);
      return `<span style="display:inline-block;font-size:10px;font-weight:700;color:${c.text};background:${c.bg};padding:2px 8px;border-radius:4px;letter-spacing:0.01em;">${score.toFixed(1)}</span>`;
    })() : "";

    // Conditionally render WIM block — inline styles for Gmail (strips <style> blocks)
    const wimHtml = item.wim
      ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#2563EB;margin-bottom:5px;">Why it matters</div>\n        <div style="font-size:14px;color:#374151;line-height:1.65;margin-bottom:10px;">${item.wim}</div>`
      : "";

    // Deep mode extras: implications + watch_next (only for headline_plus_why / full depth)
    const isDeep = depth === "headline_plus_why" || depth === "full" || depth === "deep";
    const implHtml = (isDeep && item.implications)
      ? `<div style="font-size:13px;color:#1D4ED8;line-height:1.6;margin-bottom:6px;font-weight:500;">→ ${item.implications}</div>`
      : "";
    const watchHtml = (isDeep && item.watch_next)
      ? `<div style="font-size:12px;color:#6B7280;line-height:1.6;margin-bottom:12px;font-style:italic;">👀 ${item.watch_next}</div>`
      : "";
    const whyShownHtml = Array.isArray(item.why_shown) && item.why_shown.length
      ? `<div style="font-size:11px;color:#6B7280;line-height:1.5;margin-bottom:10px;">Why shown: ${item.why_shown.map((k) => String(k).replace(/_/g, " ")).join(" · ")}</div>`
      : "";

    const itemStyle = "padding:32px 0;border-bottom:1px solid #E5E7EB;";

    return `
      <div class="item" style="${itemStyle}">
        <div style="margin-bottom:8px;">
          <span style="font-size:13px;color:#9CA3AF;font-weight:600;margin-right:6px;">${i + 1}</span>
          <span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#2563EB;background:#EFF6FF;padding:2px 8px;border-radius:4px;margin-right:6px;">${item.tag}</span>
          ${scoreHtml}
        </div>
        <div style="font-size:16px;font-weight:700;color:#1A1A1A;line-height:1.4;margin-bottom:8px;">${item.headline}</div>
        <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:12px;">${item.summary}</div>
        ${wimHtml}
        ${implHtml}
        ${watchHtml}
        ${whyShownHtml}
        <div style="font-size:13px;"><a href="${trackedLinkUrl}" style="color:#2563EB;text-decoration:none;font-weight:500;">Read more → ${item.source}</a></div>
      </div>`;
  }).join("\n");

  const readMins = Math.max(2, Math.ceil(items.length * 0.6));
  const headerMeta = `${items.length} signals · ${readMins} min read${quality ? ` · Match ${quality.score}%` : ""}`;

  // ── Per-user settings footer (shown in every digest) ──
  let settingsFooter = "";
  if (user) {
    const prefs = user.preferences || {};
    const [sh, sm] = (prefs.delivery_time || "07:00").split(":").map(Number);
    const sampm = sh >= 12 ? "PM" : "AM";
    const shour = sh % 12 || 12;
    const sTimeStr = `${shour}${sm === 0 ? "" : ":" + String(sm).padStart(2, "0")} ${sampm} ET`;
    const sDays = prefs.days_of_week || [1, 2, 3, 4, 5];
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let sDaysStr;
    if (sDays.length === 7) sDaysStr = "Every day";
    else if (sDays.length === 5 && !sDays.includes(0) && !sDays.includes(6)) sDaysStr = "Mon–Fri";
    else sDaysStr = sDays.map(d => DAY_NAMES[d]).join(", ");
    const SDEPTH = { headline_only: "Scan", scan: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" };
    const sDepth = SDEPTH[prefs.depth] || "Deep";
    const sTopics = (user.topics || [])
      .map(t => t.replace(/^custom_/, "").replace(/_/g, " "))
      .join(" · ") || "—";
    const sSettingsUrl = `${BASE_URL}/settings?token=${userToken}`;
    settingsFooter = `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;background:#F3F4F6;border-radius:8px;padding:14px 16px;">
      <tr valign="middle">
        <td>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;margin-bottom:6px;">Your digest settings</div>
          <div style="font-size:12px;color:#6B7280;line-height:1.9;">
            <span style="color:#374151;font-weight:600;">Topics</span>&nbsp;&nbsp;${sTopics}<br>
            <span style="color:#374151;font-weight:600;">Delivery</span>&nbsp;&nbsp;${sTimeStr} · ${sDaysStr}<br>
            <span style="color:#374151;font-weight:600;">Depth</span>&nbsp;&nbsp;${sDepth}
          </div>
        </td>
        <td style="text-align:right;vertical-align:middle;padding-left:12px;white-space:nowrap;">
          <a href="${sSettingsUrl}" style="display:inline-block;font-size:12px;font-weight:600;color:#2563EB;text-decoration:none;border:1.5px solid #BFDBFE;background:#EFF6FF;padding:7px 16px;border-radius:100px;">Edit settings →</a>
        </td>
      </tr>
    </table>`;
  }

  return EMAIL_TEMPLATE
    .replace(/\{\{DATE\}\}/g, dateStr)
    .replace("{{ITEM_COUNT}}", headerMeta)
    .replace("{{QUICK_SCAN}}", quickScan)
    .replace("{{WELCOME_BANNER}}", welcomeBanner)
    .replace("{{PERSONALIZATION_NOTE}}", personalizationNote)
    .replace("{{SETTINGS_FOOTER}}", settingsFooter)
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace(/\{\{PUBLIC_DIGEST_URL\}\}/g, publicDigestUrl)
    .replace(/\{\{PUBLIC_DIGEST_URL_ENCODED\}\}/g, publicDigestUrlEncoded)
    .replace(/\{\{SETTINGS_TOKEN\}\}/g, userToken)
    .replace(/\{\{CURRENT_DIGEST_DATE\}\}/g, digestDateKey || "")
    .replace(
      /<!-- Items -->[\s\S]*<!-- Footer -->/,
      `<!-- Items -->\n    <div class="items">\n${itemsHtml}\n    </div>\n\n    <!-- Footer -->`
    );
}

// ── 6. Send via SignalBrief bot ───────────────────────────────────────────────

async function sendTelegram(text, chatId, extra = {}) {
  const targetId = chatId || CONFIG.user.telegramChatId;
  log(`Sending Telegram to ${targetId}...`);
  const token = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
  const res = await httpsPostWithRetry(
    "api.telegram.org", `/bot${token}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: targetId, text, parse_mode: "Markdown", disable_web_page_preview: false, ...extra }
  );
  if (res.body?.ok) {
    log(`✅ Telegram sent to ${targetId}`);
    return;
  }
  const detail = res.body?.description || JSON.stringify(res.body) || `status ${res.status}`;
  throw new Error(`telegram send failed: ${detail}`);
}

// ── 7. Send Email (via mailer.js — Resend if configured, Gmail fallback) ──────

async function sendEmail(subject, html, toEmail, token = null) {
  const target = toEmail || CONFIG.user.email;
  log(`Sending email to ${target}...`);
  const result = await sendEmailViaMailer(target, subject, html, token);
  if (result.ok) {
    log(`✅ Email sent via ${result.via}`);
    return;
  }
  throw new Error(`email send failed via ${result.via || "mailer"}`);
}

// ── Archive ───────────────────────────────────────────────────────────────────

function saveToArchive(date, items, dateStr, quickScan, opts = {}) {
  const { overwrite = false } = opts;
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    log("⚠️ Archive write skipped: no items");
    return;
  }
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
  const key = etDateKey(date);
  const file = path.join(archiveDir, `${key}.json`);
  if (fs.existsSync(file) && !overwrite) return;
  const entry = {
    date: key,
    dateStr,
    quickScan,
    items: safeItems.map(i => ({
      tag:         i.tag,
      headline:    i.headline,
      summary:     i.summary,
      wim_brief:   i.wim_brief || null,
      wim:         i.wim,
      implications: i.implications || null,
      watch_next:  i.watch_next || null,
      url:         i.url,
      source:      i.source,
      source_domain: i.source_domain || parseSourceDomain(i),
      baseScore:   i.baseScore != null ? i.baseScore : null,
      why_shown:   Array.isArray(i.why_shown) ? i.why_shown : [],
    })),
    generatedAt: date.toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  log(`📁 Archived: ${key}${overwrite ? " (overwrite)" : ""}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  // Support --chatId flag for on-demand single-user delivery (/digest command)
  const args = process.argv.slice(2);
  const chatIdIdx = args.indexOf("--chatId");
  const targetChatId = chatIdIdx !== -1 ? args[chatIdIdx + 1] : null;
  const dryRun = args.includes("--dry-run") || process.env.DIGEST_DRY_RUN === "1";
  const suppressWelcome = args.includes("--suppressWelcome");
  const runMode = targetChatId ? "targeted" : "scheduled";
  const runId = `${runMode}:${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const lock = acquireDigestLock(runMode);
  if (!lock.ok) {
    const started = lock.lock?.startedAt || "unknown";
    const mode = lock.lock?.mode || "unknown";
    log(`⏭️ Digest skipped: another run is active (mode=${mode}, started=${started})`);
    process.exit(4);
  }

  // ── Check who's due BEFORE any API calls ──────────────────────────────────
  const etNow = getETNow();
  const todayET = etNow.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nowMinutes = etNow.getHours() * 60 + etNow.getMinutes();
  const allActive = allUsers().filter(u => u.status === "active");

  let dueUsers;
  if (targetChatId) {
    // On-demand: bypass scheduling — deliver to this user regardless of time
    dueUsers = allActive.filter(u => u.chatId === targetChatId);
  } else {
    const todayDOW = etNow.getDay(); // 0=Sun … 6=Sat
    const catchupWindowMinutes = Math.max(
      30,
      Number(CONFIG?.digest?.catchupWindowMinutes || (12 * 60))
    );
    dueUsers = allActive.filter(u => {
      const prefs = u.preferences || {};
      // Check day of week
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(todayDOW)) return false;
      // Skip if already delivered today (prevents double-delivery from 30-min cron)
      if (toETDateStr(u.last_digest_at) === todayET) return false;
      // Catch-up window: up to catchupWindowMinutes after target handles missed windows.
      // 30-min look-ahead handles cron jitter so we don't need perfect clock alignment.
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const userMinutes = dh * 60 + dm;
      let diff = nowMinutes - userMinutes; // positive = we're past target time
      // Midnight wraparound: e.g. target 23:45, now 00:05 → diff should be +20 not -1420
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      return diff >= -30 && diff <= catchupWindowMinutes;
    });
  }

  // Log scheduling decisions on every cron fire — visible even on no-op runs.
  // Helps diagnose missed deliveries without needing --diagnose flags.
  if (!targetChatId && allActive.length > 0) {
    const parts = allActive.map(u => {
      const prefs = u.preferences || {};
      const alreadyToday = toETDateStr(u.last_digest_at) === todayET;
      if (alreadyToday) return `${u.email || u.chatId}: alreadyToday`;
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      let diff = nowMinutes - (dh * 60 + dm);
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      const isDue = dueUsers.some(d => d.chatId === u.chatId);
      return `${u.email || u.chatId}: target=${prefs.delivery_time} diff=${diff >= 0 ? "+" : ""}${diff}min → ${isDue ? "DUE" : "skip"}`;
    });
    log(`[schedule] ${todayET} ${etNow.getHours().toString().padStart(2,"0")}:${etNow.getMinutes().toString().padStart(2,"0")} ET — ${parts.join(" | ")}`);
  }

  if (dueUsers.length === 0) {
    if (targetChatId) {
      log(`No active user found for on-demand chatId ${targetChatId}`);
      process.exit(2);
    }
    process.exit(0); // no users due this window
  }

  if (dryRun) {
    const dueList = dueUsers.map((u) => u.email || u.chatId).filter(Boolean);
    log(`🧪 Dry run: ${dueUsers.length} user(s) due${dueList.length ? ` -> ${dueList.join(", ")}` : ""}`);
    process.exit(0);
  }

  if (targetChatId) log(`=== SignalBrief on-demand for ${targetChatId} ===`);
  else log(`=== SignalBrief starting — ${dueUsers.length} user(s) due ===`);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: CONFIG.user.timezone,
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: CONFIG.user.timezone,
  });
  const digestDateKey = etDateKey(now);
  const publicDigestUrl = buildPublicDigestUrl(digestDateKey);
  const requestedCounts = dueUsers
    .map((u) => Number(u?.preferences?.items_per_digest))
    .filter((n) => Number.isFinite(n) && n > 0);
  const selectionTarget = Math.max(
    Number(CONFIG.digest.itemCount || 7),
    requestedCounts.length ? Math.max(...requestedCounts) : 0
  );
  const tagPriority = {};
  for (const u of dueUsers) {
    for (const topic of (u.topics || [])) {
      const key = normalizeTopicToken(topic);
      if (!key) continue;
      tagPriority[key] = (tagPriority[key] || 0) + 1;
    }
  }

  // For on-demand single-user runs, only fetch topics the user actually tracks.
  // For scheduled multi-user runs, fetch all 17 standard topics.
  let topicsToFetch = CONFIG.topics;
  if (targetChatId && dueUsers.length === 1) {
    const userStandardTopics = new Set(
      (dueUsers[0].topics || []).filter(t => !t.startsWith("custom_"))
    );
    if (userStandardTopics.size > 0) {
      topicsToFetch = CONFIG.topics.filter(t => userStandardTopics.has(t.tag));
      log(`On-demand: fetching ${topicsToFetch.length}/${CONFIG.topics.length} topic(s) for user`);
    }
  }
  const standardFetchCallsPlanned = topicsToFetch.length;
  let standardFetchCalls = 0;
  let customFetchCalls = 0;

  // Fetch standard topics in parallel
  const allResults = await Promise.all(topicsToFetch.map(fetchTopicNews));
  standardFetchCalls = allResults.reduce((sum, rows) => sum + Number(rows?.__apiCalls || 0), 0);
  let allItems = allResults.flat();
  log(`Fetched ${allItems.length} raw items`);
  const allStandardEmpty = standardFetchCallsPlanned > 0
    && allResults.every((rows) => Array.isArray(rows) && rows.length === 0);
  if (allStandardEmpty) {
    await emitDigestIncident(
      "zero-standard-results",
      `All ${standardFetchCallsPlanned} standard topic fetches returned zero items`,
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
  }

  // Fetch custom topics for due users.
  // Scale cap with user count so custom coverage doesn't collapse as users grow.
  // Rank by demand frequency (how many due users follow each custom topic).
  const customTopicCounts = new Map();
  for (const u of dueUsers) {
    for (const topic of (u.topics || [])) {
      const topicRaw = String(topic || "");
      if (!topicRaw.startsWith("custom_")) continue;
      customTopicCounts.set(topicRaw, (customTopicCounts.get(topicRaw) || 0) + 1);
    }
  }
  const configuredMaxCustomFetch = Number(CONFIG.digest.maxCustomFetchPerRun);
  const dynamicCustomFetchCap = Number.isFinite(configuredMaxCustomFetch) && configuredMaxCustomFetch > 0
    ? configuredMaxCustomFetch
    : Math.min(18, Math.max(6, Math.ceil(dueUsers.length / 4)));
  const rankedCustomTopicSlugs = [...customTopicCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([slug]) => slug);
  const customTopicSlugs = rankedCustomTopicSlugs.slice(0, dynamicCustomFetchCap);
  if (rankedCustomTopicSlugs.length > customTopicSlugs.length) {
    log(`Custom topic fetch cap hit: ${customTopicSlugs.length}/${rankedCustomTopicSlugs.length} topics this run`);
  }
  let customTags = [];

  if (customTopicSlugs.length > 0) {
    const customFetchTargets = customTopicSlugs.map(slug => {
      const keyword = slug.replace(/^custom_/, "").replace(/_/g, " ").trim();
      const queries = buildCustomTopicQueries(keyword);
      return {
        tag: keyword.toUpperCase(),   // e.g. "PFIZER", "GLP-1"
        queries: queries.length ? queries : [`${keyword} business strategy developments last 48 hours`],
        isCustom: true,
      };
    });
    customTags = customFetchTargets.map((t) => t.tag);
    customFetchCalls = 0;
    log(`Fetching ${customFetchTargets.length} custom topic(s): ${customFetchTargets.map(t => t.tag).join(", ")}`);
    const customResults = await Promise.all(customFetchTargets.map(fetchTopicNews));
    customFetchCalls = customResults.reduce((sum, rows) => sum + Number(rows?.__apiCalls || 0), 0);
    const customItems = customResults.flat();
    log(`Fetched ${customItems.length} custom topic item(s)`);
    // Prepend so selectItems() sees custom items first — they have unique tags so they
    // won't crowd out standard items; prepending ensures they're selected
    allItems.unshift(...customItems);
  }
  if (allItems.length === 0) {
    await emitDigestIncident(
      "zero-raw-items",
      "No raw items available after standard and custom fetches",
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
  }

  const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
  const dedupRes = dedupAgainstRecentArchives(allItems, {
    days: crossDayDedupDays,
    targetCount: selectionTarget,
  });
  allItems = dedupRes.items;
  if (dedupRes.removed > 0) {
    log(`Cross-day dedup removed ${dedupRes.removed} repeat item(s) using last ${dedupRes.archive_days_used} day(s) of archive history`);
  }

  const configuredMaxCustom = Number(CONFIG.digest.maxCustomItemsPerRun);
  const defaultMaxCustom = customTags.length > 0
    ? Math.max(1, Math.floor(selectionTarget * 0.4))
    : 0;
  const maxCustomItems = Number.isFinite(configuredMaxCustom) && configuredMaxCustom >= 0
    ? configuredMaxCustom
    : defaultMaxCustom;
  let selected = selectItems(allItems, {
    maxItems: selectionTarget,
    maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
    customTags,
    maxCustomItems,
    tagPriority,
    maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
  });
  if (selected.length === 0) {
    const fallbackPool = loadRecentArchiveItems(5);
    if (fallbackPool.length > 0) {
      selected = selectItems(fallbackPool, {
        maxItems: selectionTarget,
        maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
        customTags: [],
        maxCustomItems: 0,
        tagPriority,
        maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
      });
      log(`⚠️ Live fetch produced no selectable items; using archive fallback pool (${fallbackPool.length} items, selected=${selected.length})`);
      await emitDigestIncident(
        "archive-fallback-engaged",
        `Live fetch produced zero selectable items; archive fallback selected ${selected.length}`,
        {
          mode: runMode,
          due_users: dueUsers.length,
          standard_topics: standardFetchCallsPlanned,
          selected_items: selected.length,
        }
      );
    }
  }
  if (selected.length === 0) {
    await emitDigestIncident(
      "no-selectable-items",
      "No selectable items after archive fallback; digest run aborted",
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
    throw new Error("No items available from live fetch or archive fallback; digest aborted");
  }
  log(`Selected ${selected.length} items (target=${selectionTarget}, customCap=${maxCustomItems}, sourceCap=${Number(CONFIG.digest.maxItemsPerSourceDomain || 2)})`);

  const { items: enriched, usage: claudeUsage } = await enrichItems(selected);

  // Quick scan & subject
  const quickScan = enriched
    .map((i) => i.headline.split(":")[0].split("—")[0].trim())
    .join(" &nbsp;·&nbsp; ");
  const topThree = enriched.slice(0, 3)
    .map((i) => i.headline.split(":")[0].split("—")[0].trim().slice(0, 28));
  const subject = `SignalBrief — ${shortDate} | ${topThree.join(", ")}`;

  // Archive once per run (shared, date-keyed) — uses full enriched set before user filtering
  // Must happen before per-user loop so the archive reflects all fetched items, not one user's filtered view
  saveToArchive(now, enriched, dateStr, quickScan, { overwrite: !targetChatId });

  log(`Delivering to ${dueUsers.length} user(s)...`);
  const deliveredUsers = [];
  const failedUsers = [];
  const engagementEvents = loadEngagementEvents({ max_age_days: 45, dedupe: true });

  for (let u of dueUsers) {
    try {
      const autoLearning = applyAutoTopicLearning(u, {
        events: engagementEvents,
        now,
        date_key: digestDateKey,
        run_id: runId,
      });
      if (autoLearning.changed) {
        writeUser(u.chatId, u);
        const changes = autoLearning.adjustments
          .map((a) => `${a.topic}:${a.prev}->${a.next}`)
          .join(", ");
        log(`  [auto-learning] ${u.email || u.chatId}: ${changes} (events=${autoLearning.processed_events})`);
      }
      const learningSummary = autoLearning.changed
        ? buildLearningSummary(autoLearning.adjustments, 2)
        : "";

      const prefs = u.preferences || {};

      // 1. Filter items by user's topic list (if set)
      let wasFiltered = false;
      let userItems = enriched;
      let standardTopicsLower = [];
      let specialistMode = false;
      if (u.topics && u.topics.length >= 1) {
        // Standard topics: match against article tag
        standardTopicsLower = u.topics
          .filter(t => !String(t).toLowerCase().startsWith("custom_"))
          .map(t => normalizeTopicToken(t))
          .filter(Boolean);
        specialistMode = standardTopicsLower.length > 0 && standardTopicsLower.length <= 2;
        const standardTopicSet = new Set(standardTopicsLower);
        // Custom topics: match keyword against headline + summary text
        const customKeywords = u.topics
          .filter((t) => {
            const raw = String(t || "");
            const normalized = normalizeTopicToken(raw);
            return raw.toLowerCase().startsWith("custom_") || !standardTopicSet.has(normalized);
          })
          .map(t => normalizeTopicToken(t))
          .filter(Boolean);
        const filtered = enriched.filter(item => {
          const tag = normalizeTopicToken(item.tag || "");
          const text = normalizeMatchText(`${item.headline || ""} ${item.summary || ""}`);
          const tagMatch = standardTopicsLower.some(t => topicsRelated(tag, t));
          const customMatch = customKeywords.some((kw) => customKeywordMatches(kw, text, tag));
          return tagMatch || customMatch;
        });
        const MIN_ITEMS = 3;
        if (filtered.length >= MIN_ITEMS) {
          // Enough topic matches — use them directly
          userItems = filtered;
          wasFiltered = true;
        } else if (filtered.length >= 1) {
          // Keep strict preference fidelity: avoid padding with unrelated items.
          userItems = filtered;
          wasFiltered = true;
        } else if (specialistMode) {
          // Sparse-topic users should not receive unrelated filler when no direct matches exist.
          userItems = [];
          wasFiltered = true;
        } else {
          // Zero topic matches — full fallback (banner reflects this)
          userItems = enriched;
          wasFiltered = false;
        }
      }

      // 2. Score by relevance (free — uses baseScore + local topic match + user weight adjustments)
      const weights = u.topic_weights || {};
      const hasWeights = Object.values(weights).some(w => w !== 0);

      // Log pre-sort order when user has weight adjustments — lets us verify ranking is working
      if (hasWeights) {
        log(`  [weights] ${u.email || u.chatId}: ${JSON.stringify(weights)}`);
        log(`  [pre-sort] ${userItems.map(i => `${i.tag}(${i.baseScore})`).join(", ")}`);
      }

      userItems = applyRelevanceScores(userItems, u.topics || [], weights, {
        specialistMode,
      });
      userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

      const minBaseScoreForFinal = Number(CONFIG.digest.minBaseScoreForFinal || 6.5);
      const requestedCount = Number(prefs.items_per_digest || CONFIG.digest.itemCount || 5);
      const minStrongItems = Math.max(2, Math.min(requestedCount, 4));
      const stronger = userItems.filter((i) =>
        Number(i?.baseScore || 0) >= minBaseScoreForFinal
        || (Array.isArray(i?.why_shown) && i.why_shown.includes("custom_keyword"))
      );
      if (stronger.length >= minStrongItems) {
        userItems = stronger;
      }

      if (hasWeights) {
        log(`  [post-sort] ${userItems.map(i => `${i.tag}(${i.relevanceScore})`).join(", ")}`);
      }

      // 3. Trim to user's items_per_digest (top-N by relevance)
      const count = requestedCount;
      userItems = userItems.slice(0, count);

      // Hard guardrail: never send an empty digest.
      if (userItems.length === 0) {
        const emergencyCount = Math.max(1, Math.min(3, count));
        const emergency = applyRelevanceScores(enriched, u.topics || [], weights, {
          specialistMode: false,
        })
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, emergencyCount);
        if (emergency.length > 0) {
          userItems = emergency;
          wasFiltered = false;
          log(`⚠️ Emergency fallback items used for ${u.email || u.chatId} (count=${emergency.length})`);
        }
      }
      if (userItems.length === 0) {
        throw new Error("No deliverable items after emergency fallback");
      }

      // 4. Apply depth — strip wim if user wants headlines only or one-liner
      const depth = prefs.depth || "full";
      if (depth === "headline_only" || depth === "headlines" || depth === "scan") {
        userItems = userItems.map(i => ({ ...i, wim: null }));
      } else if (depth === "oneliner" || depth === "headline_plus_oneliner") {
        // Prefer model-authored brief sentence; fallback to first sentence of wim.
        userItems = userItems.map(i => ({
          ...i,
          wim: i.wim_brief
            ? i.wim_brief
            : (i.wim ? i.wim.replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "." : null)
        }));
      }

      const previousDigestItems = Array.isArray(u.last_digest_items) ? u.last_digest_items : [];
      const digestQuality = computeDigestQualityScore({
        items: userItems,
        user: u,
        previous_items: previousDigestItems,
      });
      const userDigestId = buildDigestId(digestDateKey, u.chatId);
      const eventItems = userItems.map((item, idx) => ({
        index: idx + 1,
        headline: item?.headline || null,
        url: item?.url || null,
        tag: item?.tag || null,
        base_score: Number.isFinite(Number(item?.baseScore)) ? Number(item.baseScore) : null,
        topic_match: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
        relevance_score: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
      }));

      // 5. Build per-user quick scan + subject
      const userQuickScan = userItems.map((i, idx) => {
        const short = i.headline.split(":")[0].split("—")[0].trim();
        return `<tr><td style="font-size:11px;color:#9CA3AF;font-weight:600;padding:4px 10px 4px 0;vertical-align:top;line-height:1.5;white-space:nowrap;">${idx + 1}</td><td style="font-size:10px;font-weight:700;letter-spacing:0.05em;color:#2563EB;text-transform:uppercase;white-space:nowrap;padding:4px 14px 4px 0;vertical-align:top;line-height:1.5;">${i.tag}</td><td style="font-size:13px;color:#374151;padding:4px 0;vertical-align:top;line-height:1.5;">${short}</td></tr>`;
      }).join("\n");
      // Clean subject: first name + tagline (headlines get cut off and look ugly)
      const uFirstName = ((u.name || "").split(" ")[0]) || u.email.split("@")[0];
      // Admin-triggered sends can force regular framing (no first-briefing subject/banner).
      const isFirstDigest = !u.welcome_email_sent && !suppressWelcome;
      const userSubject = isFirstDigest
        ? `Welcome to SignalBrief, ${uFirstName} 👋 — your first briefing is ready`
        : `SignalBrief — ${shortDate} | ${uFirstName}'s daily signal across AI, strategy, and business`;

      // 5. Deliver
      let delivered = false;
      if (u.chatId && !u.chatId.startsWith("email-") && prefs.telegram_enabled !== false) {
        const userTelegram = formatTelegram(userItems, shortDate, u, {
          digestQuality,
          learningSummary,
          publicDigestUrl,
        });
        const userKeyboard = buildDigestInlineKeyboard(userItems);
        try {
          await sendTelegram(userTelegram, u.chatId, { reply_markup: userKeyboard });
          appendEngagementEvent({
            event_type: "digest_sent",
            event_key: `digest_sent:${userDigestId}:telegram`,
            date_et: digestDateKey,
            user_chat_id: String(u.chatId),
            user_email: u.email || null,
            digest_id: userDigestId,
            run_id: runId,
            channel: "telegram",
            source: targetChatId ? "on-demand" : "scheduled-job",
            metadata: {
              item_count: userItems.length,
              depth,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              quality_components: digestQuality.components,
              items: eventItems,
            },
          });
          delivered = true;
        } catch (err) {
          log(`⚠️ Telegram delivery failed for ${u.email || u.chatId}: ${err.message}`);
        }
      }
      if (u.email && prefs.email_enabled !== false) {
        const userEmailHtml = buildEmail(
          userItems,
          dateStr,
          userQuickScan,
          u.token || "",
          isFirstDigest,
          wasFiltered,
          depth,
          u,
          digestDateKey,
          userDigestId,
          {
            digestQuality,
            learningSummary,
            publicDigestUrl,
          }
        );
        try {
          await sendEmail(userSubject, userEmailHtml, u.email, u.token || null);
          appendEngagementEvent({
            event_type: "digest_sent",
            event_key: `digest_sent:${userDigestId}:email`,
            date_et: digestDateKey,
            user_chat_id: String(u.chatId),
            user_email: u.email || null,
            digest_id: userDigestId,
            run_id: runId,
            channel: "email",
            source: targetChatId ? "on-demand" : "scheduled-job",
            metadata: {
              item_count: userItems.length,
              depth,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              quality_components: digestQuality.components,
              items: eventItems,
            },
          });
          delivered = true;
          if (isFirstDigest || suppressWelcome) u.welcome_email_sent = true; // avoid future welcome framing after manual/admin send
        } catch (err) {
          log(`⚠️ Email delivery failed for ${u.email || u.chatId}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 600)); // Resend: 2 req/sec limit
      }
      if (!delivered) throw new Error("no channels succeeded");

      // 6. Persist state
      u.digests_received = (u.digests_received || 0) + 1;
      u.last_digest_at = now.toISOString();
      u.last_digest_items = userItems.map(i => ({
        headline: i.headline,
        url: i.url,
        tag: i.tag,
        source: i.source,
        source_domain: i.source_domain || parseSourceDomain(i),
        why_shown: Array.isArray(i.why_shown) ? i.why_shown : [],
      }));
      // Track which dates this user received a digest (for user-scoped archive)
      const todayDateKey = etDateKey(now);
      if (!u.digest_dates) u.digest_dates = [];
      if (!u.digest_dates.includes(todayDateKey)) u.digest_dates.push(todayDateKey);
      const history = Array.isArray(u.quality_history) ? u.quality_history.slice() : [];
      history.push({
        digest_id: userDigestId,
        date_et: digestDateKey,
        ts_utc: now.toISOString(),
        score: digestQuality.score,
        band: digestQuality.band,
        components: digestQuality.components,
      });
      if (history.length > 120) history.splice(0, history.length - 120);
      u.quality_history = history;
      u.last_quality_score = history[history.length - 1] || null;
      writeUser(u.chatId, u);
      deliveredUsers.push({ id: u.email || u.chatId, on_demand: !!targetChatId });

      log(`✅ Delivered to ${u.email || u.chatId} (${userItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)})`);
    } catch (err) {
      failedUsers.push({ id: u.email || u.chatId, error: err.message, on_demand: !!targetChatId });
      log(`❌ Failed delivery to ${u.email || u.chatId}: ${err.message}`);
    }
  }

  // ── Cost tracking ─────────────────────────────────────────────────────────
  const perplexityCalls = standardFetchCalls + customFetchCalls;
  const perplexityCost  = perplexityCalls * PERPLEXITY_COST_PER_CALL;
  const claudeCost = (claudeUsage.input_tokens  / 1_000_000 * CLAUDE_HAIKU_IN_PER_MTOK)
                   + (claudeUsage.output_tokens / 1_000_000 * CLAUDE_HAIKU_OUT_PER_MTOK);
  const totalCost = perplexityCost + claudeCost;

  appendCostLog({
    date:                  now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), // ET date (not UTC)
    run_at:                now.toISOString(),
    run_at_et:             now.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }),
    on_demand:             !!targetChatId,
    perplexity_calls:      perplexityCalls,
    perplexity_calls_standard: standardFetchCalls,
    perplexity_calls_custom: customFetchCalls,
    perplexity_cost_usd:   parseFloat(perplexityCost.toFixed(5)),
    claude_tokens_in:      claudeUsage.input_tokens,
    claude_tokens_out:     claudeUsage.output_tokens,
    claude_cost_usd:       parseFloat(claudeCost.toFixed(6)),
    total_cost_usd:        parseFloat(totalCost.toFixed(5)),
    users_targeted:        dueUsers.length,
    users_served:          deliveredUsers.length,
    per_user:              deliveredUsers,
    per_user_failed:       failedUsers,
  });
  log(`💰 Run cost: $${totalCost.toFixed(4)} (Perplexity $${perplexityCost.toFixed(3)} · Claude in=${claudeUsage.input_tokens} out=${claudeUsage.output_tokens} $${claudeCost.toFixed(4)})`);

  log(`=== SignalBrief complete — ${deliveredUsers.length}/${dueUsers.length} user(s) delivered ===`);
  if (targetChatId && deliveredUsers.length === 0) process.exit(3);
}

process.on("exit", () => {
  releaseDigestLock();
});
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    releaseDigestLock();
    process.exit(1);
  });
});

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
