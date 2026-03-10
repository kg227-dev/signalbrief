/* SignalBrief — settings UI preference/depth/day helpers */
(function bootstrapSettingsUiPreferencesRuntime(globalScope) {
  const Actions = globalScope.SignalBriefSettingsUiPreferencesActionsRuntime || {};
  const {
    renderSettingsDays,
    toggleSettingsDay,
    setSettingsDays,
    getSettingsFrequency: computeSettingsFrequency,
    renderInitialState,
    renderUnsubscribedState,
  } = Actions;

  function createPreferencesUiContext({
    Prefs,
    prefState,
    byId,
    showBanner,
    renderChips,
  }) {
    const renderDays = () => renderSettingsDays({ Prefs, prefState, byId });

    function getSettingsDays() {
      return prefState ? prefState.getDays() : [];
    }

    function getSettingsFrequency() {
      return computeSettingsFrequency({ prefState, getSettingsDays });
    }

    return {
      renderUnsubscribedState: (formEl) => renderUnsubscribedState(formEl),
      setSettingsDays: (preset) => setSettingsDays({ prefState, preset, renderDays }),
      toggleSettingsDay: (dayCircle) => toggleSettingsDay({ prefState, dayCircle, renderDays }),
      getSettingsDays,
      getSettingsFrequency,
      renderInitialState: (user, statusBanner, loadingEl, formEl) => renderInitialState({
        user,
        statusBanner,
        loadingEl,
        formEl,
        Prefs,
        byId,
        showBanner,
        renderChips,
        prefState,
      }),
    };
  }

  globalScope.SignalBriefSettingsUiPreferencesRuntime = {
    createPreferencesUiContext,
  };
})(window);
