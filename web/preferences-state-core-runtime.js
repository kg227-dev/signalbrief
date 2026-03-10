/* SignalBrief — shared preference state core helpers */
(function bootstrapPreferencesStateCoreRuntime(globalScope) {
  function defaultNormalizeDay(day) {
    const n = Number(day);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    return normalized >= 0 && normalized <= 6 ? normalized : null;
  }

  function buildNormalizeDays(normalizeDayFn) {
    return (days) => {
      const values = Array.isArray(days) ? days : [];
      const unique = [];
      for (const day of values) {
        const normalized = normalizeDayFn(day);
        if (normalized == null || unique.includes(normalized)) continue;
        unique.push(normalized);
      }
      return unique;
    };
  }

  function defaultDaysFromFrequency() {
    return [1, 2, 3, 4, 5];
  }

  function defaultFrequencyFromDays(normalizeDaysFn, days) {
    return normalizeDaysFn(days).length === 7 ? "daily_all" : "daily_weekday";
  }

  function resolveTelegramNormalizer(normalizeTelegram) {
    if (typeof normalizeTelegram === "function") return normalizeTelegram;
    return (value) => {
      const raw = String(value || "").trim().replace(/^@+/, "");
      return raw || null;
    };
  }

  function toPositiveInteger(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.floor(numeric);
  }

  function createTopicState(initialTopics) {
    let selectedTopics = new Set(Array.isArray(initialTopics) ? initialTopics.map(String) : []);

    return {
      getTopics() {
        return Array.from(selectedTopics);
      },
      setTopics(topics) {
        selectedTopics = new Set(Array.isArray(topics) ? topics.map(String) : []);
        return this.getTopics();
      },
      hasTopic(topic) {
        return selectedTopics.has(String(topic || ""));
      },
      addTopic(topic) {
        const key = String(topic || "").trim();
        if (!key) return false;
        const sizeBefore = selectedTopics.size;
        selectedTopics.add(key);
        return selectedTopics.size !== sizeBefore;
      },
      removeTopic(topic) {
        return selectedTopics.delete(String(topic || ""));
      },
      toggleTopic(topic) {
        const key = String(topic || "").trim();
        if (!key) return false;
        if (selectedTopics.has(key)) {
          selectedTopics.delete(key);
          return false;
        }
        selectedTopics.add(key);
        return true;
      },
    };
  }

  globalScope.SignalBriefPrefsStateCoreRuntime = {
    defaultNormalizeDay,
    buildNormalizeDays,
    defaultDaysFromFrequency,
    defaultFrequencyFromDays,
    resolveTelegramNormalizer,
    toPositiveInteger,
    createTopicState,
  };
})(window);
