/* SignalBrief — settings.js (bootstrap + global bridges) */

(function bootstrapSettingsPage() {
  const runtime = window.SignalBriefSettingsRuntime;
  if (!runtime) {
    console.error("[settings] runtime not loaded");
    return;
  }

  window.setSettingsDays = (preset) => runtime.setSettingsDays(preset);
  window.toggleSettingsDay = (el) => runtime.toggleSettingsDay(el);
  window.requestSettingsLink = () => runtime.requestSettingsLink();

  runtime.initSettingsPage();
})();
