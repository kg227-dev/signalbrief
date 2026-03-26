/* SignalBrief — shared preference state/payload runtime helpers */
(function bootstrapPreferencesStateRuntime(globalScope) {
  const Core = globalScope.SignalBriefPrefsStateCoreRuntime || {};
  const Model = globalScope.SignalBriefPrefsStateModelRuntime || {};
  const {
    defaultNormalizeDay,
    buildNormalizeDays,
    defaultDaysFromFrequency,
    defaultFrequencyFromDays,
    createTopicState,
  } = Core;
  const { createPreferenceStateModel } = Model;

  function createPreferenceState({
    initial = {},
    defaultDepth = "headline_plus_why",
    normalizeDay,
    normalizeDays,
    daysFromFrequency,
    frequencyFromDays,
  } = {}) {
    const normalizeDayFn = typeof normalizeDay === "function" ? normalizeDay : defaultNormalizeDay;
    const normalizeDaysFn = typeof normalizeDays === "function"
      ? normalizeDays
      : buildNormalizeDays(normalizeDayFn);
    const daysFromFrequencyFn = typeof daysFromFrequency === "function"
      ? daysFromFrequency
      : defaultDaysFromFrequency;
    const frequencyFromDaysFn = typeof frequencyFromDays === "function"
      ? frequencyFromDays
      : (days) => defaultFrequencyFromDays(normalizeDaysFn, days);
    if (typeof createPreferenceStateModel !== "function") {
      throw new Error("SignalBriefPrefsStateModelRuntime.createPreferenceStateModel is required");
    }

    return createPreferenceStateModel({
      topicState: createTopicState(initial.topics),
      defaultDepth,
      normalizeDayFn,
      normalizeDaysFn,
      frequencyFromDaysFn,
      initialDepth: initial.depth,
      initialDeliveryTime: initial.delivery_time || initial.deliveryTime,
      initialDaysOfWeek: initial.days_of_week || initial.daysOfWeek || daysFromFrequencyFn(initial.frequency || "daily_weekday"),
    });
  }

  function buildSignupPayload({
    state,
    name,
    email,
    referralToken,
  }) {
    const snapshot = state.snapshot();
    return {
      name: String(name || "").trim(),
      email: String(email || "").trim(),
      topics: snapshot.topics,
      depth: snapshot.depth,
      delivery_time: snapshot.delivery_time,
      frequency: snapshot.frequency,
      days_of_week: snapshot.days_of_week,
      referral_token: String(referralToken || "").trim() || null,
    };
  }

  function buildSettingsPayload({
    state,
    token,
    name,
  }) {
    const snapshot = state.snapshot();
    return {
      token: String(token || "").trim(),
      name: String(name || "").trim(),
      topics: snapshot.topics,
      preferences: {
        depth: snapshot.depth,
        delivery_time: snapshot.delivery_time,
        frequency: snapshot.frequency,
        days_of_week: snapshot.days_of_week,
        email_enabled: true,
      },
    };
  }

  globalScope.SignalBriefPrefsStateRuntime = {
    createPreferenceState,
    buildSignupPayload,
    buildSettingsPayload,
  };
})(window);
