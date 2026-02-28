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
const { readUser, writeUser } = require("./store");

const LOG_FILE = "/tmp/signalbrief.log";

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
    req.write(data);
    req.end();
  });
}

async function refreshGoogleToken() {
  const formData = new URLSearchParams({
    client_id: CONFIG.keys.googleClientId,
    client_secret: CONFIG.keys.googleClientSecret,
    refresh_token: CONFIG.keys.googleRefreshToken,
    grant_type: "refresh_token",
  }).toString();
  const res = await httpsPost(
    "oauth2.googleapis.com", "/token",
    { "Content-Type": "application/x-www-form-urlencoded" },
    formData, true
  );
  return res.body.access_token;
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
          content: `You are a healthcare and life sciences news researcher. 
Return ONLY a JSON array of up to 3 distinct news items from the last 48 hours.
Each item MUST include the direct article URL from your citations — not the homepage.
Format: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. statnews.com), "url": string (full direct article URL from your citations), "tag": "${topic.tag}"}]
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

  const prompt = `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants in healthcare and life sciences. Your readers work at firms like McKinsey, Deloitte, Accenture, and major health systems. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, write a "why it matters" field of exactly 2-3 sentences.

RULES — READ CAREFULLY:
1. First sentence: a sharp, specific strategic implication. Wrap it in <strong> tags. This sentence alone should make the reader think "I need to bring this up in my client meeting."
2. Second sentence: a concrete second-order effect — what moves downstream as a result? Name the specific player type, role, or market segment that feels it.
3. Third sentence (optional): a forward-looking signal — what should the reader watch for next? Only add if genuinely useful. Skip if it would be vague.

WHAT TO AVOID (these examples are WRONG — too generic):
❌ "Health systems are focusing on scalable, reliable AI technology in 2026 to improve operations, reduce clinician burden, and drive growth amid workforce shortages and tight margins." (press release rewrite)
❌ "This could have significant implications for the healthcare industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)

WHAT TO AIM FOR (these examples are RIGHT — specific and implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."
✅ "<strong>Any pipeline asset relying on accelerated approval timelines needs re-underwriting now.</strong> This is a stated policy direction from the Commissioner, not a one-off rejection. Biotech valuations with rare disease velocity assumptions should be pressure-tested against a 12-18 month slower cadence."

Return ONLY a JSON array with the same items plus a "wim" field. No markdown, no explanation.

Items:
${JSON.stringify(items.map(i => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;

  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-sonnet-4-6", max_tokens: 3000, messages: [{ role: "user", content: prompt }] }
  );

  try {
    let content = res.body?.content?.[0]?.text || "[]";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const enriched = JSON.parse(content);
    // Merge wim back onto original items (which have URLs)
    return items.map((item, i) => ({ ...item, wim: enriched[i]?.wim || "Analysis unavailable." }));
  } catch (e) {
    log(`Claude parse error: ${e.message}`);
    return items.map((i) => ({ ...i, wim: "Analysis unavailable." }));
  }
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
    `_Your daily signal across healthcare, AI, and strategy_`,
    "",
  ];
  items.forEach((item, i) => {
    const num = ["1⃣","2⃣","3⃣","4⃣","5⃣","6⃣","7⃣","8⃣"][i];
    // Strip HTML tags for Telegram, convert <strong> to *bold*
    const wim = item.wim
      .replace(/<strong>(.*?)<\/strong>/g, "*$1*")
      .replace(/<\/?[^>]+>/g, "");
    // Sharp format: headline — punchy summary line
    const summaryLine = item.summary.length > 80
      ? item.summary.slice(0, 77) + "..."
      : item.summary;
    lines.push(`${num} *[${item.tag}]* ${item.headline}`);
    lines.push(`${summaryLine}`);
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

function buildEmail(items, dateStr, quickScan) {
  const itemsHtml = items.map((item, i) => {
    const isLead = i === 0;
    const metaBadge = isLead
      ? `<span class="item-lead-badge">★ LEAD</span>`
      : `<span class="item-number">${i + 1}</span>`;
    const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;

    return `
      <div class="item${isLead ? " item-lead" : ""}">
        <div class="item-meta">
          ${metaBadge}
          <span class="item-tag">${item.tag}</span>
        </div>
        <div class="item-title">${item.headline}</div>
        <div class="item-lede">${item.summary}</div>
        <div class="item-wim-label">Why it matters</div>
        <div class="item-wim">${item.wim}</div>
        <div class="item-readmore"><a href="${linkUrl}">Read more → ${item.source}</a></div>
      </div>`;
  }).join("\n");

  return EMAIL_TEMPLATE
    .replace("Saturday, February 28, 2026", dateStr)
    .replace(
      "CHAI kills clinical AI governance labs &nbsp;·&nbsp; Cigna goes full pharmacy stack &nbsp;·&nbsp; BioNTech runs leaner ADC Phase 3 &nbsp;·&nbsp; FDA tightens rare disease bar &nbsp;·&nbsp; DOJ backs pharma on 340B",
      quickScan
    )
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

// ── 7. Send Gmail ─────────────────────────────────────────────────────────────

async function sendEmail(subject, html, toEmail) {
  const target = toEmail || CONFIG.user.email;
  log(`Sending email to ${target}...`);
  const accessToken = await refreshGoogleToken();

  const mime = [
    `To: ${target}`,
    `From: SignalBrief <jarvisjones2922@gmail.com>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join("\r\n");

  const raw = Buffer.from(mime).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const body = JSON.stringify({ raw });
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "gmail.googleapis.com",
      path: "/gmail/v1/users/me/messages/send",
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  if (res.status === 200) log("✅ Email sent");
  else log(`❌ Email failed (${res.status}): ${res.body}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  log("=== SignalBrief starting ===");

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: CONFIG.user.timezone,
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: CONFIG.user.timezone,
  });

  // Fetch all topics in parallel
  const allResults = await Promise.all(CONFIG.topics.map(fetchTopicNews));
  const allItems = allResults.flat();
  log(`Fetched ${allItems.length} raw items`);

  const selected = selectItems(allItems);
  log(`Selected ${selected.length} items`);

  const enriched = await enrichItems(selected);

  // Quick scan & subject
  const quickScan = enriched
    .map((i) => i.headline.split(":")[0].split("—")[0].trim())
    .join(" &nbsp;·&nbsp; ");
  const topThree = enriched.slice(0, 3)
    .map((i) => i.headline.split(":")[0].split("—")[0].trim().slice(0, 28));
  const subject = `SignalBrief — ${shortDate} | ${topThree.join(", ")}`;

  const emailHtml = buildEmail(enriched, dateStr, quickScan);

  // Deliver to ALL active users
  const { allUsers } = require("./store");
  const activeUsers = allUsers().filter(u => u.status === "active");
  log(`Delivering to ${activeUsers.length} user(s)...`);
  for (const u of activeUsers) {
    const userTelegram = formatTelegram(enriched, shortDate, u);
    await sendTelegram(userTelegram, u.chatId);
    if (u.email && u.preferences?.email_enabled !== false) {
      await sendEmail(subject, emailHtml, u.email);
    }
  }

  // Persist per-user state for bookmarking + tuning
  const chatId = CONFIG.user.telegramChatId;
  const user = readUser(chatId);
  user.digests_received = (user.digests_received || 0) + 1;
  user.last_digest_at = now.toISOString();
  user.last_digest_items = enriched.map(i => ({
    headline: i.headline,
    url: i.url,
    tag: i.tag,
    source: i.source,
  }));
  writeUser(chatId, user);

  log(`=== SignalBrief complete (digest #${user.digests_received}) ===`);
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
