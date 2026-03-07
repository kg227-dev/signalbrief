/**
 * SignalBrief — mailer.js
 * Handles email delivery via Resend (branded domain) with Gmail OAuth fallback.
 *
 * To activate Resend:
 * 1. Create account at resend.com (free tier: 3,000 emails/month)
 * 2. Add your domain (signalbrief.co or similar) and verify DNS
 * 3. Get API key from resend.com/api-keys
 * 4. Add to config.json: "resendApiKey": "re_..."
 * 5. Add to config.json: "fromEmail": "digest@signalbrief.co"
 * 6. Add to config.json: "fromName": "SignalBrief"
 *
 * Until configured, falls back to Gmail OAuth (jarvisjones2922@gmail.com).
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadConfig } = require("./config-provider");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const WELCOME_TEMPLATE_PATH = path.join(APP_ROOT, "templates", "welcome.html");
let welcomeTemplateCache = null;

function getBaseUrl() {
  return process.env.BASE_URL || "https://getsignalbrief.com";
}

function getConfig() {
  return loadConfig();
}

function getConfigKeys() {
  const config = getConfig();
  return config && typeof config.keys === "object" ? config.keys : {};
}

function loadWelcomeTemplate() {
  if (welcomeTemplateCache !== null) return welcomeTemplateCache;
  try {
    welcomeTemplateCache = fs.readFileSync(WELCOME_TEMPLATE_PATH, "utf8");
    return welcomeTemplateCache;
  } catch (err) {
    const wrapped = new Error(`[mailer] failed to load welcome template (${WELCOME_TEMPLATE_PATH}): ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

// ── HMAC helpers (legacy unsubscribe bridge) ───────────────────────────────────
// Keeps backward compatibility for previously issued signed email-based
// unsubscribe links while runtime converges on token-based unsubscribe URLs.
function _unsubSecret() {
  const keys = getConfigKeys();
  return (keys.anthropic || "").slice(-32) || "signalbrief-unsub-secret";
}

function signUnsubEmail(email) {
  return crypto.createHmac("sha256", _unsubSecret())
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 16);
}

function normalizeBaseUrl(rawBaseUrl) {
  const fallback = String(getBaseUrl() || "").trim() || "https://getsignalbrief.com";
  const raw = String(rawBaseUrl || fallback).trim() || fallback;
  return raw.replace(/\/+$/, "");
}

function buildUnsubscribeUrl(to, token = null) {
  const root = normalizeBaseUrl(getBaseUrl());
  if (token) return `${root}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  // Token-less emails are treated as transactional/non-settings entrypoints.
  return `${root}/settings`;
}

// digestId path encoding scheme for /t/:digestId/:token/o.gif:
// base64url(utf8("YYYY-MM-DD:chatId")) as a single path segment.
function encodeDigestIdParam(digestId) {
  return Buffer.from(String(digestId || "").trim(), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildOpenTrackingPixel(digestId, token, baseUrl = null) {
  const digestParam = encodeDigestIdParam(digestId);
  const tokenParam = encodeURIComponent(String(token || "").trim());
  const root = normalizeBaseUrl(baseUrl || getBaseUrl());
  const src = `${root}/t/${digestParam}/${tokenParam}/o.gif`;
  return `<img src="${src}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />`;
}

// ── Resend delivery ───────────────────────────────────────────────────────────

async function sendViaResend(to, subject, html, token = null) {
  const keys = getConfigKeys();
  const apiKey = keys.resendApiKey;
  const fromEmail = keys.fromEmail || "digest@signalbrief.co";
  const fromName = keys.fromName || "SignalBrief";
  const unsubUrl = buildUnsubscribeUrl(to, token);
  const listHeaders = {
    "List-Unsubscribe": `<${unsubUrl}>`,
  };
  if (token) {
    listHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const body = JSON.stringify({
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject,
    html,
    headers: listHeaders,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let out = "";
      res.on("data", c => out += c);
      res.on("end", () => {
        const data = JSON.parse(out);
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve({ ok: true, id: data.id });
        } else {
          resolve({ ok: false, error: data.message || out });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Gmail OAuth fallback ──────────────────────────────────────────────────────

async function refreshGoogleToken() {
  const keys = getConfigKeys();
  const formData = new URLSearchParams({
    client_id: keys.googleClientId,
    client_secret: keys.googleClientSecret,
    refresh_token: keys.googleRefreshToken,
    grant_type: "refresh_token",
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(formData) },
    }, (res) => {
      let out = "";
      res.on("data", c => out += c);
      res.on("end", () => resolve(JSON.parse(out).access_token));
    });
    req.on("error", reject);
    req.write(formData);
    req.end();
  });
}

async function sendViaGmail(to, subject, html, token = null) {
  const keys = getConfigKeys();
  const accessToken = await refreshGoogleToken();
  const fromEmail = "jarvisjones2922@gmail.com";
  const fromName = keys.fromName || "SignalBrief";
  const unsubUrl = buildUnsubscribeUrl(to, token);

  const mimeLines = [
    `To: ${to}`,
    `From: ${fromName} <${fromEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `List-Unsubscribe: <${unsubUrl}>`,
    ``,
    html,
  ];
  if (token) {
    mimeLines.splice(6, 0, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }
  const mime = mimeLines.join("\r\n");

  const raw = Buffer.from(mime).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const body = JSON.stringify({ raw });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "gmail.googleapis.com",
      path: "/gmail/v1/users/me/messages/send",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let out = "";
      res.on("data", c => out += c);
      res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main send function ────────────────────────────────────────────────────────

async function sendEmail(to, subject, html, token = null) {
  const keys = getConfigKeys();
  // Use Resend if configured, otherwise Gmail
  if (keys.resendApiKey) {
    const result = await sendViaResend(to, subject, html, token);
    if (result.ok) return { ok: true, via: "resend" };
    console.error(`Resend failed (${result.error}), falling back to Gmail...`);
  }

  const result = await sendViaGmail(to, subject, html, token);
  return { ok: result.ok, via: "gmail" };
}

function firstName(value, fallback = "there") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.split(/\s+/)[0] || fallback;
}

function topicLabel(topic) {
  const raw = String(topic || "").trim();
  if (!raw) return "";
  if (raw.startsWith("custom_")) {
    return raw.replace(/^custom_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return raw;
}

function topicListForUser(user) {
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const labels = topics.map(topicLabel).filter(Boolean);
  if (!labels.length) return "your selected topics";
  return labels.join(", ");
}

function deliveryTimeLabelEt(user) {
  const prefs = user?.preferences || {};
  const [hRaw, mRaw] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const h = Number.isFinite(hRaw) ? hRaw : 7;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm} ET`;
}

function profileLinks(user) {
  const token = encodeURIComponent(String(user?.token || "").trim());
  const root = normalizeBaseUrl(getBaseUrl());
  return {
    settings: `${root}/settings?token=${token}`,
    pause: `${root}/api/pause?token=${token}`,
    reactivate: `${root}/api/reactivate?token=${token}`,
  };
}

function lifecycleEmailShell(innerHtml) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:28px 22px;color:#111827;background:#F9FAFB;">
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:24px 22px;">
        <div style="font-size:21px;font-weight:700;margin-bottom:14px;">☀️ SignalBrief</div>
        <div style="font-size:15px;line-height:1.65;color:#1F2937;">${innerHtml}</div>
      </div>
    </div>`;
}

async function sendReferralThankYou(referrerUser, newUser) {
  if (!referrerUser?.email) return { ok: false, skipped: true };
  const referrerFirst = firstName(referrerUser.name, referrerUser.email.split("@")[0]);
  const newUserFirst = firstName(newUser?.name, "someone");
  const subject = "Your recommendation just brought someone in";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hey ${referrerFirst},</p>
    <p style="margin:0 0 14px;">Just wanted to let you know — ${newUserFirst} just signed up for SignalBrief using your referral link. They'll get their first digest this morning.</p>
    <p style="margin:0 0 14px;">Thanks for sharing it. The only way this grows is word of mouth from people like you.</p>
    <p style="margin:0;">— Kush</p>
  `);
  const result = await sendEmail(referrerUser.email, subject, html, referrerUser.token || null);
  console.log(`[referral thank-you] ${referrerUser.email} → ${result.ok ? "✅ sent via " + result.via : "❌ failed"}`);
  return result;
}

async function sendReengagementDay4Email(user) {
  if (!user?.email) return { ok: false, skipped: true };
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user);
  const topics = topicListForUser(user);
  const deliveryTime = deliveryTimeLabelEt(user);
  const subject = "Your SignalBrief is still running — want to adjust anything?";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">I noticed you haven't opened SignalBrief in a few days. No judgment — inboxes are brutal.</p>
    <p style="margin:0 0 10px;">A few things that might help:</p>
    <p style="margin:0 0 10px;">Wrong topics? You're currently getting ${topics}. Update them in 30 seconds: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 10px;">Wrong time? Your digest arrives at ${deliveryTime}. Too early, too late? Change it: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 14px;">Too much text? Switch to headline-only depth for a faster scan: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 14px;">Or just reply here and tell me what's not working. I read every reply.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

async function sendReengagementDay8Email(user) {
  if (!user?.email) return { ok: false, skipped: true };
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user);
  const subject = "Should I pause your SignalBrief?";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">You haven't opened SignalBrief in about a week. I don't want to fill your inbox if it's not useful.</p>
    <p style="margin:0 0 10px;">Keep it going: <a href="${links.reactivate}" style="color:#2563EB;text-decoration:none;">I'll keep sending as normal</a>.</p>
    <p style="margin:0 0 14px;">Pause it: <a href="${links.pause}" style="color:#2563EB;text-decoration:none;">I'll stop for now</a>. You can restart anytime from your settings.</p>
    <p style="margin:0 0 14px;">No wrong answer. If the timing or topics aren't right, I'd rather pause than become noise.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

async function sendAutoPauseConfirmationEmail(user) {
  if (!user?.email) return { ok: false, skipped: true };
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user);
  const subject = "Your SignalBrief is paused for now";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We've paused your SignalBrief digest to keep your inbox clean — you hadn't opened it in a while and I didn't want to keep sending.</p>
    <p style="margin:0 0 14px;">To restart, it takes one click: <a href="${links.reactivate}" style="color:#2563EB;text-decoration:none;">reactivate SignalBrief</a></p>
    <p style="margin:0 0 14px;">Your topics and settings are all saved — you'll pick up right where you left off.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

// ── Welcome email ─────────────────────────────────────────────────────────────
// Shared by server.js (web signup) and reply-handler.js (Telegram signup)

async function sendWelcomeEmail(user) {
  const { name, email } = user;
  const prefs = user.preferences || {};
  const baseUrl = getBaseUrl();
  const settingsUrl = `${baseUrl}/settings?token=${user.token}`;
  const archiveUrl  = `${baseUrl}/archive?token=${user.token}`;
  const firstName = (name || "there").split(" ")[0];

  const [hRaw, mRaw] = (prefs.delivery_time || "07:00").split(":").map(Number);
  const ampm = hRaw >= 12 ? "PM" : "AM";
  const hour = hRaw % 12 || 12;
  const timeLabel = `${hour}:${String(mRaw).padStart(2, "0")} ${ampm} ET`;

  const days = prefs.days_of_week || [1, 2, 3, 4, 5];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let daysLabel;
  if (days.length === 7) daysLabel = "Every day";
  else if (days.length === 6 && days.includes(6)) daysLabel = "Mon–Sat";
  else if (days.length === 5 && !days.includes(0) && !days.includes(6)) daysLabel = "Mon–Fri";
  else daysLabel = days.map(d => DAY_NAMES[d]).join(", ");

  const DEPTH_LABELS = {
    headline_only:          "Scan (headlines only)",
    scan:                   "Scan (headlines only)",
    headline_plus_oneliner: "Brief (headline + one-liner)",
    headline_plus_why:      "Brief (headline + why it matters)",
    deep:                   "Deep (extended analysis)",
  };
  const depthLabel = DEPTH_LABELS[prefs.depth] || "Brief (headline + why it matters)";

  const topics = user.topics || [];
  const topicsHtml = topics.map(t => {
    if (t.startsWith("custom_")) {
      const label = "Custom: " + t.replace(/^custom_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;color:#7C3AED;background:#F5F3FF;padding:3px 10px;border-radius:4px;margin:0 5px 6px 0;">${label}</span>`;
    }
    return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;color:#2563EB;background:#EFF6FF;padding:3px 10px;border-radius:4px;margin:0 5px 6px 0;">${t}</span>`;
  }).join("");

  const html = loadWelcomeTemplate()
    .replace(/\{\{NAME\}\}/g, firstName)
    .replace(/\{\{TOPICS_HTML\}\}/g, topicsHtml)
    .replace(/\{\{TOPIC_COUNT\}\}/g, String(topics.length))
    .replace(/\{\{DELIVERY_TIME_LABEL\}\}/g, timeLabel)
    .replace(/\{\{DELIVERY_DAYS_LABEL\}\}/g, daysLabel)
    .replace(/\{\{DEPTH_LABEL\}\}/g, depthLabel)
    .replace(/\{\{ITEMS_COUNT\}\}/g, String(prefs.items_per_digest || 5))
    .replace(/\{\{SETTINGS_URL\}\}/g, settingsUrl)
    .replace(/\{\{ARCHIVE_URL\}\}/g, archiveUrl)
    .replace(/\{\{USER_EMAIL\}\}/g, email);

  const subject = `Welcome to SignalBrief, ${firstName} — your brief is set for ${timeLabel}`;
  const result = await sendEmail(email, subject, html, user.token);
  console.log(`[welcome email] ${email} → ${result.ok ? "✅ sent via " + result.via : "❌ failed"}`);
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendReferralThankYou,
  sendReengagementDay4Email,
  sendReengagementDay8Email,
  sendAutoPauseConfirmationEmail,
  buildOpenTrackingPixel,
  signUnsubEmail,
};
