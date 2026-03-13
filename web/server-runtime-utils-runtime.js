const path = require("path");

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function toEtDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// digestId is base64url-encoded in tracking pixel URLs to preserve the
// native digest id shape ("YYYY-MM-DD:chatId") as a single path segment.
function decodeDigestIdParam(encoded) {
  const raw = String(encoded || "").trim();
  if (!raw) return "";
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function sendTransparentGif(res) {
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": TRANSPARENT_GIF.length,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(TRANSPARENT_GIF);
}

function readArchiveFiles({ fs, archiveDir }) {
  if (!fs.existsSync(archiveDir)) return [];
  const indexFiles = readArchiveFilesFromIndex({ fs, archiveDir });
  if (indexFiles.length > 0) {
    const newestFile = path.join(archiveDir, indexFiles[0]);
    if (fs.existsSync(newestFile)) return indexFiles;
  }

  const files = fs.readdirSync(archiveDir)
    .filter((fileName) => isArchiveDigestFileName(fileName))
    .sort()
    .reverse(); // newest first
  writeArchiveIndexFromFiles({ fs, archiveDir, files });
  return files;
}

function isArchiveDigestFileName(fileName) {
  return /^\d{4}-\d{2}-\d{2}\.json$/.test(String(fileName || ""));
}

function normalizeArchiveDateList(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  )).sort((a, b) => (a < b ? 1 : -1));
}

function readArchiveFilesFromIndex({ fs, archiveDir }) {
  const indexPath = path.join(archiveDir, "index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const dates = normalizeArchiveDateList(parsed?.dates);
    return dates.map((dateKey) => `${dateKey}.json`);
  } catch {
    return [];
  }
}

function writeArchiveIndexFromFiles({ fs, archiveDir, files }) {
  const indexPath = path.join(archiveDir, "index.json");
  const tmpPath = `${indexPath}.tmp`;
  const dates = normalizeArchiveDateList(
    (Array.isArray(files) ? files : [])
      .filter((fileName) => isArchiveDigestFileName(fileName))
      .map((fileName) => String(fileName).replace(".json", ""))
  );
  const payload = {
    version: 1,
    updated_at: new Date().toISOString(),
    dates,
  };
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpPath, indexPath);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort temp cleanup
    }
  }
}

function getAllowedArchiveDates({
  user,
  archiveDir,
  files,
  fs,
  path,
  writeUser,
}) {
  let allowedList = Array.isArray(user.digest_dates) ? user.digest_dates.slice() : [];
  let changed = false;

  // Legacy backfill: older users may have digests_received ahead of digest_dates.
  if ((user.digests_received || 0) > allowedList.length) {
    const joinedET = toEtDateKey(user.joined_at);
    const missingCount = Math.max(0, Number(user.digests_received || 0) - allowedList.length);
    const candidates = Array.isArray(files)
      ? files.slice(0, Math.max(7, Math.min(files.length, missingCount)))
      : [];
    const inferred = candidates
      .map((fileName) => fileName.replace(".json", ""))
      .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
      .filter((dateKey) => (!joinedET || dateKey >= joinedET));
    const merged = [...new Set([...allowedList, ...inferred])].sort();
    if (merged.length > allowedList.length) {
      allowedList = merged;
      changed = true;
    }
  }

  // Safety backfill: include most recent delivered digest date from last_digest_at.
  // This covers cases where digest_dates missed a write on manual/on-demand sends.
  const lastDigestDate = toEtDateKey(user.last_digest_at);
  if (lastDigestDate && !allowedList.includes(lastDigestDate)) {
    const lastFile = path.join(archiveDir, `${lastDigestDate}.json`);
    if (fs.existsSync(lastFile)) {
      allowedList = [...new Set([...allowedList, lastDigestDate])].sort();
      changed = true;
    }
  }

  if (changed) {
    writeUser(user.chatId, {
      ...user,
      digest_dates: allowedList,
      last_updated: new Date().toISOString(),
    });
  }

  return new Set(allowedList);
}

function normalizeBookmarkUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function createSendMagicLinkEmail({ sendEmail, getBaseUrl }) {
  return async function sendMagicLinkEmail(user) {
    const baseUrl = getBaseUrl();
    const settingsUrl = `${baseUrl}/settings?token=${user.token}`;
    const archiveUrl = `${baseUrl}/archive?token=${user.token}`;
    const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;">
      <div style="font-size:22px;font-weight:700;margin-bottom:24px;">☀️ SignalBrief</div>
      <p style="font-size:16px;margin-bottom:16px;">Here's your personal SignalBrief access link:</p>
      <a href="${settingsUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 32px;border-radius:100px;">Manage preferences →</a>
      <p style="margin-top:20px;font-size:13px;color:#6B7280;">Or view your <a href="${archiveUrl}" style="color:#2563EB;">past digests</a>.<br>This link is personal — keep it private.</p>
    </div>`;
    await sendEmail(user.email, "Your SignalBrief access link", html);
  };
}

function createSendTelegramText({ https, getToken }) {
  return function sendTelegramText(chatId, text) {
    const token = getToken();
    if (!token) return Promise.reject(new Error("Telegram bot token not configured"));
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      }, (response) => {
        let out = "";
        response.on("data", (chunk) => out += chunk);
        response.on("end", () => {
          try {
            const data = JSON.parse(out || "{}");
            if (!data.ok) return reject(new Error(data.description || "telegram send failed"));
            resolve(data);
          } catch {
            reject(new Error("telegram response parse failed"));
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  };
}

module.exports = {
  toEtDateKey,
  decodeDigestIdParam,
  sendTransparentGif,
  readArchiveFiles,
  getAllowedArchiveDates,
  normalizeBookmarkUrl,
  createSendMagicLinkEmail,
  createSendTelegramText,
};
