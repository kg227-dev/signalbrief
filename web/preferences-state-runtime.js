/* SignalBrief — shared preference state/payload runtime helpers */
(function bootstrapPreferencesStateRuntime(globalScope) {
  const Core = globalScope.SignalBriefPrefsStateCoreRuntime || {};
  const Model = globalScope.SignalBriefPrefsStateModelRuntime || {};
  const {
    defaultNormalizeDay,
    buildNormalizeDays,
    defaultDaysFromFrequency,
    defaultFrequencyFromDays,
    resolveTelegramNormalizer,
    toPositiveInteger,
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
      toPositiveInteger,
      initialDepth: initial.depth,
      initialDeliveryTime: initial.delivery_time || initial.deliveryTime,
      initialDaysOfWeek: initial.days_of_week || initial.daysOfWeek || daysFromFrequencyFn(initial.frequency || "daily_weekday"),
      initialItemsPerDigest: initial.items_per_digest || initial.itemsPerDigest,
    });
  }

  function buildSignupPayload({
    state,
    name,
    email,
    telegram,
    referralToken,
    normalizeTelegram,
  }) {
    const normalizeTelegramFn = resolveTelegramNormalizer(normalizeTelegram);
    const snapshot = state.snapshot();
    return {
      name: String(name || "").trim(),
      email: String(email || "").trim(),
      telegram: normalizeTelegramFn(telegram),
      topics: snapshot.topics,
      depth: snapshot.depth,
      delivery_time: snapshot.delivery_time,
      frequency: snapshot.frequency,
      days_of_week: snapshot.days_of_week,
      items_per_digest: snapshot.items_per_digest,
      referral_token: String(referralToken || "").trim() || null,
    };
  }

  function buildSettingsPayload({
    state,
    token,
    name,
    telegram,
    telegramEnabled,
    normalizeTelegram,
  }) {
    const normalizeTelegramFn = resolveTelegramNormalizer(normalizeTelegram);
    const snapshot = state.snapshot();
    return {
      token: String(token || "").trim(),
      name: String(name || "").trim(),
      telegram: normalizeTelegramFn(telegram),
      topics: snapshot.topics,
      preferences: {
        depth: snapshot.depth,
        delivery_time: snapshot.delivery_time,
        frequency: snapshot.frequency,
        days_of_week: snapshot.days_of_week,
        items_per_digest: snapshot.items_per_digest,
        email_enabled: true,
        telegram_enabled: !!telegramEnabled,
      },
    };
  }

  globalScope.SignalBriefPrefsStateRuntime = {
    createPreferenceState,
    buildSignupPayload,
    buildSettingsPayload,
  };
})(window);
