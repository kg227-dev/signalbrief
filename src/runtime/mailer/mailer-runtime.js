/**
 * SignalBrief — mailer.js
 * Handles email delivery via Resend.
 *
 * To activate Resend:
 * 1. Create account at resend.com (free tier: 3,000 emails/month)
 * 2. Add your domain (signalbrief.co or similar) and verify DNS
 * 3. Get API key from resend.com/api-keys
 * 4. Add env: SIGNALBRIEF_RESEND_API_KEY="re_..."
 * 5. Add env: SIGNALBRIEF_FROM_EMAIL="digest@signalbrief.co"
 * 6. Add env: SIGNALBRIEF_FROM_NAME="SignalBrief"
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

const MAILER_TIMEOUT_MS = Math.max(1000, Number(process.env.SIGNALBRIEF_MAILER_TIMEOUT_MS || 15000));

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
// Legacy email+signature unsubscribe URLs are migration-only and can be retired
// via UNSUBSCRIBE_LEGACY_* flags. Keep signature verification stable while
// switching to a dedicated unsubscribe signing secret.
function normalizeUnsubEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function getUnsubscribeSigningSecret() {
  const keys = getConfigKeys();
  const explicit = String(process.env.SIGNALBRIEF_UNSUBSCRIBE_SIGNING_SECRET || "").trim()
    || String(keys.unsubscribeSigningSecret || "").trim();
  if (explicit) return explicit;
  const adminHash = String(getConfig()?.admin?.passwordHash || "").trim();
  if (adminHash) return adminHash;
  return "signalbrief-unsub-secret-fallback";
}

function signUnsubEmail(email, options = {}) {
  const normalized = normalizeUnsubEmail(email);
  const legacy = options && options.legacy === true;
  const payload = legacy ? normalized : `v2:${normalized}`;
  const digest = crypto.createHmac("sha256", getUnsubscribeSigningSecret())
    .update(payload)
    .digest("hex");
  return legacy ? digest.slice(0, 16) : digest;
}

function timingSafeStringEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function verifyUnsubEmailSignature(email, signature) {
  const normalizedSig = String(signature || "").trim().toLowerCase();
  if (!normalizedSig) return false;
  const normalizedEmail = normalizeUnsubEmail(email);
  if (!normalizedEmail) return false;
  const expectedV2 = signUnsubEmail(normalizedEmail);
  if (timingSafeStringEqual(normalizedSig, expectedV2)) return true;
  const expectedLegacy = signUnsubEmailLegacy(normalizedEmail);
  return timingSafeStringEqual(normalizedSig, expectedLegacy);
}

function signUnsubEmailLegacy(email) {
  return crypto.createHmac("sha256", getUnsubscribeSigningSecret())
    .update(normalizeUnsubEmail(email))
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
      timeout: MAILER_TIMEOUT_MS,
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
    req.on("timeout", () => { req.destroy(new Error(`[mailer] resend request timed out after ${MAILER_TIMEOUT_MS}ms`)); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

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
  if (!String(keys.resendApiKey || "").trim()) {
    return buildMailResult({
      ok: false,
      via: "resend",
      error: "resend_api_key_missing",
    });
  }

  const result = await sendViaResend(to, subject, html, token);
  return buildMailResult({
    ok: result.ok,
    via: "resend",
    status: result.status || null,
    message_id: result.id || null,
    error: result.ok ? null : (result.error || "resend send failed"),
  });
}

const {
  sendWelcomeEmail,
  sendReferralThankYou,
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
  buildOpenTrackingPixel,
  signUnsubEmail,
  verifyUnsubEmailSignature,
};
