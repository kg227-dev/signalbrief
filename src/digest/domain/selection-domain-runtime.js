const { createSelectionPolicy } = require("./digest-policy-domain-runtime");
const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");

function normalizeTag(tag) {
  return String(tag || "").toLowerCase().trim();
}

function defaultNormalizeUrl(url) {
  return normalizeCanonicalUrl(url);
}

function defaultHeadlineFingerprint(item) {
  return String(item?.headline || "").toLowerCase().trim().slice(0, 40);
}

function resolveAdapters(adapters) {
  return {
    normalizeUrl: typeof adapters.normalizeUrl === "function" ? adapters.normalizeUrl : defaultNormalizeUrl,
    parseDomain: typeof adapters.parseDomain === "function" ? adapters.parseDomain : (() => "unknown"),
    normalizeTopic: typeof adapters.normalizeTopicToken === "function" ? adapters.normalizeTopicToken : normalizeTag,
    headlineFingerprint: typeof adapters.headlineFingerprint === "function"
      ? adapters.headlineFingerprint
      : defaultHeadlineFingerprint,
    isCandidate: typeof adapters.isCandidate === "function"
      ? adapters.isCandidate
      : (_item, ctx) => Boolean(ctx.headlineKey || ctx.urlKey),
  };
}

function dedupeCandidates(items, adapterFns) {
  const seenHeadline = new Set();
  const seenUrl = new Set();
  return items.filter((item) => {
    const headlineKey = String(adapterFns.headlineFingerprint(item) || "");
    const urlKey = String(adapterFns.normalizeUrl(item?.url || "") || "");
    if (!adapterFns.isCandidate(item, { headlineKey, urlKey })) return false;
    if (headlineKey && seenHeadline.has(headlineKey)) return false;
    if (urlKey && seenUrl.has(urlKey)) return false;
    if (headlineKey) seenHeadline.add(headlineKey);
    if (urlKey) seenUrl.add(urlKey);
    return true;
  });
}

function createSelectionState() {
  return {
    tagCounts: Object.create(null),
    domainCounts: Object.create(null),
    customCount: 0,
    selected: [],
  };
}

function createUnderCapsFn(policy, adapterFns, state) {
  return (item) => {
    const tag = String(item?.tag || "");
    if (!tag) return false;
    if ((state.tagCounts[tag] || 0) >= policy.perTagCap) return false;
    if (policy.customTags.size > 0 && policy.customTags.has(normalizeTag(tag)) && state.customCount >= policy.maxCustomItems) {
      return false;
    }
    const domain = adapterFns.parseDomain(item);
    if (Number.isFinite(policy.perSourceCap) && (state.domainCounts[domain] || 0) >= policy.perSourceCap) return false;
    return true;
  };
}

function addSelectedItem(item, state, policy, adapterFns) {
  const domain = adapterFns.parseDomain(item);
  state.tagCounts[item.tag] = (state.tagCounts[item.tag] || 0) + 1;
  state.domainCounts[domain] = (state.domainCounts[domain] || 0) + 1;
  if (policy.customTags.has(normalizeTag(item.tag))) state.customCount += 1;
  state.selected.push({ ...item, source_domain: item.source_domain || domain });
}

function pickPoolIndex(pool, state, policy, adapterFns, underCaps, lastTag, allowAdjacentTag) {
  let bestIdx = -1;
  let bestCount = Infinity;
  let bestDomainCount = Infinity;
  let bestPriority = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    if (!underCaps(item)) continue;
    const tag = String(item?.tag || "");
    if (!allowAdjacentTag && lastTag && tag === lastTag) continue;

    const count = state.tagCounts[tag] || 0;
    const domainCount = state.domainCounts[adapterFns.parseDomain(item)] || 0;
    const priority = Number(policy.tagPriority[adapterFns.normalizeTopic(tag)] || 0);
    const betterScore = (
      count < bestCount
      || (count === bestCount && domainCount < bestDomainCount)
      || (count === bestCount && domainCount === bestDomainCount && priority > bestPriority)
    );

    if (!betterScore) continue;
    bestCount = count;
    bestDomainCount = domainCount;
    bestPriority = priority;
    bestIdx = i;
  }

  return bestIdx;
}

function seedCustomTagSelection(pool, state, policy, underCaps, adapterFns) {
  if (policy.customTagOrder.length === 0 || policy.maxCustomItems <= 0) return;
  for (const customTag of policy.customTagOrder) {
    if (state.selected.length >= policy.maxItems || state.customCount >= policy.maxCustomItems) break;
    const idx = pool.findIndex((item) => normalizeTag(item?.tag) === customTag && underCaps(item));
    if (idx === -1) continue;
    addSelectedItem(pool.splice(idx, 1)[0], state, policy, adapterFns);
  }
}

function selectItemsByPolicy(allItems, selectionPolicy = {}, adapters = {}) {
  const policy = createSelectionPolicy(selectionPolicy);
  const adapterFns = resolveAdapters(adapters);
  const sourceItems = Array.isArray(allItems) ? allItems : [];
  const pool = dedupeCandidates(sourceItems, adapterFns).slice();
  const state = createSelectionState();
  const underCaps = createUnderCapsFn(policy, adapterFns, state);

  seedCustomTagSelection(pool, state, policy, underCaps, adapterFns);

  while (state.selected.length < policy.maxItems && pool.length > 0) {
    const lastTag = state.selected.length > 0 ? state.selected[state.selected.length - 1].tag : null;
    const preferredIdx = pickPoolIndex(pool, state, policy, adapterFns, underCaps, lastTag, false);
    const selectedIdx = preferredIdx === -1
      ? pickPoolIndex(pool, state, policy, adapterFns, underCaps, lastTag, true)
      : preferredIdx;
    if (selectedIdx === -1) break;
    addSelectedItem(pool.splice(selectedIdx, 1)[0], state, policy, adapterFns);
  }

  return state.selected;
}

module.exports = {
  selectItemsByPolicy,
};
