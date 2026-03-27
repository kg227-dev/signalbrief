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

  const INDUSTRY_TOPICS = [...FALLBACK_INDUSTRY_TOPICS];
  const DEFAULT_TOPICS = [...INDUSTRY_TOPICS];
  const MAX_CUSTOM_KEYWORDS = 0;

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
    : ({ industryTopics, defaultTopics }) => ({
      industries: industryTopics.slice(),
      topics: defaultTopics.slice(),
    });

  const deriveTopicCatalog = typeof topicRuntime.deriveTopicCatalog === "function"
    ? topicRuntime.deriveTopicCatalog
    : (payload, { fallbackIndustries }) => {
      const industries = Array.isArray(payload?.industries) ? payload.industries.map(String).filter(Boolean) : [];
      const topics = Array.isArray(payload?.topics) ? payload.topics.map(String).filter(Boolean) : [];
      const nextIndustries = industries.length ? industries : fallbackIndustries;
      return {
        industries: nextIndustries,
        topics: topics.length ? topics : [...nextIndustries],
      };
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
      return "";
    };

  const topicDisplayLabelHelper = typeof topicRuntime.topicDisplayLabel === "function"
    ? topicRuntime.topicDisplayLabel
    : (topic, opts = {}) => {
      const key = String(topic || "");
      const defaults = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
      const labels = opts.topicLabels && typeof opts.topicLabels === "object" ? opts.topicLabels : {};
      if (!key) return "";
      return defaults.includes(key) ? (labels[key] || key) : key;
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

  function getTopicCatalog() {
    return buildTopicCatalogSnapshot({
      industryTopics: INDUSTRY_TOPICS,
      defaultTopics: DEFAULT_TOPICS,
    });
  }

  function setTopicCatalog(payload = {}) {
    const nextCatalog = deriveTopicCatalog(payload, {
      fallbackIndustries: FALLBACK_INDUSTRY_TOPICS,
    });
    replaceArray(INDUSTRY_TOPICS, nextCatalog.industries);
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

  function topicDisplayLabel(topic) {
    return topicDisplayLabelHelper(topic, {
      defaultTopics: DEFAULT_TOPICS,
      topicLabels: TOPIC_LABELS,
    });
  }

  globalScope.SignalBriefPrefsRuntime = {
    INDUSTRY_TOPICS,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    TOPIC_LABELS,
    DEFAULT_DEPTH,
    getTopicCatalog,
    loadTopicCatalog,
    normalizeDay,
    normalizeDays,
    topicKeyFromInput,
    topicDisplayLabel,
    isWeekdays,
    isEveryday,
    daysFromFrequency,
    frequencyFromDays,
  };
})(window);
