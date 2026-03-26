/* SignalBrief — settings UI preference action helpers */
(function bootstrapSettingsUiPreferencesActionsRuntime(globalScope) {
  function setSelectedDepth({ prefState, depthOrElement }) {
    if (!prefState) return;

    const depth = typeof depthOrElement === "string"
      ? depthOrElement
      : String(depthOrElement?.dataset?.depth || "").trim();
    prefState.setDepth(depth || "headline_plus_why");

    document.querySelectorAll(".depth-option").forEach((option) => {
      const checked = option.dataset.depth === prefState.getDepth();
      option.classList.toggle("selected", checked);
      const radio = option.querySelector('input[type="radio"]');
      if (radio) radio.checked = checked;
    });
  }

  function initDepthSelector({ prefState, initialDepth }) {
    if (!prefState) return;
    prefState.setDepth(initialDepth || prefState.getDepth() || "headline_plus_why");
    document.querySelectorAll(".depth-option").forEach((option) => {
      option.addEventListener("click", () => setSelectedDepth({ prefState, depthOrElement: option.dataset.depth }));
    });
    setSelectedDepth({ prefState, depthOrElement: prefState.getDepth() });
  }

  function renderSettingsDays({ Prefs, prefState, byId }) {
    if (!prefState) return;
    const days = prefState.getDays();

    document.querySelectorAll("#dayCircles .day-circle").forEach((circle) => {
      const day = parseInt(circle.dataset.day, 10);
      circle.classList.toggle("active", days.includes(day));
    });

    const weekdays = typeof Prefs.isWeekdays === "function"
      ? Prefs.isWeekdays(days)
      : (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day)));
    const everyday = typeof Prefs.isEveryday === "function"
      ? Prefs.isEveryday(days)
      : days.length === 7;

    byId("preset-weekdays")?.classList.toggle("active", weekdays);
    byId("preset-everyday")?.classList.toggle("active", everyday);
  }

  function initSettingsDays({ prefState, days, renderDays }) {
    if (!prefState) return;
    prefState.setDays(days);
    renderDays();
  }

  function toggleSettingsDay({ prefState, dayCircle, renderDays }) {
    if (!prefState) return;
    prefState.toggleDay(parseInt(dayCircle?.dataset?.day, 10));
    renderDays();
  }

  function setSettingsDays({ prefState, preset, renderDays }) {
    if (!prefState) return;
    prefState.setDaysPreset(preset);
    renderDays();
  }

  function getSettingsFrequency({ prefState, getSettingsDays }) {
    if (prefState) return prefState.getFrequency();
    const days = getSettingsDays();
    if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "daily_weekday";
    if (days.length === 7) return "daily_all";
    return "custom";
  }

  function setSettingsSelectValue({ byId, id, value }) {
    const el = byId(id);
    if (el && value != null) el.value = String(value);
  }

  function bindPreferenceSelectHandlers({ byId, prefState }) {
    const delivery = byId("deliveryTime");
    if (delivery && prefState) {
      prefState.setDeliveryTime(delivery.value || "07:00");
      delivery.addEventListener("change", () => {
        prefState.setDeliveryTime(delivery.value || "07:00");
      });
    }
  }

  function renderInitialState({
    user,
    statusBanner,
    loadingEl,
    formEl,
    Prefs,
    byId,
    showBanner,
    renderChips,
    prefState,
    sourceState,
  }) {
    loadingEl.style.display = "none";
    formEl.style.display = "block";
    if (statusBanner) showBanner(statusBanner, 5000);

    byId("name").value = user.name || "";
    byId("email").value = user.email || "";

    renderChips(user.topics || []);

    const prefs = user.preferences || {};
    initDepthSelector({ prefState, initialDepth: prefs.depth || "headline_plus_why" });
    setSettingsSelectValue({ byId, id: "deliveryTime", value: prefs.delivery_time || "07:00" });
    bindPreferenceSelectHandlers({ byId, prefState });

    const defaultDays = typeof Prefs.daysFromFrequency === "function"
      ? Prefs.daysFromFrequency(prefs.frequency)
      : [1, 2, 3, 4, 5];
    const renderDays = () => renderSettingsDays({ Prefs, prefState, byId });
    initSettingsDays({
      prefState,
      days: prefs.days_of_week || defaultDays,
      renderDays,
    });

    // Source preferences
    const SourcesRuntime = globalScope.SignalBriefSettingsUiSourcesRuntime;
    if (SourcesRuntime && typeof SourcesRuntime.createSourceState === "function") {
      const ss = sourceState || SourcesRuntime.createSourceState(user.source_preferences || {});
      SourcesRuntime.initSourcesUi(ss);
      // Expose on globalScope so settings-runtime.js save handler can read it
      globalScope._signalBriefSourceState = ss;
    }
  }

  function renderUnsubscribedState(formEl) {
    formEl.innerHTML = `
        <div class="form-section" style="text-align:center;padding:48px 24px;">
          <div style="font-size:40px;margin-bottom:16px;">👋</div>
          <h2 style="font-family:'Instrument Serif',serif;font-weight:400;font-size:26px;margin-bottom:8px;">You're unsubscribed.</h2>
          <p style="color:#6B7280;">No more digests. <a href="/" style="color:#2563EB;">Re-subscribe anytime →</a></p>
        </div>`;
  }

  globalScope.SignalBriefSettingsUiPreferencesActionsRuntime = {
    renderSettingsDays,
    toggleSettingsDay,
    setSettingsDays,
    getSettingsFrequency,
    renderInitialState,
    renderUnsubscribedState,
  };
})(window);
