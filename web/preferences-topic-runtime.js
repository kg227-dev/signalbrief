/* SignalBrief — preference topic helper runtime */
(function bootstrapPreferencesTopicRuntime(globalScope) {
  function replaceArray(target, nextValues) {
    target.splice(0, target.length, ...nextValues);
  }

  function sanitizeTopicList(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    for (const value of values) {
      const topic = String(value || "").trim();
      if (!topic || out.includes(topic)) continue;
      out.push(topic);
    }
    return out;
  }

  function buildTopicCatalogSnapshot({ industryTopics, capabilityTopics, defaultTopics }) {
    return {
      industries: industryTopics.slice(),
      capabilities: capabilityTopics.slice(),
      topics: defaultTopics.slice(),
    };
  }

  function deriveTopicCatalog(payload, { fallbackIndustries, fallbackCapabilities }) {
    const industries = sanitizeTopicList(payload && payload.industries);
    const capabilities = sanitizeTopicList(payload && payload.capabilities);
    const defaults = sanitizeTopicList(payload && payload.topics);

    const nextIndustries = industries.length ? industries : fallbackIndustries;
    const nextCapabilities = capabilities.length ? capabilities : fallbackCapabilities;
    const nextDefaults = defaults.length ? defaults : [...nextIndustries, ...nextCapabilities];

    return {
      industries: nextIndustries,
      capabilities: nextCapabilities,
      topics: nextDefaults,
    };
  }

  function normalizeTopicLookupValue(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/×/g, " x ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function topicKeyFromInput(value, opts = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
    const labels = opts.topicLabels && typeof opts.topicLabels === "object" ? opts.topicLabels : {};
    if (opts.matchDefault) {
      const normalizedInput = normalizeTopicLookupValue(raw);
      const defaultMatch = defaults.find((topic) => {
        const key = String(topic || "");
        const label = String(labels[key] || "");
        return (
          normalizeTopicLookupValue(key) === normalizedInput
          || (label && normalizeTopicLookupValue(label) === normalizedInput)
        );
      });
      if (defaultMatch) return defaultMatch;
    }

    return "";
  }

  function topicDisplayLabel(topic, opts = {}) {
    const key = String(topic || "");
    if (!key) return "";

    const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
    const labels = opts.topicLabels && typeof opts.topicLabels === "object" ? opts.topicLabels : {};
    return defaults.includes(key) ? (labels[key] || key) : key;
  }

  globalScope.SignalBriefPrefsTopicRuntime = {
    replaceArray,
    sanitizeTopicList,
    buildTopicCatalogSnapshot,
    deriveTopicCatalog,
    normalizeTopicLookupValue,
    topicKeyFromInput,
    topicDisplayLabel,
  };
})(window);
