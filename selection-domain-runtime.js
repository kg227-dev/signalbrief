function normalizeTag(tag) {
  return String(tag || "").toLowerCase().trim();
}

function defaultNormalizeUrl(url) {
  const raw = String(url || "").trim();
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

function defaultHeadlineFingerprint(item) {
  return String(item?.headline || "").toLowerCase().trim().slice(0, 40);
}

function selectItemsByPolicy(allItems, selectionPolicy = {}, adapters = {}) {
  const policy = selectionPolicy && typeof selectionPolicy === "object" ? selectionPolicy : {};
  const maxItems = Math.max(1, Number(policy.maxItems ?? 7) || 7);
  const perTagCap = Math.max(1, Number(policy.perTagCap ?? 2) || 2);
  const perSourceCandidate = Number(policy.perSourceCap);
  const perSourceCap = Number.isFinite(perSourceCandidate) ? Math.max(1, perSourceCandidate) : Infinity;
  const customTagOrder = [...new Set((Array.isArray(policy.customTagOrder) ? policy.customTagOrder : [])
    .map(normalizeTag)
    .filter(Boolean))];
  const customTags = new Set(
    policy.customTags instanceof Set
      ? [...policy.customTags].map(normalizeTag).filter(Boolean)
      : customTagOrder
  );
  const tagPriority = policy.tagPriority && typeof policy.tagPriority === "object" ? policy.tagPriority : {};
  const explicitCustomCap = Number(policy.maxCustomItems);
  const maxCustomItems = Number.isFinite(explicitCustomCap)
    ? Math.max(0, explicitCustomCap)
    : (customTagOrder.length > 0 ? Math.max(1, Math.floor(maxItems * 0.4)) : Infinity);

  const normalizeUrl = typeof adapters.normalizeUrl === "function" ? adapters.normalizeUrl : defaultNormalizeUrl;
  const parseDomain = typeof adapters.parseDomain === "function" ? adapters.parseDomain : (() => "unknown");
  const normalizeTopic = typeof adapters.normalizeTopicToken === "function"
    ? adapters.normalizeTopicToken
    : normalizeTag;
  const headlineFingerprint = typeof adapters.headlineFingerprint === "function"
    ? adapters.headlineFingerprint
    : defaultHeadlineFingerprint;
  const isCandidate = typeof adapters.isCandidate === "function"
    ? adapters.isCandidate
    : (_item, ctx) => Boolean(ctx.headlineKey || ctx.urlKey);

  const sourceItems = Array.isArray(allItems) ? allItems : [];
  const seenHeadline = new Set();
  const seenUrl = new Set();
  const deduped = sourceItems.filter((item) => {
    const headlineKey = String(headlineFingerprint(item) || "");
    const urlKey = String(normalizeUrl(item?.url || "") || "");
    if (!isCandidate(item, { headlineKey, urlKey })) return false;
    if (headlineKey && seenHeadline.has(headlineKey)) return false;
    if (urlKey && seenUrl.has(urlKey)) return false;
    if (headlineKey) seenHeadline.add(headlineKey);
    if (urlKey) seenUrl.add(urlKey);
    return true;
  });

  const tagCounts = {};
  const domainCounts = {};
  let customCount = 0;
  const selected = [];
  const pool = deduped.slice();

  const underCaps = (item) => {
    const tag = String(item?.tag || "");
    if (!tag) return false;
    if ((tagCounts[tag] || 0) >= perTagCap) return false;
    if (customTags.size > 0 && customTags.has(normalizeTag(tag)) && customCount >= maxCustomItems) {
      return false;
    }
    const domain = parseDomain(item);
    if (Number.isFinite(perSourceCap) && (domainCounts[domain] || 0) >= perSourceCap) return false;
    return true;
  };

  const addSelectedItem = (item) => {
    const domain = parseDomain(item);
    tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    if (customTags.has(normalizeTag(item.tag))) customCount += 1;
    selected.push({ ...item, source_domain: item.source_domain || domain });
  };

  const pickIndex = (lastTag, allowAdjacentTag = false) => {
    let bestIdx = -1;
    let bestCount = Infinity;
    let bestDomainCount = Infinity;
    let bestPriority = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      if (!underCaps(item)) continue;
      const tag = String(item?.tag || "");
      if (!allowAdjacentTag && lastTag && tag === lastTag) continue;
      const count = tagCounts[tag] || 0;
      const domainCount = domainCounts[parseDomain(item)] || 0;
      const priority = Number(tagPriority[normalizeTopic(tag)] || 0);
      if (
        count < bestCount
        || (count === bestCount && domainCount < bestDomainCount)
        || (count === bestCount && domainCount === bestDomainCount && priority > bestPriority)
      ) {
        bestCount = count;
        bestDomainCount = domainCount;
        bestPriority = priority;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  if (customTagOrder.length > 0 && maxCustomItems > 0) {
    for (const customTag of customTagOrder) {
      if (selected.length >= maxItems || customCount >= maxCustomItems) break;
      const idx = pool.findIndex((item) => normalizeTag(item?.tag) === customTag && underCaps(item));
      if (idx === -1) continue;
      const item = pool.splice(idx, 1)[0];
      addSelectedItem(item);
    }
  }

  while (selected.length < maxItems && pool.length > 0) {
    const lastTag = selected.length > 0 ? selected[selected.length - 1].tag : null;
    const idx = pickIndex(lastTag, false);
    const fallback = idx === -1 ? pickIndex(lastTag, true) : idx;
    if (fallback === -1) break;
    const item = pool.splice(fallback, 1)[0];
    addSelectedItem(item);
  }

  return selected;
}

module.exports = {
  selectItemsByPolicy,
};
