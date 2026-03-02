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

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const BASE_URL = process.env.BASE_URL || "https://getsignalbrief.com";
const WELCOME_TEMPLATE = fs.readFileSync(path.join(__dirname, "templates/welcome.html"), "utf8");

// ── HMAC helpers (B-3) ────────────────────────────────────────────────────────
// Sign email addresses for the RFC 8058 fallback unsubscribe URL.
// Uses the last 32 chars of the Anthropic key as a stable HMAC secret.
// Verified in server.js before allowing email-based unsubscribes.
function _unsubSecret() {
  return (CONFIG.keys.anthropic || "").slice(-32) || "signalbrief-unsub-secret";
}

function signUnsubEmail(email) {
  return crypto.createHmac("sha256", _unsubSecret())
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 16);
}

module.exports.signUnsubEmail = signUnsubEmail;

// ── Resend delivery ───────────────────────────────────────────────────────────

async function sendViaResend(to, subject, html, token = null) {
  const apiKey = CONFIG.keys.resendApiKey;
  const fromEmail = CONFIG.keys.fromEmail || "digest@signalbrief.co";
  const fromName = CONFIG.keys.fromName || "SignalBrief";
  const unsubUrl = token
    ? `${BASE_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`
    : `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(to)}&sig=${signUnsubEmail(to)}`;

  const body = JSON.stringify({
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
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
  const formData = new URLSearchParams({
    client_id: CONFIG.keys.googleClientId,
    client_secret: CONFIG.keys.googleClientSecret,
    refresh_token: CONFIG.keys.googleRefreshToken,
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
  const accessToken = await refreshGoogleToken();
  const fromEmail = "jarvisjones2922@gmail.com";
  const fromName = CONFIG.keys.fromName || "SignalBrief";
  const unsubUrl = token
    ? `${BASE_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`
    : `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(to)}&sig=${signUnsubEmail(to)}`;

  const mime = [
    `To: ${to}`,
    `From: ${fromName} <${fromEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `List-Unsubscribe: <${unsubUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    ``,
    html,
  ].join("\r\n");

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
  // Use Resend if configured, otherwise Gmail
  if (CONFIG.keys.resendApiKey) {
    const result = await sendViaResend(to, subject, html, token);
    if (result.ok) return { ok: true, via: "resend" };
    console.error(`Resend failed (${result.error}), falling back to Gmail...`);
  }

  const result = await sendViaGmail(to, subject, html, token);
  return { ok: result.ok, via: "gmail" };
}

// ── Welcome email ─────────────────────────────────────────────────────────────
// Shared by server.js (web signup) and reply-handler.js (Telegram signup)

async function sendWelcomeEmail(user) {
  const { name, email } = user;
  const prefs = user.preferences || {};
  const settingsUrl = `${BASE_URL}/settings?token=${user.token}`;
  const archiveUrl  = `${BASE_URL}/archive?token=${user.token}`;
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

  const html = WELCOME_TEMPLATE
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

module.exports = { sendEmail, sendWelcomeEmail };
