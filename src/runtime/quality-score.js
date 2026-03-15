const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("../digest/domain/topic-domain-runtime");

function mean(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stddev(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return 0;
  const avg = mean(nums);
  const variance = mean(nums.map((n) => (n - avg) ** 2));
  return Math.sqrt(variance);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

const normalizeToken = normalizeMatchText;

function normalizeCustomKeyword(topic) {
  return normalizeTopicToken(topic);
}

function rank(values) {
  const arr = values.map((v, i) => ({ v: Number(v), i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  for (let i = 0; i < arr.length;) {
    let j = i + 1;
    while (j < arr.length && arr[j].v === arr[i].v) j++;
    const avgRank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[arr[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const x = xs.slice(0, n).map(Number);
  const y = ys.slice(0, n).map(Number);
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function spearmanCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  return pearson(rank(xs.slice(0, n)), rank(ys.slice(0, n)));
}

function jaccardSimilarity(aValues, bValues) {
  const a = new Set((aValues || []).filter(Boolean));
  const b = new Set((bValues || []).filter(Boolean));
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const uni = new Set([...a, ...b]).size || 1;
  return inter / uni;
}

function tagDistribution(items) {
  const out = {};
  for (const item of (items || [])) {
    const key = normalizeTopicToken(item?.tag || "");
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function countAdjacencyViolations(items) {
  let n = 0;
  for (let i = 1; i < (items || []).length; i++) {
    if (normalizeTopicToken(items[i - 1]?.tag) && normalizeTopicToken(items[i - 1]?.tag) === normalizeTopicToken(items[i]?.tag)) n += 1;
  }
  return n;
}

function qualityBand(score) {
  const s = Number(score) || 0;
  if (s >= 85) return "strong";
  if (s >= 75) return "watch";
  return "poor";
}

function getItemWeight(tag, weights) {
  const tagNorm = normalizeTopicToken(tag);
  const entries = Object.entries(weights || {});
  let best = 0;
  let bestLen = 0;
  for (const [k, raw] of entries) {
    const key = normalizeTopicToken(k);
    if (!key || !tagNorm) continue;
    const matches = topicsRelated(tagNorm, key);
    if (!matches) continue;
    if (key.length > bestLen) {
      bestLen = key.length;
      best = Number(raw) || 0;
    }
  }
  return best;
}

function topicMatchScore(item, userTopics) {
  const topics = Array.isArray(userTopics) ? userTopics : [];
  if (!topics.length) return 7;
  const standard = topics
    .filter((t) => !String(t).startsWith("custom_"))
    .map(normalizeTopicToken)
    .filter(Boolean);
  const custom = topics
    .filter((t) => String(t).startsWith("custom_"))
    .map(normalizeCustomKeyword)
    .filter(Boolean);
  const tag = normalizeTopicToken(item?.tag || "");
  const text = normalizeMatchText(`${item?.headline || ""} ${item?.summary || ""} ${item?.wim || ""}`);
  const standardHit = standard.some((t) => topicsRelated(tag, t));
  const customHit = custom.some((kw) => text.includes(kw) || tag.includes(kw));
  if (standardHit || customHit) return 9;
  return 3;
}

function computeTopicFit(items, userTopics) {
  if (!Array.isArray(items) || !items.length) return 0;
  const topics = Array.isArray(userTopics) ? userTopics : [];
  if (!topics.length) return 100;
  let matched = 0;
  for (const item of items) {
    if (topicMatchScore(item, topics) >= 8.5) matched += 1;
  }
  return clamp((matched / items.length) * 100, 0, 100);
}

function computeRelevanceFit(items, userTopics, topicWeights) {
  const rows = (items || []).map((item) => ({
    relevance: Number(item?.relevanceScore || 0),
    weight: getItemWeight(item?.tag, topicWeights || {}),
    topic_match: Number(item?.topicMatch || topicMatchScore(item, userTopics)),
    base_score: Number(item?.baseScore || 0),
  }));
  if (!rows.length) return 0;

  const weightValues = rows.map((row) => row.weight);
  const scoreValues = rows.map((row) => row.relevance);
  const spreadScore = clamp((stddev(scoreValues) / 2.0) * 100, 0, 100);
  const hasWeightSignal = weightValues.some((value) => Math.abs(value) > 0.01)
    && new Set(weightValues.map((value) => value.toFixed(3))).size > 1;

  if (hasWeightSignal) {
    const corr = spearmanCorrelation(weightValues, scoreValues);
    const anomalies = rows.filter((row) => (row.weight <= -2 && row.relevance > 8) || (row.weight >= 4 && row.relevance < 5));
    const anomalyRate = rows.length ? anomalies.length / rows.length : 0;
    const corrNorm = ((corr + 1) / 2) * 100;
    const anomalyPenalty = Math.min(50, anomalyRate * 100);
    const score = clamp(0.7 * corrNorm + 0.3 * spreadScore - anomalyPenalty, 0, 100);
    return Number(score.toFixed(2));
  }

  if (rows.length < 3) {
    return rows.length ? 75 : 0;
  }

  const expected = rows.map((row) => Number((row.base_score * 0.6 + row.topic_match * 0.4).toFixed(3)));
  const corr = spearmanCorrelation(expected, scoreValues);
  const anomalies = rows.filter((row) => (row.topic_match >= 7 && row.relevance < 6) || (row.topic_match <= 3 && row.relevance > 8.8));
  const anomalyRate = rows.length ? anomalies.length / rows.length : 0;
  const corrNorm = ((corr + 1) / 2) * 100;
  const anomalyPenalty = Math.min(40, anomalyRate * 100);
  const score = clamp(0.75 * corrNorm + 0.25 * spreadScore - anomalyPenalty, 0, 100);
  return Number(score.toFixed(2));
}

function tokenSet(value) {
  return new Set(
    normalizeToken(value)
      .split(" ")
      .filter((t) => t.length >= 3)
  );
}

function overlapRatio(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter += 1;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}

function computeAnalysisQuality(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const completeness = mean(items.map((i) => (String(i?.wim || "").trim() ? 100 : 0)));
  const specificity = mean(items.map((i) => {
    const text = String(i?.wim || "");
    if (!text.trim()) return 0;
    const hasNumber = /[$%]|\b\d[\d,.]*\b/.test(text);
    const hasEntity = /\b[A-Z][a-z]{2,}\b/.test(text);
    return hasNumber && hasEntity ? 100 : (hasNumber || hasEntity ? 70 : 40);
  }));
  const actionability = mean(items.map((i) => {
    const text = normalizeToken(i?.wim || "");
    if (!text) return 0;
    const cues = ["implies", "watch", "next", "risk", "impact", "move", "should", "likely", "means"];
    const hit = cues.some((c) => text.includes(c));
    return hit ? 100 : 55;
  }));
  const differentiation = mean(items.map((i) => {
    const overlap = overlapRatio(i?.headline || "", i?.wim || "");
    return clamp((1 - overlap) * 100, 0, 100);
  }));
  const density = mean(items.map((i) => {
    const chars = String(i?.wim || "").trim().length;
    if (!chars) return 0;
    if (chars >= 140 && chars <= 340) return 100;
    if (chars >= 90 && chars < 140) return 80;
    if (chars > 340 && chars <= 520) return 75;
    return 55;
  }));
  const score = 0.35 * completeness + 0.2 * specificity + 0.2 * actionability + 0.15 * differentiation + 0.1 * density;
  return Number(clamp(score, 0, 100).toFixed(2));
}

function computeFreshnessAndDiversity(items, previousItems) {
  const total = (items || []).length;
  if (!total) return { score: 0, diversity: 0, freshness: 0 };

  const tags = tagDistribution(items);
  const uniqueTags = Object.keys(tags).length;
  const adjacencyViolations = countAdjacencyViolations(items);
  const maxTagCount = Object.values(tags).reduce((a, b) => Math.max(a, b), 0);
  const dominance = total ? maxTagCount / total : 1;
  const diversityIndex = total ? uniqueTags / total : 0;
  const adjacencyScore = total > 1 ? Math.max(0, 1 - adjacencyViolations / (total - 1)) : 1;
  const dominanceScore = Math.max(0, Math.min(1, 1 - Math.max(0, dominance - 0.4) / 0.6));
  const diversityScore = clamp((0.5 * diversityIndex + 0.3 * adjacencyScore + 0.2 * dominanceScore) * 100, 0, 100);

  const prevUrls = (previousItems || []).map((i) => String(i?.url || "").trim().toLowerCase()).filter(Boolean);
  const currUrls = (items || []).map((i) => String(i?.url || "").trim().toLowerCase()).filter(Boolean);
  let freshnessScore = 100;
  if (prevUrls.length && currUrls.length) {
    const overlap = jaccardSimilarity(prevUrls, currUrls);
    freshnessScore = clamp(100 - overlap * 100, 0, 100);
  }
  const score = clamp(0.6 * diversityScore + 0.4 * freshnessScore, 0, 100);
  return {
    score: Number(score.toFixed(2)),
    diversity: Number(diversityScore.toFixed(2)),
    freshness: Number(freshnessScore.toFixed(2)),
  };
}

function computeNarrativeUniqueness(items) {
  if (!Array.isArray(items) || items.length < 2) return 100;
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const entityA = Array.isArray(items[i]?.entity_keys) ? items[i].entity_keys : [];
      const entityB = Array.isArray(items[j]?.entity_keys) ? items[j].entity_keys : [];
      const entitySim = jaccardSimilarity(entityA, entityB);
      const headlineSim = overlapRatio(items[i]?.headline || "", items[j]?.headline || "");
      const keyA = String(items[i]?.storyline_key || "").trim();
      const keyB = String(items[j]?.storyline_key || "").trim();
      const sameStoryline = (keyA && keyB && keyA === keyB) ? 1 : 0;
      const pairSim = Math.max(sameStoryline, 0.5 * entitySim + 0.5 * headlineSim);
      totalSim += pairSim;
      pairs++;
    }
  }
  const avgSim = pairs > 0 ? totalSim / pairs : 0;
  return clamp((1 - avgSim) * 100, 0, 100);
}

function computeCustomCoverage(items, userTopics) {
  const topics = (Array.isArray(userTopics) ? userTopics : [])
    .filter((t) => String(t).startsWith("custom_"))
    .map(normalizeCustomKeyword)
    .filter(Boolean);
  if (!topics.length) return 100;

  const perKeyword = topics.map((kw) => {
    const hits = (items || []).filter((item) => {
      const text = normalizeToken([item?.tag, item?.headline, item?.summary, item?.wim].filter(Boolean).join(" "));
      return text.includes(kw);
    }).length;
    return hits;
  });
  const withHit = perKeyword.filter((n) => n >= 1).length;
  const coverage = topics.length ? withHit / topics.length : 0;
  const avgHits = mean(perKeyword);
  const score = clamp(coverage * 80 + Math.min(20, avgHits * 10), 0, 100);
  return Number(score.toFixed(2));
}

function computeDigestQualityScore(opts = {}) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const user = opts.user || {};
  const previousItems = Array.isArray(opts.previous_items) ? opts.previous_items : [];
  const topics = Array.isArray(user.topics) ? user.topics : [];
  const topicWeights = user.topic_weights || {};

  if (!items.length) {
    return {
      score: 0,
      band: qualityBand(0),
      components: {
        topic_fit: 0,
        relevance_fit: 0,
        analysis_quality: 0,
        freshness_diversity: 0,
        custom_coverage: 0,
        diversity: 0,
        freshness: 0,
      },
    };
  }

  const T = computeTopicFit(items, topics);
  const R = computeRelevanceFit(items, topics, topicWeights);
  const A = computeAnalysisQuality(items);
  const freshness = computeFreshnessAndDiversity(items, previousItems);
  const F = freshness.score;
  const C = computeCustomCoverage(items, topics);
  const N = computeNarrativeUniqueness(items);
  const score = clamp(0.25 * T + 0.18 * R + 0.25 * A + 0.12 * F + 0.10 * C + 0.10 * N, 0, 100);

  return {
    score: Number(score.toFixed(2)),
    band: qualityBand(score),
    components: {
      topic_fit: Number(T.toFixed(2)),
      relevance_fit: Number(R.toFixed(2)),
      analysis_quality: Number(A.toFixed(2)),
      freshness_diversity: Number(F.toFixed(2)),
      custom_coverage: Number(C.toFixed(2)),
      narrative_uniqueness: Number(N.toFixed(2)),
      diversity: freshness.diversity,
      freshness: freshness.freshness,
    },
  };
}

function computeQualityTrend(history, now = new Date()) {
  const rows = (Array.isArray(history) ? history : [])
    .map((r) => ({
      date_et: String(r?.date_et || "").trim(),
      score: Number(r?.score),
      ts_utc: String(r?.ts_utc || "").trim(),
    }))
    .filter((r) => r.date_et && Number.isFinite(r.score))
    .sort((a, b) => a.date_et.localeCompare(b.date_et));

  if (!rows.length) {
    return {
      current: null,
      avg_7d: null,
      delta_14d: null,
      floor_14d: null,
      sample_14d: 0,
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff7 = new Date(now.getTime() - 7 * dayMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const cutoff14 = new Date(now.getTime() - 14 * dayMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const last = rows[rows.length - 1];
  const rows7 = rows.filter((r) => r.date_et >= cutoff7);
  const rows14 = rows.filter((r) => r.date_et >= cutoff14);
  const avg7 = rows7.length ? mean(rows7.map((r) => r.score)) : null;
  const floor14 = rows14.length ? Math.min(...rows14.map((r) => r.score)) : null;
  const delta14 = rows14.length >= 2 ? (last.score - rows14[0].score) : null;

  return {
    current: Number(last.score.toFixed(2)),
    avg_7d: avg7 == null ? null : Number(avg7.toFixed(2)),
    delta_14d: delta14 == null ? null : Number(delta14.toFixed(2)),
    floor_14d: floor14 == null ? null : Number(floor14.toFixed(2)),
    sample_14d: rows14.length,
    band: qualityBand(last.score),
  };
}

module.exports = {
  computeDigestQualityScore,
  computeQualityTrend,
  qualityBand,
};
