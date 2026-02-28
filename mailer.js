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

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

// ── Resend delivery ───────────────────────────────────────────────────────────

async function sendViaResend(to, subject, html) {
  const apiKey = CONFIG.keys.resendApiKey;
  const fromEmail = CONFIG.keys.fromEmail || "digest@signalbrief.co";
  const fromName = CONFIG.keys.fromName || "SignalBrief";

  const body = JSON.stringify({
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject,
    html,
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

async function sendViaGmail(to, subject, html) {
  const accessToken = await refreshGoogleToken();
  const fromEmail = "jarvisjones2922@gmail.com";
  const fromName = CONFIG.keys.fromName || "SignalBrief";

  const mime = [
    `To: ${to}`,
    `From: ${fromName} <${fromEmail}>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
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

async function sendEmail(to, subject, html) {
  // Inject settings link into email footer
  html = html.replace(/\{\{USER_EMAIL\}\}/g, encodeURIComponent(to));

  // Use Resend if configured, otherwise Gmail
  if (CONFIG.keys.resendApiKey) {
    const result = await sendViaResend(to, subject, html);
    if (result.ok) return { ok: true, via: "resend" };
    console.error(`Resend failed (${result.error}), falling back to Gmail...`);
  }

  const result = await sendViaGmail(to, subject, html);
  return { ok: result.ok, via: "gmail" };
}

module.exports = { sendEmail };
