/* SignalBrief — shared preference model for onboarding/settings flows */
(function bootstrapPreferences(globalScope) {
  const runtime = globalScope.SignalBriefPrefsRuntime || {};
  const stateRuntime = globalScope.SignalBriefPrefsStateRuntime || {};

  // MVP topic set: 7 sectors only.
  const FALLBACK_INDUSTRY_TOPICS = [
    "HEALTHCARE",
    "LIFE SCIENCES",
    "TECHNOLOGY",
    "ENERGY",
    "FINANCIAL SERVICES",
    "CONSUMER & RETAIL",
    "INDUSTRIALS",
  ];
  const INDUSTRY_TOPICS = Array.isArray(runtime.INDUSTRY_TOPICS)
    ? runtime.INDUSTRY_TOPICS
    : FALLBACK_INDUSTRY_TOPICS;
  const DEFAULT_TOPICS = Array.isArray(runtime.DEFAULT_TOPICS)
    ? runtime.DEFAULT_TOPICS
    : [...INDUSTRY_TOPICS];
  const MAX_CUSTOM_KEYWORDS = 0;
  const TOPIC_LABELS = runtime.TOPIC_LABELS && typeof runtime.TOPIC_LABELS === "object"
    ? runtime.TOPIC_LABELS
    : {};
  const DEFAULT_DEPTH = String(runtime.DEFAULT_DEPTH || "headline_plus_why");

  function normalizeDayFallback(day) {
    const n = Number(day);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    return normalized >= 0 && normalized <= 6 ? normalized : null;
  }

  function normalizeDaysFallback(days) {
    const values = Array.isArray(days) ? days : [];
    const unique = [];
    for (const day of values) {
      const normalized = normalizeDayFallback(day);
      if (normalized == null || unique.includes(normalized)) continue;
      unique.push(normalized);
    }
    return unique;
  }

  function daysFromFrequencyFallback(freq) {
    if (freq === "daily_all") return [0, 1, 2, 3, 4, 5, 6];
    if (freq === "daily_weekday" || freq === "weekdays") return [1, 2, 3, 4, 5];
    if (freq === "sixdays") return [1, 2, 3, 4, 5, 6];
    return [1, 2, 3, 4, 5];
  }

  function frequencyFromDaysFallback(days) {
    const normalized = normalizeDaysFallback(days);
    const weekdays = normalized.length === 5 && [1, 2, 3, 4, 5].every((d) => normalized.includes(d));
    if (weekdays) return "daily_weekday";
    if (normalized.length === 7) return "daily_all";
    return "custom";
  }

  function topicKeyFromInputFallback(value, opts = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (opts.matchDefault) {
      const normalizedInput = String(raw || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/×/g, " x ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const defaultMatch = DEFAULT_TOPICS.find((topic) => {
        const label = TOPIC_LABELS[topic] || "";
        const normalizedTopic = String(topic || "")
          .toLowerCase()
          .replace(/&/g, " and ")
          .replace(/×/g, " x ")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const normalizedLabel = String(label || "")
          .toLowerCase()
          .replace(/&/g, " and ")
          .replace(/×/g, " x ")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return normalizedTopic === normalizedInput || (normalizedLabel && normalizedLabel === normalizedInput);
      });
      if (defaultMatch) return defaultMatch;
    }
    return "";
  }

  function topicDisplayLabelFallback(topic) {
    const key = String(topic || "");
    if (!key) return "";
    return DEFAULT_TOPICS.includes(key) ? (TOPIC_LABELS[key] || key) : key;
  }

  function getTopicCatalogFallback() {
    return {
      industries: INDUSTRY_TOPICS.slice(),
      topics: DEFAULT_TOPICS.slice(),
    };
  }

  function selectRuntimeFn(fn, fallbackFn) {
    return typeof fn === "function" ? fn : fallbackFn;
  }

  const getTopicCatalog = selectRuntimeFn(runtime.getTopicCatalog, getTopicCatalogFallback);
  const loadTopicCatalog = selectRuntimeFn(runtime.loadTopicCatalog, async () => getTopicCatalogFallback());
  const normalizeDay = selectRuntimeFn(runtime.normalizeDay, normalizeDayFallback);
  const normalizeDays = selectRuntimeFn(runtime.normalizeDays, normalizeDaysFallback);
  const topicKeyFromInput = selectRuntimeFn(runtime.topicKeyFromInput, topicKeyFromInputFallback);
  const topicDisplayLabel = selectRuntimeFn(runtime.topicDisplayLabel, topicDisplayLabelFallback);
  const daysFromFrequency = selectRuntimeFn(runtime.daysFromFrequency, daysFromFrequencyFallback);
  const frequencyFromDays = selectRuntimeFn(runtime.frequencyFromDays, frequencyFromDaysFallback);
  const isWeekdays = selectRuntimeFn(
    runtime.isWeekdays,
    (days) => frequencyFromDaysFallback(days) === "daily_weekday"
  );
  const isEveryday = selectRuntimeFn(
    runtime.isEveryday,
    (days) => normalizeDaysFallback(days).length === 7
  );
  const createStateFactory = typeof stateRuntime.createPreferenceState === "function"
    ? stateRuntime.createPreferenceState
    : null;
  const buildSignupFactory = typeof stateRuntime.buildSignupPayload === "function"
    ? stateRuntime.buildSignupPayload
    : null;
  const buildSettingsFactory = typeof stateRuntime.buildSettingsPayload === "function"
    ? stateRuntime.buildSettingsPayload
    : null;

  function createPreferenceState(initial = {}) {
    if (!createStateFactory) {
      throw new Error("SignalBriefPrefsStateRuntime.createPreferenceState is required");
    }
    return createStateFactory({
      initial,
      defaultDepth: DEFAULT_DEPTH,
      normalizeDay,
      normalizeDays,
      daysFromFrequency,
      frequencyFromDays,
    });
  }

  function buildSignupPayload({ state, name, email, referralToken }) {
    if (!buildSignupFactory) {
      throw new Error("SignalBriefPrefsStateRuntime.buildSignupPayload is required");
    }
    return buildSignupFactory({
      state,
      name,
      email,
      referralToken,
    });
  }

  function buildSettingsPayload({ state, token, name }) {
    if (!buildSettingsFactory) {
      throw new Error("SignalBriefPrefsStateRuntime.buildSettingsPayload is required");
    }
    return buildSettingsFactory({
      state,
      token,
      name,
    });
  }

  globalScope.SignalBriefPrefs = {
    INDUSTRY_TOPICS,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    TOPIC_LABELS,
    DEFAULT_DEPTH,
    getTopicCatalog,
    loadTopicCatalog,
    createPreferenceState,
    topicKeyFromInput,
    topicDisplayLabel,
    isWeekdays,
    isEveryday,
    daysFromFrequency,
    frequencyFromDays,
    buildSignupPayload,
    buildSettingsPayload,
  };
})(window);
