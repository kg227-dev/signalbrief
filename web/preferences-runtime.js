/* SignalBrief — shared topic/schedule runtime helpers */
(function bootstrapPreferencesRuntime(globalScope) {
  const topicRuntime = globalScope.SignalBriefPrefsTopicRuntime || {};
  const scheduleRuntime = globalScope.SignalBriefPrefsScheduleRuntime || {};

  // MVP topic set: 7 sectors only, no capabilities.
  const FALLBACK_INDUSTRY_TOPICS = [
    "HEALTHCARE",
    "LIFE SCIENCES",
    "TECHNOLOGY",
    "ENERGY",
    "FINANCIAL SERVICES",
    "CONSUMER & RETAIL",
    "INDUSTRIALS",
  ];

  const FALLBACK_CAPABILITY_TOPICS = [];

  const INDUSTRY_TOPICS = [...FALLBACK_INDUSTRY_TOPICS];
  const CAPABILITY_TOPICS = [...FALLBACK_CAPABILITY_TOPICS];
  const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];
  const MAX_CUSTOM_KEYWORDS = 0; // MVP: no custom keywords

  const TOPIC_LABELS = {
    HEALTHCARE: "Healthcare",
    "LIFE SCIENCES": "Life Sciences",
    TECHNOLOGY: "Technology",
    ENERGY: "Energy",
    "FINANCIAL SERVICES": "Financial Services",
    "CONSUMER & RETAIL": "Consumer & Retail",
    INDUSTRIALS: "Industrials",
  };

  const DEFAULT_DEPTH = "headline_plus_why";
  let topicCatalogLoaded = false;

  const replaceArray = typeof topicRuntime.replaceArray === "function"
    ? topicRuntime.replaceArray
    : (target, nextValues) => target.splice(0, target.length, ...nextValues);

  const buildTopicCatalogSnapshot = typeof topicRuntime.buildTopicCatalogSnapshot === "function"
    ? topicRuntime.buildTopicCatalogSnapshot
    : ({ industryTopics, capabilityTopics, defaultTopics }) => ({
      industries: industryTopics.slice(),
      capabilities: capabilityTopics.slice(),
      topics: defaultTopics.slice(),
    });

  const deriveTopicCatalog = typeof topicRuntime.deriveTopicCatalog === "function"
    ? topicRuntime.deriveTopicCatalog
    : (payload, { fallbackIndustries, fallbackCapabilities }) => {
      const industries = Array.isArray(payload?.industries) ? payload.industries.map(String).filter(Boolean) : [];
      const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities.map(String).filter(Boolean) : [];
      const topics = Array.isArray(payload?.topics) ? payload.topics.map(String).filter(Boolean) : [];
      const nextIndustries = industries.length ? industries : fallbackIndustries;
      const nextCapabilities = capabilities.length ? capabilities : fallbackCapabilities;
      return {
        industries: nextIndustries,
        capabilities: nextCapabilities,
        topics: topics.length ? topics : [...nextIndustries, ...nextCapabilities],
      };
    };

  const normalizeCustomTopicInput = typeof topicRuntime.normalizeCustomTopicInput === "function"
    ? topicRuntime.normalizeCustomTopicInput
    : (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return slug ? `custom_${slug}` : "";
    };

  const topicKeyFromInputHelper = typeof topicRuntime.topicKeyFromInput === "function"
    ? topicRuntime.topicKeyFromInput
    : (value, opts = {}) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
      if (opts.matchDefault) {
        const match = defaults.find((topic) => topic.toLowerCase() === raw.toLowerCase());
        if (match) return match;
      }
      return normalizeCustomTopicInput(raw);
    };

  const isCustomTopicHelper = typeof topicRuntime.isCustomTopic === "function"
    ? topicRuntime.isCustomTopic
    : (topic, opts = {}) => {
      const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
      return !defaults.includes(String(topic || ""));
    };

  const formatCustomLabel = typeof topicRuntime.formatCustomLabel === "function"
    ? topicRuntime.formatCustomLabel
    : (topic) => String(topic || "").replace(/^custom_/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const topicDisplayLabelHelper = typeof topicRuntime.topicDisplayLabel === "function"
    ? topicRuntime.topicDisplayLabel
    : (topic, opts = {}) => {
      const key = String(topic || "");
      const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
      const labels = opts.topicLabels && typeof opts.topicLabels === "object" ? opts.topicLabels : {};
      if (!key) return "";
      if (defaults.includes(key)) return labels[key] || key;
      return formatCustomLabel(key);
    };

  const normalizeDay = typeof scheduleRuntime.normalizeDay === "function"
    ? scheduleRuntime.normalizeDay
    : (day) => {
      const n = Number(day);
      if (!Number.isFinite(n)) return null;
      const normalized = Math.floor(n);
      return normalized >= 0 && normalized <= 6 ? normalized : null;
    };

  const normalizeDays = typeof scheduleRuntime.normalizeDays === "function"
    ? scheduleRuntime.normalizeDays
    : (days) => {
      const values = Array.isArray(days) ? days : [];
      const unique = [];
      for (const day of values) {
        const normalized = normalizeDay(day);
        if (normalized == null || unique.includes(normalized)) continue;
        unique.push(normalized);
      }
      return unique;
    };

  const isWeekdays = typeof scheduleRuntime.isWeekdays === "function"
    ? scheduleRuntime.isWeekdays
    : (days) => normalizeDays(days).length === 5 && [1, 2, 3, 4, 5].every((day) => normalizeDays(days).includes(day));

  const isEveryday = typeof scheduleRuntime.isEveryday === "function"
    ? scheduleRuntime.isEveryday
    : (days) => normalizeDays(days).length === 7;

  const daysFromFrequency = typeof scheduleRuntime.daysFromFrequency === "function"
    ? scheduleRuntime.daysFromFrequency
    : (freq) => (freq === "daily_all" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);

  const frequencyFromDays = typeof scheduleRuntime.frequencyFromDays === "function"
    ? scheduleRuntime.frequencyFromDays
    : (days) => {
      const normalized = normalizeDays(days);
      if (normalized.length === 5 && [1, 2, 3, 4, 5].every((day) => normalized.includes(day))) return "daily_weekday";
      if (normalized.length === 7) return "daily_all";
      return "custom";
    };

  const normalizeTelegram = typeof scheduleRuntime.normalizeTelegram === "function"
    ? scheduleRuntime.normalizeTelegram
    : (value) => String(value || "").trim().replace(/^@+/, "") || null;

  function getTopicCatalog() {
    return buildTopicCatalogSnapshot({
      industryTopics: INDUSTRY_TOPICS,
      capabilityTopics: CAPABILITY_TOPICS,
      defaultTopics: DEFAULT_TOPICS,
    });
  }

  function setTopicCatalog(payload = {}) {
    const nextCatalog = deriveTopicCatalog(payload, {
      fallbackIndustries: FALLBACK_INDUSTRY_TOPICS,
      fallbackCapabilities: FALLBACK_CAPABILITY_TOPICS,
    });
    replaceArray(INDUSTRY_TOPICS, nextCatalog.industries);
    replaceArray(CAPABILITY_TOPICS, nextCatalog.capabilities);
    replaceArray(DEFAULT_TOPICS, nextCatalog.topics);
    topicCatalogLoaded = true;
    return getTopicCatalog();
  }

  async function loadTopicCatalog(opts = {}) {
    if (topicCatalogLoaded && !opts.force) return getTopicCatalog();
    if (typeof fetch !== "function") {
      topicCatalogLoaded = true;
      return getTopicCatalog();
    }

    try {
      const res = await fetch("/api/topics", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload && typeof payload === "object") {
          return setTopicCatalog(payload);
        }
      }
    } catch (err) {
      const debugUi = typeof globalScope?.location?.search === "string"
        && globalScope.location.search.includes("debug_ui=1");
      if (debugUi) {
        const message = err && err.message ? err.message : String(err || "unknown error");
        console.warn(`[prefs] topic catalog fallback: ${message}`);
      }
    }

    topicCatalogLoaded = true;
    return getTopicCatalog();
  }

  function topicKeyFromInput(value, opts = {}) {
    return topicKeyFromInputHelper(value, {
      ...opts,
      defaultTopics: DEFAULT_TOPICS,
      topicLabels: TOPIC_LABELS,
    });
  }

  function isCustomTopic(topic) {
    return isCustomTopicHelper(topic, { defaultTopics: DEFAULT_TOPICS });
  }

  function topicDisplayLabel(topic) {
    return topicDisplayLabelHelper(topic, {
      defaultTopics: DEFAULT_TOPICS,
      topicLabels: TOPIC_LABELS,
    });
  }

  globalScope.SignalBriefPrefsRuntime = {
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    TOPIC_LABELS,
    DEFAULT_DEPTH,
    getTopicCatalog,
    loadTopicCatalog,
    normalizeDay,
    normalizeDays,
    normalizeCustomTopicInput,
    topicKeyFromInput,
    isCustomTopic,
    formatCustomLabel,
    topicDisplayLabel,
    isWeekdays,
    isEveryday,
    daysFromFrequency,
    frequencyFromDays,
    normalizeTelegram,
  };
})(window);
