const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const {
  CACHE_PERPLEXITY_DIR,
  CACHE_CLAUDE_DIR,
  BUDGET_FILE,
  BUDGET_CAP_USD,
  COSTS,
  JUDGE_MODELS,
  MODEL_PRICING,
  sanitizeCacheKey,
  writeJson,
  readJson,
} = require("./config");

const ENRICH_PROMPT_VERSION = "2026-03-03-depth-v6";

function stableHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function httpsPost(hostname, pathName, headers, body, isForm = false, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const data = isForm ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: pathName,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(out), raw: out });
          } catch {
            resolve({ status: res.statusCode, body: out, raw: out });
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)));
    req.write(data);
    req.end();
  });
}

async function httpsPostWithRetry(hostname, pathName, headers, body, opts = {}) {
  const retries = Math.max(0, Number(opts.retries ?? 1));
  const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
  const timeoutMs = Math.max(3000, Number(opts.timeoutMs ?? 30000));

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsPost(hostname, pathName, headers, body, opts.isForm === true, timeoutMs);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      const retryable = /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
      if (!retryable || attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastErr || new Error("HTTP request failed");
}

function normalizeBudget(raw = {}) {
  const cap = Number(raw.cap);
  const spent = Number(raw.spent);
  const normalized = {
    cap: Number.isFinite(cap) ? cap : BUDGET_CAP_USD,
    spent: Number.isFinite(spent) ? spent : 0,
    remaining: 0,
    calls: Array.isArray(raw.calls) ? raw.calls : [],
  };
  normalized.remaining = Math.max(0, Number((normalized.cap - normalized.spent).toFixed(6)));
  return normalized;
}

function loadBudget() {
  const data = readJson(BUDGET_FILE, null);
  if (!data) {
    const fresh = normalizeBudget({});
    writeJson(BUDGET_FILE, fresh);
    return fresh;
  }
  const normalized = normalizeBudget(data);
  writeJson(BUDGET_FILE, normalized);
  return normalized;
}

function saveBudget(budget) {
  const normalized = normalizeBudget(budget);
  writeJson(BUDGET_FILE, normalized);
  return normalized;
}

function ensureBudget(budget, estimateUsd, reason) {
  const estimate = Number(estimateUsd) || 0;
  if (estimate <= 0) return;
  if (budget.remaining < estimate) {
    const msg = [
      `Budget guard triggered before ${reason}.`,
      `Estimated call cost: $${estimate.toFixed(5)}.`,
      `Remaining budget: $${budget.remaining.toFixed(5)}.`,
      `Run with cache-only data or increase budget cap.`,
    ].join(" ");
    throw new Error(msg);
  }
}

function recordBudgetCall(budget, entry) {
  const cost = Number(entry?.cost_usd || 0);
  const payload = {
    ts: new Date().toISOString(),
    provider: entry.provider || "unknown",
    purpose: entry.purpose || "unknown",
    cache_key: entry.cache_key || null,
    model: entry.model || null,
    endpoint: entry.endpoint || null,
    input_tokens: Number(entry.input_tokens || 0),
    output_tokens: Number(entry.output_tokens || 0),
    cost_usd: Number(cost.toFixed(6)),
    from_cache: !!entry.from_cache,
  };

  const next = normalizeBudget(budget);
  if (payload.cost_usd > 0) {
    next.spent = Number((next.spent + payload.cost_usd).toFixed(6));
    next.remaining = Math.max(0, Number((next.cap - next.spent).toFixed(6)));
  }
  next.calls.push(payload);
  saveBudget(next);
  return next;
}

function resolveAnthropicModel(model) {
  const raw = String(model || "").trim().toLowerCase();
  if (!raw) return JUDGE_MODELS.haiku;
  if (JUDGE_MODELS[raw]) return JUDGE_MODELS[raw];
  if (raw.includes("sonnet")) return JUDGE_MODELS.sonnet;
  if (raw.includes("haiku")) return JUDGE_MODELS.haiku;
  return model;
}

function modelRateCard(model, costs = COSTS) {
  const normalized = resolveAnthropicModel(model);
  const map = {
    ...MODEL_PRICING,
    ...(costs && costs.model_pricing ? costs.model_pricing : {}),
  };
  const card = map[normalized];
  if (card) return card;
  return {
    input_per_mtok_usd: Number(costs.claude_in_per_mtok_usd || COSTS.claude_in_per_mtok_usd),
    output_per_mtok_usd: Number(costs.claude_out_per_mtok_usd || COSTS.claude_out_per_mtok_usd),
    judge_estimate_usd: Number(costs.claude_judge_estimate_usd || COSTS.claude_judge_estimate_usd),
  };
}

function estimateClaudeCost(usage, costs = COSTS, model = JUDGE_MODELS.haiku) {
  const inTokens = Number(usage?.input_tokens || 0);
  const outTokens = Number(usage?.output_tokens || 0);
  const card = modelRateCard(model, costs);
  const inCost = (inTokens / 1_000_000) * Number(card.input_per_mtok_usd || COSTS.claude_in_per_mtok_usd);
  const outCost = (outTokens / 1_000_000) * Number(card.output_per_mtok_usd || COSTS.claude_out_per_mtok_usd);
  return Number((inCost + outCost).toFixed(6));
}

function parseJsonArrayLenient(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();

  if (!cleaned) return [];

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("[");
    if (start === -1) throw err;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1));
        }
      }
    }

    throw err;
  }
}

function parseJsonObjectLenient(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();

  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("{");
    if (start === -1) throw err;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1));
        }
      }
    }

    throw err;
  }
}

function parsePerplexityItems(responseBody, topicTag) {
  const citations = responseBody?.citations || [];
  let content = responseBody?.choices?.[0]?.message?.content || "[]";
  content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let items = [];
  try {
    items = JSON.parse(content);
  } catch {
    items = [];
  }

  const normalized = Array.isArray(items)
    ? items.map((item) => {
        const base = {
          headline: item?.headline || "",
          summary: item?.summary || "",
          source: item?.source || "unknown",
          url: item?.url || "#",
          tag: topicTag,
        };

        try {
          const parsed = new URL(base.url);
          if (parsed.pathname === "/" || parsed.pathname === "") {
            const hit = citations.find((c) => {
              try {
                return new URL(c).hostname === parsed.hostname;
              } catch {
                return false;
              }
            });
            if (hit) base.url = hit;
          }
        } catch (err) {
          if (process.env.QA_DEBUG === "1") {
            console.warn(`[qa-cache] keeping original URL for ${topicTag}: ${err.message}`);
          }
        }

        return base;
      })
    : [];

  return normalized;
}

function buildPerplexityPayload(topicTag, query) {
  return {
    model: "sonar",
    messages: [
      {
        role: "system",
        content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.\nReturn ONLY a JSON array of up to 3 distinct news items from the last 48 hours.\nEach item MUST include the direct article URL from your citations — not the homepage.\nFormat: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "tag": "${topicTag}"}]\nNo markdown. No explanation. JSON array only.`,
      },
      {
        role: "user",
        content: `Find the 3 most important news items from the last 48 hours about: ${query}\nIMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
      },
    ],
    max_tokens: 1000,
  };
}

function findLatestTopicCacheFile(topicTag) {
  const prefix = `${sanitizeCacheKey(topicTag)}_`;
  if (!fs.existsSync(CACHE_PERPLEXITY_DIR)) return null;
  const candidates = fs.readdirSync(CACHE_PERPLEXITY_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (!candidates.length) return null;
  return path.join(CACHE_PERPLEXITY_DIR, candidates[candidates.length - 1]);
}

function readPerplexityCacheFile(file, topicTag, stale = false) {
  const cached = readJson(file, {});
  return {
    items: Array.isArray(cached.parsed_items) ? cached.parsed_items : [],
    from_cache: true,
    cache_file: file,
    stale_fallback: stale,
    cost_usd: 0,
    raw_response: cached.raw_response || null,
    topic_tag: topicTag,
  };
}

async function fetchTopicNewsCached({
  topicTag,
  query,
  dateKey,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const file = path.join(
    CACHE_PERPLEXITY_DIR,
    `${sanitizeCacheKey(topicTag)}_${sanitizeCacheKey(dateKey || "run")}.json`
  );
  const latestFallback = findLatestTopicCacheFile(topicTag);

  if (!refreshCache && fs.existsSync(file)) {
    return readPerplexityCacheFile(file, topicTag, false);
  }

  if (!refreshCache && latestFallback) {
    return readPerplexityCacheFile(latestFallback, topicTag, true);
  }

  if (!allowLiveApi) {
    throw new Error(
      `Perplexity cache miss for topic "${topicTag}". Rerun with --live to warm cache or use --offline.`
    );
  }

  const apiKey = appConfig?.keys?.perplexity;
  if (!apiKey) throw new Error("Missing config.keys.perplexity for live Perplexity calls.");

  const estimated = Number(costs.perplexity_per_call_usd || COSTS.perplexity_per_call_usd);
  ensureBudget(budget, estimated, `Perplexity fetch (${topicTag})`);

  const payload = buildPerplexityPayload(topicTag, query);
  let res;
  try {
    res = await httpsPostWithRetry(
      "api.perplexity.ai",
      "/chat/completions",
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      payload,
      {
        retries: 1,
        retryDelayMs: 900,
        timeoutMs: 20000,
      }
    );
  } catch (err) {
    if (fs.existsSync(file)) {
      return readPerplexityCacheFile(file, topicTag, true);
    }
    if (latestFallback) {
      return readPerplexityCacheFile(latestFallback, topicTag, true);
    }
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    if (fs.existsSync(file)) {
      return readPerplexityCacheFile(file, topicTag, true);
    }
    if (latestFallback) {
      return readPerplexityCacheFile(latestFallback, topicTag, true);
    }
    throw new Error(`Perplexity fetch failed for ${topicTag}: status ${res.status}`);
  }

  const parsedItems = parsePerplexityItems(res.body, topicTag);
  const entry = {
    timestamp: new Date().toISOString(),
    api: "perplexity.chat.completions",
    endpoint: "/chat/completions",
    model: "sonar",
    topic_tag: topicTag,
    input: {
      date_key: dateKey,
      query,
      payload,
    },
    raw_response: res.body,
    parsed_items: parsedItems,
    cost_usd: Number(estimated.toFixed(6)),
  };
  writeJson(file, entry);

  const nextBudget = recordBudgetCall(budget, {
    provider: "perplexity",
    purpose: "fetch",
    cache_key: path.basename(file),
    model: "sonar",
    endpoint: "/chat/completions",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: estimated,
    from_cache: false,
  });

  return {
    items: parsedItems,
    from_cache: false,
    cache_file: file,
    cost_usd: estimated,
    raw_response: res.body,
    topic_tag: topicTag,
    budget: nextBudget,
  };
}

function buildEnrichmentPrompt(items) {
  return `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants and business professionals. Your readers work at MBB, Big 4, boutique strategy firms, corporate strategy functions, and PE/investment shops. They work across multiple industries and need to sound informed in client meetings across healthcare, tech, financial services, PE, energy, consumer, and policy. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, return five fields:

1. "wim_brief" — one sentence, max 18 words.
   RULES:
   - Capture only the core strategic punchline for a busy executive.
   - Keep this descriptive only (what changed + why now); do not include role-specific actions or "Watch:" language.
   - No filler, no hedging, no repetition of the headline.
   - Do not use HTML tags in this field.

2. "wim" — a "why it matters" analysis of exactly 2-3 sentences.
   RULES:
   - Use 2 sentences by default; use 3 only when there is a concrete near-term catalyst.
   - First sentence: sharp, specific strategic implication. Wrap in <strong> tags. Make the reader think "I need to bring this up in my client meeting."
   - Second sentence: start with "For <role>," and state a concrete action for that role. Include a causal link ("because", "as", or "which means") plus at least one specific company, regulator, or investor type AND one business lever (pricing, margin, demand, cost, capex, valuation, or market share).
   - Second sentence must introduce at least one NEW fact not in sentence one (new actor, metric, catalyst, or timeline). Do not paraphrase sentence one.
   - Include at least one concrete proper noun in sentence 1 or 2 (company, regulator, buyer segment, or fund type).
   - Include one concrete quantitative anchor when available from the source context (deal value, percentage, timeline, or count). If not available, use a bounded near-term qualifier (for example "next 2 quarters").
   - Third sentence (optional): must start with "Watch:" and name a specific catalyst in the next 2-4 weeks (filing, ruling, earnings call, close date, or vote). Skip only if no concrete catalyst exists.

3. "baseScore" — a number 0.0–10.0 measuring the story's strategic importance and consultant relevance, independent of any user's topic preferences.
   - 8.5–10.0: Major development (landmark M&A, significant policy shift, key earnings miss with broad implications)
   - 7.0–8.4: Notable development (meaningful deal, regulatory move, sector-level change)
   - 5.0–6.9: Moderate interest (incremental update, early-stage signal worth watching)
   - Below 5.0: Routine or narrow-interest item

4. "implications" — one actionable sentence naming a specific role (e.g. "CFO", "deal team", "payer CMO", "PE portfolio team") and the concrete action, question, or client meeting flag this story creates. Return null if it is fully covered by the wim already.

5. "watch_next" — one forward-looking sentence: name the specific signal, filing, earnings call, or regulatory decision to monitor in the next 2–4 weeks. Start with an entity name or date. Return null if this is a one-time development with no near-term pending catalysts.

WHAT TO AVOID (too generic):
❌ "This could have significant implications for the industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)
❌ "This may affect stakeholders over time." (vague hedge)
❌ "Keep an eye on developments." (no actionable signal)

WHAT TO AIM FOR (specific, implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."

Return ONLY a JSON array with the same items plus "wim_brief", "wim", "baseScore", "implications", and "watch_next" fields. No markdown, no explanation.

Items:
${JSON.stringify(items.map(i => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;
}

async function enrichItemsCached({
  items,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const enrichModel = JUDGE_MODELS.haiku;
  const prompt = buildEnrichmentPrompt(items || []);
  const hash = stableHash({
    type: "enrichment",
    model: enrichModel,
    prompt_version: ENRICH_PROMPT_VERSION,
    prompt,
    items: (items || []).map((i) => ({ headline: i.headline, summary: i.summary, tag: i.tag })),
  });
  const file = path.join(CACHE_CLAUDE_DIR, `enrichment_${hash}.json`);

  if (!refreshCache && fs.existsSync(file)) {
    const cached = readJson(file, {});
    return {
      items: Array.isArray(cached.enriched_items) ? cached.enriched_items : [],
      usage: cached.usage || { input_tokens: 0, output_tokens: 0 },
      from_cache: true,
      cache_file: file,
      cost_usd: 0,
      cache_key: path.basename(file),
    };
  }

  if (!allowLiveApi) {
    throw new Error("Claude enrichment cache miss. Rerun with --live to warm cache or use --offline.");
  }

  const apiKey = appConfig?.keys?.anthropic;
  if (!apiKey) throw new Error("Missing config.keys.anthropic for live Claude calls.");

  ensureBudget(
    budget,
    Number(costs.claude_enrichment_estimate_usd || COSTS.claude_enrichment_estimate_usd),
    "Claude enrichment"
  );

  const res = await httpsPostWithRetry(
    "api.anthropic.com",
    "/v1/messages",
    {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: enrichModel,
      max_tokens: 4500,
      messages: [{ role: "user", content: prompt }],
    },
    {
      retries: 1,
      retryDelayMs: 1200,
      timeoutMs: 45000,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Claude enrichment failed: status ${res.status}`);
  }

  const usage = {
    input_tokens: Number(res.body?.usage?.input_tokens || 0),
    output_tokens: Number(res.body?.usage?.output_tokens || 0),
  };

  let parsed;
  try {
    parsed = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
  } catch {
    parsed = [];
  }

  const enrichedItems = (items || []).map((item, idx) => ({
    ...item,
    wim_brief:
      typeof parsed?.[idx]?.wim_brief === "string" && parsed[idx].wim_brief.trim()
        ? parsed[idx].wim_brief.trim()
        : null,
    wim:
      typeof parsed?.[idx]?.wim === "string" && parsed[idx].wim.trim()
        ? parsed[idx].wim.trim()
        : null,
    baseScore:
      typeof parsed?.[idx]?.baseScore === "number"
        ? parsed[idx].baseScore
        : 5.0,
    implications:
      typeof parsed?.[idx]?.implications === "string" && parsed[idx].implications.trim()
        ? parsed[idx].implications.trim()
        : null,
    watch_next:
      typeof parsed?.[idx]?.watch_next === "string" && parsed[idx].watch_next.trim()
        ? parsed[idx].watch_next.trim()
        : null,
  }));

  const costUsd = estimateClaudeCost(usage, costs, enrichModel);

  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "anthropic.messages",
    endpoint: "/v1/messages",
    model: enrichModel,
    input: {
      item_count: (items || []).length,
      hash,
      prompt,
    },
    raw_response: res.body,
    usage,
    cost_usd: costUsd,
    enriched_items: enrichedItems,
  });

  const nextBudget = recordBudgetCall(budget, {
    provider: "anthropic",
    purpose: "enrich",
    cache_key: path.basename(file),
    model: enrichModel,
    endpoint: "/v1/messages",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: costUsd,
    from_cache: false,
  });

  return {
    items: enrichedItems,
    usage,
    from_cache: false,
    cache_file: file,
    cost_usd: costUsd,
    cache_key: path.basename(file),
    budget: nextBudget,
  };
}

async function judgeWithClaudeCached({
  kind,
  payload,
  prompt,
  maxTokens = 700,
  model = JUDGE_MODELS.haiku,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const judgeModel = resolveAnthropicModel(model);
  const keyHash = stableHash({ kind, payload, prompt, maxTokens, model: judgeModel });
  const file = path.join(CACHE_CLAUDE_DIR, `judge_${sanitizeCacheKey(kind)}_${keyHash}.json`);

  if (!refreshCache && fs.existsSync(file)) {
    const cached = readJson(file, {});
    return {
      result: cached.result || null,
      usage: cached.usage || { input_tokens: 0, output_tokens: 0 },
      from_cache: true,
      cache_file: file,
      cost_usd: 0,
      cache_key: path.basename(file),
    };
  }

  if (!allowLiveApi) {
    throw new Error(`Claude judge cache miss (${kind}). Rerun with --live or use --no-judge.`);
  }

  const apiKey = appConfig?.keys?.anthropic;
  if (!apiKey) throw new Error("Missing config.keys.anthropic for live Claude judge calls.");

  ensureBudget(
    budget,
    Number(modelRateCard(judgeModel, costs).judge_estimate_usd || COSTS.claude_judge_estimate_usd),
    `Claude judge (${kind}) [${judgeModel}]`
  );

  const res = await httpsPostWithRetry(
    "api.anthropic.com",
    "/v1/messages",
    {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: judgeModel,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    },
    {
      retries: 1,
      retryDelayMs: 1000,
      timeoutMs: 35000,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Claude judge failed (${kind}): status ${res.status}`);
  }

  const usage = {
    input_tokens: Number(res.body?.usage?.input_tokens || 0),
    output_tokens: Number(res.body?.usage?.output_tokens || 0),
  };

  const rawText = res.body?.content?.[0]?.text || "";
  const parsed = parseJsonObjectLenient(rawText);
  const costUsd = estimateClaudeCost(usage, costs, judgeModel);

  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "anthropic.messages",
    endpoint: "/v1/messages",
    model: judgeModel,
    kind,
    input: {
      payload,
      prompt,
      max_tokens: maxTokens,
    },
    raw_response: res.body,
    raw_text: rawText,
    usage,
    cost_usd: costUsd,
    result: parsed,
  });

  const nextBudget = recordBudgetCall(budget, {
    provider: "anthropic",
    purpose: `judge:${kind}`,
    cache_key: path.basename(file),
    model: judgeModel,
    endpoint: "/v1/messages",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: costUsd,
    from_cache: false,
  });

  return {
    result: parsed,
    usage,
    from_cache: false,
    cache_file: file,
    cost_usd: costUsd,
    cache_key: path.basename(file),
    budget: nextBudget,
  };
}

function loadArchiveDigests(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs
    .readdirSync(archiveDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const full = path.join(archiveDir, f);
      try {
        return JSON.parse(fs.readFileSync(full, "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  stableHash,
  httpsPost,
  loadBudget,
  saveBudget,
  ensureBudget,
  recordBudgetCall,
  estimateClaudeCost,
  parseJsonArrayLenient,
  parseJsonObjectLenient,
  fetchTopicNewsCached,
  enrichItemsCached,
  judgeWithClaudeCached,
  loadArchiveDigests,
};
