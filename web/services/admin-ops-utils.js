function appendJsonLineLog({ fs, path, filePath, entry, label }) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
    return { ok: true };
  } catch (err) {
    console.error(`[${label}]`, err.message);
    return { ok: false, error: err.message, label };
  }
}

function readJsonLineTail({ fs, filePath, limit = 30, maxBytes = 512 * 1024 }) {
  if (!fs.existsSync(filePath)) return [];
  const requested = Math.max(1, Number(limit) || 1);
  let bytesToRead = Math.max(32 * 1024, Number(maxBytes) || (512 * 1024));
  const capBytes = 4 * 1024 * 1024;

  while (bytesToRead <= capBytes) {
    const stat = fs.statSync(filePath);
    const size = stat.size || 0;
    if (size <= 0) return [];
    const readSize = Math.min(size, bytesToRead);
    const start = size - readSize;
    const fd = fs.openSync(filePath, "r");
    let raw = "";
    try {
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, start);
      raw = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    if (start > 0) {
      const firstNl = raw.indexOf("\n");
      raw = firstNl >= 0 ? raw.slice(firstNl + 1) : "";
    }
    if (!raw) return [];

    const lines = raw.split("\n").filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < requested; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed) out.push(parsed);
      } catch (err) {
        if (process.env.DEBUG_WEB_SERVER === "1") {
          console.warn(`[web] skipping malformed JSONL line in ${filePath}: ${err.message}`);
        }
      }
    }
    if (out.length >= requested || start === 0) return out;
    bytesToRead = Math.min(capBytes, bytesToRead * 2);
  }

  return [];
}

function parseIsoTs(iso) {
  const ts = Date.parse(String(iso || ""));
  return Number.isFinite(ts) ? ts : null;
}

function toNumericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");
  if (at <= 1) return value;
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

function summarizeMessage(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

function hashText({ crypto, text }) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

module.exports = {
  appendJsonLineLog,
  readJsonLineTail,
  parseIsoTs,
  toNumericOrNull,
  maskEmail,
  summarizeMessage,
  hashText,
};
