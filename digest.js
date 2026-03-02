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

const LOG_FILE = "/tmp/signalbrief.log";
const COST_LOG = path.join(__dirname, "data", "cost-log.json");
const BASE_URL = process.env.BASE_URL || "https://getsignalbrief.com";

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

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
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

// ── 1. Fetch news via Perplexity Sonar (with real URLs from citations) ───────

async function fetchTopicNews(topic) {
  log(`Fetching: ${topic.tag}`);
  const query = topic.queries[0];

  const res = await httpsPost(
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

  // Extract article URLs from Perplexity citations if available
  const citations = res.body?.citations || [];

  try {
    let content = res.body?.choices?.[0]?.message?.content || "[]";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let items = JSON.parse(content);

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

    return items;
  } catch (e) {
    log(`Parse error for ${topic.tag}: ${e.message}`);
    return [];
  }
}

// ── 2. Select best 7 (interleaved, max 2 per tag) ───────────────────────────

function selectItems(allItems) {
  const seen = new Set();
  const deduped = allItems.filter((item) => {
    const key = item.headline.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tagCounts = {};
  const selected = [];
  const pool = [...deduped];

  while (selected.length < CONFIG.digest.itemCount && pool.length > 0) {
    const lastTag = selected.length > 0 ? selected[selected.length - 1].tag : null;
    const idx = pool.findIndex((item) => {
      const count = tagCounts[item.tag] || 0;
      return item.tag !== lastTag && count < CONFIG.digest.maxItemsPerTag;
    });
    if (idx === -1) {
      // Relax adjacency constraint if stuck
      const fallback = pool.findIndex((item) => (tagCounts[item.tag] || 0) < CONFIG.digest.maxItemsPerTag);
      if (fallback === -1) break;
      const item = pool.splice(fallback, 1)[0];
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
      selected.push(item);
    } else {
      const item = pool.splice(idx, 1)[0];
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
      selected.push(item);
    }
  }

  return selected;
}

// ── 3. Enrich with Claude (sharp consultant lens) ────────────────────────────

async function enrichItems(items) {
  log("Enriching with Claude...");

  const prompt = `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants and business professionals. Your readers work at MBB, Big 4, boutique strategy firms, corporate strategy functions, and PE/investment shops. They work across multiple industries and need to sound informed in client meetings across healthcare, tech, financial services, PE, energy, consumer, and policy. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, return two fields:

1. "wim" — a "why it matters" analysis of exactly 2-3 sentences.
   RULES:
   - First sentence: sharp, specific strategic implication. Wrap in <strong> tags. Make the reader think "I need to bring this up in my client meeting."
   - Second sentence: a concrete second-order effect — name the specific player type, role, or market segment that feels it.
   - Third sentence (optional): a forward-looking signal — what to watch for next. Skip if vague.

2. "baseScore" — a number 0.0–10.0 measuring the story's strategic importance and consultant relevance, independent of any user's topic preferences.
   - 8.5–10.0: Major development (landmark M&A, significant policy shift, key earnings miss with broad implications)
   - 7.0–8.4: Notable development (meaningful deal, regulatory move, sector-level change)
   - 5.0–6.9: Moderate interest (incremental update, early-stage signal worth watching)
   - Below 5.0: Routine or narrow-interest item

3. "implications" — one actionable sentence naming a specific role (e.g. "CFO", "deal team", "payer CMO", "PE portfolio team") and the concrete action, question, or client meeting flag this story creates. Return null if it is fully covered by the wim already.

4. "watch_next" — one forward-looking sentence: name the specific signal, filing, earnings call, or regulatory decision to monitor in the next 2–4 weeks. Start with an entity name or date. Return null if this is a one-time development with no near-term pending catalysts.

WHAT TO AVOID (too generic):
❌ "This could have significant implications for the industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)

WHAT TO AIM FOR (specific, implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."

Return ONLY a JSON array with the same items plus "wim", "baseScore", "implications", and "watch_next" fields. No markdown, no explanation.

Items:
${JSON.stringify(items.map(i => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;

  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-haiku-4-5", max_tokens: 4500, messages: [{ role: "user", content: prompt }] }
  );

  const usage = {
    input_tokens:  res.body?.usage?.input_tokens  || 0,
    output_tokens: res.body?.usage?.output_tokens || 0,
  };

  try {
    let content = res.body?.content?.[0]?.text || "[]";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const enriched = JSON.parse(content);
    // Merge wim + baseScore back onto original items (which have URLs)
    return {
      items: items.map((item, i) => ({
        ...item,
        wim:          enriched[i]?.wim || "Analysis unavailable.",
        baseScore:    typeof enriched[i]?.baseScore === "number" ? enriched[i].baseScore : 5.0,
        implications: enriched[i]?.implications || null,
        watch_next:   enriched[i]?.watch_next   || null,
      })),
      usage,
    };
  } catch (e) {
    log(`Claude parse error: ${e.message}`);
    return {
      items: items.map((i) => ({ ...i, wim: "Analysis unavailable.", implications: null, watch_next: null })),
      usage,
    };
  }
}

// ── 3b. Score items by relevance (zero extra API cost) ───────────────────────
// baseScore comes from enrichItems (already paid for in that call).
// topicMatch is computed locally — free.
// finalScore = baseScore (60%) + topicMatch (40%) + weightBonus (user preference)
//
// topic_weights (from "more X" / "less X" commands) are keyed by whatever string
// Claude returns from intent parsing (e.g., "AI", "healthcare") — not necessarily
// the canonical tag. matchWeightToTag() does case-insensitive substring matching
// so "AI" matches "AI×TECH" and "health" matches "HEALTHCARE".
// Each weight unit = ±0.5 points on the 0–10 scale (range: -5 to +5 → -2.5 to +2.5).

function scoreColor(score) {
  if (score >= 8.5) return { bg: "#16A34A", text: "#fff" };    // strong green
  if (score >= 7.0) return { bg: "#22C55E", text: "#fff" };    // green
  if (score >= 5.0) return { bg: "#EAB308", text: "#111827" }; // yellow
  if (score >= 3.5) return { bg: "#F97316", text: "#fff" };    // orange
  return { bg: "#EF4444", text: "#fff" };                       // red
}

function computeTopicMatch(item, userTopics) {
  const tagLower = (item.tag || "").toLowerCase();
  const topicsLower = (userTopics || []).map(t => t.toLowerCase());
  if (topicsLower.some(t => t === tagLower)) return 10;           // exact
  if (topicsLower.some(t => tagLower.includes(t) || t.includes(tagLower))) return 7; // partial
  return 3;                                                        // unrelated
}

// Find the total weight adjustment for a given item tag from the user's topic_weights map.
// Weight keys may be partial/informal ("AI" → "AI×TECH"), so we fuzzy-match.
function matchWeightToTag(tag, topicWeights) {
  if (!topicWeights || typeof topicWeights !== "object") return 0;
  const tagLower = tag.toLowerCase();
  let total = 0;
  for (const [key, w] of Object.entries(topicWeights)) {
    if (!w) continue;
    const keyLower = key.toLowerCase();
    if (tagLower === keyLower || tagLower.includes(keyLower) || keyLower.includes(tagLower)) {
      total += w;
    }
  }
  return total;
}

function applyRelevanceScores(items, userTopics, topicWeights = {}) {
  return items.map(item => {
    const topicMatch  = computeTopicMatch(item, userTopics);
    const base        = typeof item.baseScore === "number" ? item.baseScore : 5.0;
    const weight      = matchWeightToTag(item.tag, topicWeights);
    const weightBonus = weight * 0.5; // ±0.5 pts per "more"/"less" step
    const raw         = base * 0.6 + topicMatch * 0.4 + weightBonus;
    return { ...item, relevanceScore: Math.min(10, Math.max(0, Math.round(raw * 10) / 10)) };
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

function formatTelegram(items, dateStr, state) {
  const lines = [
    `☀️ *SignalBrief — ${dateStr}*`,
    `_Your daily signal across AI, strategy, and business_`,
    "",
  ];
  items.forEach((item, i) => {
    const num = ["1⃣","2⃣","3⃣","4⃣","5⃣","6⃣","7⃣","8⃣"][i];
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
    lines.push("");
  });
  lines.push(buildCommandMenu(state));
  return lines.join("\n");
}

// ── 5. Build HTML email ──────────────────────────────────────────────────────

function buildEmail(items, dateStr, quickScan, userToken = "", isFirstDigest = false, wasFiltered = true, depth = "headline_plus_why", user = null) {
  const filterNote = wasFiltered
    ? "filtered to your selected topics"
    : "today's top signals across all areas";

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
  const itemsHtml = items.map((item, i) => {
    const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;
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

    // Lead item (first) gets blue left border accent
    const isLead = i === 0;
    const itemStyle = isLead
      ? "padding:32px 0;border-bottom:1px solid #E5E7EB;border-left:3px solid #2563EB;padding-left:16px;margin-left:-16px;"
      : "padding:32px 0;border-bottom:1px solid #E5E7EB;";

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
        <div style="font-size:13px;"><a href="${linkUrl}" style="color:#2563EB;text-decoration:none;font-weight:500;">Read more → ${item.source}</a></div>
      </div>`;
  }).join("\n");

  const readMins = Math.max(2, Math.ceil(items.length * 0.6));

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
    .replace("{{ITEM_COUNT}}", `${items.length} signals · ${readMins} min read`)
    .replace("{{QUICK_SCAN}}", quickScan)
    .replace("{{WELCOME_BANNER}}", welcomeBanner)
    .replace("{{SETTINGS_FOOTER}}", settingsFooter)
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace(/\{\{SETTINGS_TOKEN\}\}/g, userToken)
    .replace(
      /<!-- Items -->[\s\S]*<!-- Footer -->/,
      `<!-- Items -->\n    <div class="items">\n${itemsHtml}\n    </div>\n\n    <!-- Footer -->`
    );
}

// ── 6. Send via SignalBrief bot ───────────────────────────────────────────────

async function sendTelegram(text, chatId) {
  const targetId = chatId || CONFIG.user.telegramChatId;
  log(`Sending Telegram to ${targetId}...`);
  const token = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
  const res = await httpsPost(
    "api.telegram.org", `/bot${token}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: targetId, text, parse_mode: "Markdown", disable_web_page_preview: false }
  );
  if (res.body?.ok) log(`✅ Telegram sent to ${targetId}`);
  else log(`❌ Telegram failed: ${JSON.stringify(res.body)}`);
}

// ── 7. Send Email (via mailer.js — Resend if configured, Gmail fallback) ──────

async function sendEmail(subject, html, toEmail, token = null) {
  const target = toEmail || CONFIG.user.email;
  log(`Sending email to ${target}...`);
  const result = await sendEmailViaMailer(target, subject, html, token);
  if (result.ok) log(`✅ Email sent via ${result.via}`);
  else log(`❌ Email failed`);
}

// ── Archive ───────────────────────────────────────────────────────────────────

function saveToArchive(date, items, dateStr, quickScan, opts = {}) {
  const { overwrite = false } = opts;
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
  const key = etDateKey(date);
  const file = path.join(archiveDir, `${key}.json`);
  if (fs.existsSync(file) && !overwrite) return;
  const entry = {
    date: key,
    dateStr,
    quickScan,
    items: items.map(i => ({
      tag:         i.tag,
      headline:    i.headline,
      summary:     i.summary,
      wim:         i.wim,
      implications: i.implications || null,
      watch_next:  i.watch_next || null,
      url:         i.url,
      source:      i.source,
      baseScore:   i.baseScore != null ? i.baseScore : null,
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
  const suppressWelcome = args.includes("--suppressWelcome");

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
    dueUsers = allActive.filter(u => {
      const prefs = u.preferences || {};
      // Check day of week
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(todayDOW)) return false;
      // Skip if already delivered today (prevents double-delivery from 30-min cron)
      if (toETDateStr(u.last_digest_at) === todayET) return false;
      // Catch-up window: up to 4 hours after target handles Mac sleep/missed windows.
      // 30-min look-ahead handles cron jitter so we don't need perfect clock alignment.
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const userMinutes = dh * 60 + dm;
      let diff = nowMinutes - userMinutes; // positive = we're past target time
      // Midnight wraparound: e.g. target 23:45, now 00:05 → diff should be +20 not -1420
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      return diff >= -30 && diff <= 4 * 60;
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

  if (dueUsers.length === 0) process.exit(0); // no users due this window

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

  // Fetch standard topics in parallel
  const allResults = await Promise.all(topicsToFetch.map(fetchTopicNews));
  const allItems = allResults.flat();
  log(`Fetched ${allItems.length} raw items`);

  // Fetch custom topics for due users — deduplicated, capped at 5 queries per run
  // Each custom topic gets a targeted Perplexity query so it actually appears in the digest
  const customTopicSlugs = [...new Set(
    dueUsers.flatMap(u => (u.topics || []).filter(t => t.startsWith("custom_")))
  )].slice(0, 5);

  if (customTopicSlugs.length > 0) {
    const customFetchTargets = customTopicSlugs.map(slug => {
      const keyword = slug.replace(/^custom_/, "").replace(/_/g, " ").trim();
      return {
        tag: keyword.toUpperCase(),   // e.g. "PFIZER", "GLP-1"
        queries: [`${keyword} company news business strategy developments last 48 hours`],
      };
    });
    log(`Fetching ${customFetchTargets.length} custom topic(s): ${customFetchTargets.map(t => t.tag).join(", ")}`);
    const customResults = await Promise.all(customFetchTargets.map(fetchTopicNews));
    const customItems = customResults.flat();
    log(`Fetched ${customItems.length} custom topic item(s)`);
    // Prepend so selectItems() sees custom items first — they have unique tags so they
    // won't crowd out standard items; prepending ensures they're selected
    allItems.unshift(...customItems);
  }

  const selected = selectItems(allItems);
  log(`Selected ${selected.length} items`);

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

  for (const u of dueUsers) {
    try {
      const prefs = u.preferences || {};

      // 1. Filter items by user's topic list (if set)
      let wasFiltered = false;
      let userItems = enriched;
      if (u.topics && u.topics.length >= 2) {
        // Standard topics: match against article tag
        const standardTopicsLower = u.topics
          .filter(t => !t.startsWith("custom_"))
          .map(t => t.toLowerCase());
        // Custom topics: match keyword against headline + summary text
        const customKeywords = u.topics
          .filter(t => t.startsWith("custom_") || !standardTopicsLower.includes(t.toLowerCase()))
          .map(t => t.toLowerCase().replace(/^custom_/, "").replace(/_/g, " ").trim())
          .filter(Boolean);
        const filtered = enriched.filter(item => {
          const tag = (item.tag || "").toLowerCase();
          const headline = (item.headline || "").toLowerCase();
          const summary = (item.summary || "").toLowerCase();
          const tagMatch = standardTopicsLower.some(t => tag.includes(t) || t.includes(tag));
          const customMatch = customKeywords.some(kw => headline.includes(kw) || summary.includes(kw));
          return tagMatch || customMatch;
        });
        const MIN_ITEMS = 3;
        if (filtered.length >= MIN_ITEMS) {
          // Enough topic matches — use them directly
          userItems = filtered;
          wasFiltered = true;
        } else if (filtered.length >= 1) {
          // Some topic matches but below floor — pad with highest-baseScore unmatched items
          const filteredSet = new Set(filtered.map(i => i.headline));
          const topups = enriched
            .filter(i => !filteredSet.has(i.headline))
            .sort((a, b) => (b.baseScore || 5) - (a.baseScore || 5))
            .slice(0, MIN_ITEMS - filtered.length);
          userItems = [...filtered, ...topups];
          wasFiltered = true; // topics still used to prioritize
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

      userItems = applyRelevanceScores(userItems, u.topics || [], weights);
      userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

      if (hasWeights) {
        log(`  [post-sort] ${userItems.map(i => `${i.tag}(${i.relevanceScore})`).join(", ")}`);
      }

      // 3. Trim to user's items_per_digest (top-N by relevance)
      const count = prefs.items_per_digest || CONFIG.digest.itemCount;
      userItems = userItems.slice(0, count);

      // 4. Apply depth — strip wim if user wants headlines only or one-liner
      const depth = prefs.depth || "full";
      if (depth === "headline_only" || depth === "headlines" || depth === "scan") {
        userItems = userItems.map(i => ({ ...i, wim: null }));
      } else if (depth === "oneliner" || depth === "headline_plus_oneliner") {
        // Keep only first sentence of wim
        userItems = userItems.map(i => ({
          ...i,
          wim: i.wim ? i.wim.replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "." : null
        }));
      }

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
        const userTelegram = formatTelegram(userItems, shortDate, u);
        try {
          await sendTelegram(userTelegram, u.chatId);
          delivered = true;
        } catch (err) {
          log(`⚠️ Telegram delivery failed for ${u.email || u.chatId}: ${err.message}`);
        }
      }
      if (u.email && prefs.email_enabled !== false) {
        const userEmailHtml = buildEmail(userItems, dateStr, userQuickScan, u.token || "", isFirstDigest, wasFiltered, depth, u);
        try {
          await sendEmail(userSubject, userEmailHtml, u.email, u.token || null);
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
        headline: i.headline, url: i.url, tag: i.tag, source: i.source,
      }));
      // Track which dates this user received a digest (for user-scoped archive)
      const todayDateKey = etDateKey(now);
      if (!u.digest_dates) u.digest_dates = [];
      if (!u.digest_dates.includes(todayDateKey)) u.digest_dates.push(todayDateKey);
      writeUser(u.chatId, u);

      log(`✅ Delivered to ${u.email || u.chatId} (${userItems.length} items, depth=${depth})`);
    } catch (err) {
      log(`❌ Failed delivery to ${u.email || u.chatId}: ${err.message}`);
    }
  }

  // ── Cost tracking ─────────────────────────────────────────────────────────
  const perplexityCalls = CONFIG.topics.length;
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
    perplexity_cost_usd:   parseFloat(perplexityCost.toFixed(5)),
    claude_tokens_in:      claudeUsage.input_tokens,
    claude_tokens_out:     claudeUsage.output_tokens,
    claude_cost_usd:       parseFloat(claudeCost.toFixed(6)),
    total_cost_usd:        parseFloat(totalCost.toFixed(5)),
    users_served:          dueUsers.length,
    per_user:              dueUsers.map(u => ({ id: u.email || u.chatId, on_demand: !!targetChatId })),
  });
  log(`💰 Run cost: $${totalCost.toFixed(4)} (Perplexity $${perplexityCost.toFixed(3)} · Claude in=${claudeUsage.input_tokens} out=${claudeUsage.output_tokens} $${claudeCost.toFixed(4)})`);

  log(`=== SignalBrief complete — ${dueUsers.length} user(s) delivered ===`);
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
