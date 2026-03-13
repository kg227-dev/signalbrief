/**
 * SignalBrief — mailer.js
 * Handles email delivery via Resend (branded domain) with Gmail OAuth fallback.
 *
 * To activate Resend:
 * 1. Create account at resend.com (free tier: 3,000 emails/month)
 * 2. Add your domain (signalbrief.co or similar) and verify DNS
 * 3. Get API key from resend.com/api-keys
 * 4. Add env: SIGNALBRIEF_RESEND_API_KEY="re_..."
 * 5. Add env: SIGNALBRIEF_FROM_EMAIL="digest@signalbrief.co"
 * 6. Add env: SIGNALBRIEF_FROM_NAME="SignalBrief"
 *
 * Until configured, falls back to Gmail OAuth (jarvisjones2922@gmail.com).
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadConfig } = require("../config-provider");
const { createLifecycleMailer } = require("../mailer-lifecycle-runtime");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
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
// Keeps backward compatibility for signed email-based legacy bridge URLs
// (/api/unsubscribe/legacy) used by previously issued messages.
function getUnsubscribeSigningSecret() {
  const keys = getConfigKeys();
  return (keys.anthropic || "").slice(-32) || "signalbrief-unsub-secret";
}

function signUnsubEmail(email) {
  return crypto.createHmac("sha256", getUnsubscribeSigningSecret())
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
  if (token) return `${root}/api/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
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

function parseJsonObjectSafe(raw) {
  try {
    const parsed = JSON.parse(String(raw || "").trim() || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pickErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (typeof payload.error_description === "string" && payload.error_description.trim()) return payload.error_description.trim();
  return "";
}

function buildMailResult({
  ok,
  via,
  skipped = false,
  error = null,
  ...extra
}) {
  return {
    ok: !!ok,
    via: String(via || "unknown"),
    skipped: !!skipped,
    error: error == null ? null : String(error),
    ...extra,
  };
}

// ── Resend delivery ───────────────────────────────────────────────────────────

function sendViaResend(to, subject, html, token = null) {
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
        const data = parseJsonObjectSafe(out);
        const status = Number(res.statusCode || 0);
        if (status === 200 || status === 201) {
          const id = data && typeof data.id === "string" ? data.id.trim() : "";
          if (id) {
            resolve({ ok: true, id });
          } else {
            resolve({
              ok: false,
              error: "Resend response missing message id.",
              status,
              code: "resend_invalid_shape",
            });
          }
          return;
        }

        resolve({
          ok: false,
          error: pickErrorMessage(data) || String(out || "").trim() || `Resend request failed with status ${status || "unknown"}.`,
          status,
          code: "resend_request_failed",
        });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Gmail OAuth fallback ──────────────────────────────────────────────────────

function refreshGoogleToken() {
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
      res.on("end", () => {
        const status = Number(res.statusCode || 0);
        const data = parseJsonObjectSafe(out);
        if (status < 200 || status >= 300) {
          const detail = pickErrorMessage(data) || String(out || "").trim() || "unknown oauth error";
          reject(new Error(`[mailer] google token refresh failed (${status || "unknown"}): ${detail}`));
          return;
        }

        const accessToken = data && typeof data.access_token === "string"
          ? data.access_token.trim()
          : "";
        if (!accessToken) {
          reject(new Error("[mailer] google token refresh response missing access_token"));
          return;
        }
        resolve(accessToken);
      });
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
      res.on("end", () => {
        const status = Number(res.statusCode || 0);
        const data = parseJsonObjectSafe(out);
        if (status === 200) {
          resolve({ ok: true, status, id: typeof data?.id === "string" ? data.id : null });
          return;
        }
        resolve({
          ok: false,
          status,
          error: pickErrorMessage(data) || String(out || "").trim() || `gmail send failed (${status || "unknown"})`,
        });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main send function ────────────────────────────────────────────────────────

async function sendEmail(to, subject, html, token = null) {
  if (!String(to || "").trim()) {
    return buildMailResult({
      ok: false,
      via: "none",
      skipped: true,
      error: "missing recipient email",
    });
  }

  const keys = getConfigKeys();
  let resendFailure = null;

  // Use Resend if configured, otherwise Gmail
  if (keys.resendApiKey) {
    const result = await sendViaResend(to, subject, html, token);
    if (result.ok) {
      return buildMailResult({
        ok: true,
        via: "resend",
        status: 201,
        message_id: result.id || null,
      });
    }
    resendFailure = result;
    console.error(`Resend failed (${result.error}), falling back to Gmail...`);
  }

  const result = await sendViaGmail(to, subject, html, token);
  return buildMailResult({
    ok: result.ok,
    via: "gmail",
    status: result.status || null,
    message_id: result.id || null,
    error: result.ok ? null : (result.error || "gmail send failed"),
    fallback_from: resendFailure ? "resend" : null,
    fallback_error: resendFailure?.error || null,
  });
}

const {
  sendWelcomeEmail,
  sendReferralThankYou,
  sendReengagementDay4Email,
  sendReengagementDay8Email,
  sendAutoPauseConfirmationEmail,
} = createLifecycleMailer({
  sendEmail,
  getBaseUrl,
  loadWelcomeTemplate,
  normalizeBaseUrl,
  buildMailResult,
});

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
