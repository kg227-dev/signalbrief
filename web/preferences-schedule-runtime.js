/* SignalBrief — preference schedule helper runtime */
(function bootstrapPreferencesScheduleRuntime(globalScope) {
  function normalizeDay(day) {
    const n = Number(day);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 0 || normalized > 6) return null;
    return normalized;
  }

  function normalizeDays(days) {
    const values = Array.isArray(days) ? days : [];
    const unique = [];
    for (const day of values) {
      const normalized = normalizeDay(day);
      if (normalized == null || unique.includes(normalized)) continue;
      unique.push(normalized);
    }
    return unique;
  }

  function isWeekdays(days) {
    const normalized = normalizeDays(days);
    return normalized.length === 5 && [1, 2, 3, 4, 5].every((day) => normalized.includes(day));
  }

  function isEveryday(days) {
    return normalizeDays(days).length === 7;
  }

  function daysFromFrequency(freq) {
    if (freq === "daily_all") return [0, 1, 2, 3, 4, 5, 6];
    if (freq === "daily_weekday" || freq === "weekdays") return [1, 2, 3, 4, 5];
    if (freq === "sixdays") return [1, 2, 3, 4, 5, 6];
    return [1, 2, 3, 4, 5];
  }

  function frequencyFromDays(days) {
    const normalized = normalizeDays(days);
    if (isWeekdays(normalized)) return "daily_weekday";
    if (isEveryday(normalized)) return "daily_all";
    return "custom";
  }

  globalScope.SignalBriefPrefsScheduleRuntime = {
    normalizeDay,
    normalizeDays,
    isWeekdays,
    isEveryday,
    daysFromFrequency,
    frequencyFromDays,
  };
})(window);
