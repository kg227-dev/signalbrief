/* SignalBrief — settings UI runtime composer */
(function bootstrapSettingsUiRuntime(globalScope) {
  const TopicRuntime = globalScope.SignalBriefSettingsUiTopicRuntime || {};
  const PreferencesRuntime = globalScope.SignalBriefSettingsUiPreferencesRuntime || {};

  function createSettingsUiContext(args) {
    if (typeof TopicRuntime.createTopicUiContext !== "function") return null;
    if (typeof PreferencesRuntime.createPreferencesUiContext !== "function") return null;

    const topicUi = TopicRuntime.createTopicUiContext(args);
    const preferencesUi = PreferencesRuntime.createPreferencesUiContext({
      ...args,
      renderChips: topicUi.renderChips,
    });

    return {
      ...preferencesUi,
      bindTopicHandlers: topicUi.bindTopicHandlers,
    };
  }

  globalScope.SignalBriefSettingsUiRuntime = {
    createSettingsUiContext,
  };
})(window);
