const fs = require("fs");
const path = require("path");
const { isDebugWebServerEnabled } = require("./server-runtime-env-runtime");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveFile(res, filePath, extraHeaders = null) {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const headers = {
      "Content-Type": MIME[ext] || "text/plain",
      ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
    };
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function json(res, data, status = 200) {
  const headers = {
    "Content-Type": "application/json",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const corsOrigin = String(res.__corsOrigin || "").trim();
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers.Vary = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

const REQUEST_BODY_MAX_BYTES = 1 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REQUEST_BODY_MAX_BYTES) {
        tooLarge = true;
        return;
      }
      if (tooLarge) return;
      body += chunk;
    });
    req.on("end", () => {
      if (tooLarge) {
        settle({ ok: false, code: "payload_too_large", max_bytes: REQUEST_BODY_MAX_BYTES });
        return;
      }
      if (!body.trim()) {
        settle({ ok: true, body: {} });
        return;
      }
      try {
        settle({ ok: true, body: JSON.parse(body) });
      } catch {
        settle({ ok: false, code: "invalid_json" });
      }
    });
    req.on("error", (error) => {
      if (isDebugWebServerEnabled()) {
        console.warn(`[web] request body read error: ${error.message}`);
      }
      settle({ ok: false, code: "body_read_error" });
    });
  });
}

function writeBodyParseError(res, parseResult) {
  if (parseResult.code === "payload_too_large") {
    json(res, {
      error: "request payload too large",
      code: "payload_too_large",
      max_bytes: REQUEST_BODY_MAX_BYTES,
    }, 413);
    return;
  }
  json(res, {
    error: "invalid JSON payload",
    code: parseResult.code || "invalid_json",
  }, 400);
}

async function requireJsonBody(req, res) {
  const parseResult = await readBody(req);
  if (parseResult.ok) return parseResult.body;
  writeBodyParseError(res, parseResult);
  return null;
}

module.exports = {
  serveFile,
  json,
  requireJsonBody,
};
