/* SignalBrief — settings UI topic helpers */
(function bootstrapSettingsUiTopicRuntime(globalScope) {
  const Actions = globalScope.SignalBriefSettingsUiTopicActionsRuntime || {};
  const { createTopicUiHandlers } = Actions;

  function createTopicUiContext({
    Prefs,
    prefState,
    byId,
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    DEFAULT_TOPICS,
  }) {
    if (typeof createTopicUiHandlers !== "function") {
      return {
        renderChips() {},
        bindTopicHandlers() {},
      };
    }

    return createTopicUiHandlers({
      Prefs,
      prefState,
      byId,
      INDUSTRY_TOPICS,
      CAPABILITY_TOPICS,
      DEFAULT_TOPICS,
    });
  }

  globalScope.SignalBriefSettingsUiTopicRuntime = {
    createTopicUiContext,
  };
})(window);
