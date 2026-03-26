/* SignalBrief — onboarding form runtime helpers */
(function bootstrapIndexFormRuntime(globalScope) {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const SubmitRuntime = globalScope.SignalBriefIndexFormSubmitRuntime || {};
  const ContextRuntime = globalScope.SignalBriefIndexFormContextRuntime || {};
  const {
    createVisibilityHandlers,
    createProgressHandlers,
    createSignupBinding,
    switchPreview,
  } = ContextRuntime;

  function byId(id) {
    return document.getElementById(id);
  }

  function setProgressStep(id, filled) {
    const step = byId(id);
    if (!step) return;
    step.className = `progress-step${filled ? " filled" : ""}`;
  }

  function showSubmitError(message) {
    const el = byId("submitError");
    if (!el) return;
    el.textContent = String(message || "");
    el.classList.add("visible");
  }

  function clearSubmitError() {
    const el = byId("submitError");
    if (!el) return;
    el.textContent = "";
    el.classList.remove("visible");
  }

  function formatDeliveryTimeLabel(deliveryTime) {
    const [hourRaw, minuteRaw] = String(deliveryTime || "07:00").split(":");
    const hour24 = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return "7:00 AM ET";
    const ampm = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${ampm} ET`;
  }

  function applySuccessState(result, deliveryTime, debugEnabled) {
    clearSubmitError();
    if (byId("onboardForm")) byId("onboardForm").style.display = "none";
    if (byId("formFooter")) byId("formFooter").style.display = "none";
    byId("successCard")?.classList.add("visible");

    document.querySelectorAll(".progress-step").forEach((step) => {
      step.className = "progress-step filled";
    });

    const settingsLink = byId("settingsLink");
    if (settingsLink && result && result.token) {
      settingsLink.href = `/settings?token=${encodeURIComponent(result.token)}`;
    }

    const archiveLink = byId("archiveLink");
    if (archiveLink && result && result.archiveUrl) {
      archiveLink.href = result.archiveUrl;
    }

    const successDeliveryMsg = byId("successDeliveryMsg");
    if (successDeliveryMsg) {
      const prettyTime = formatDeliveryTimeLabel(deliveryTime);
      successDeliveryMsg.innerHTML = `Your first SignalBrief arrives at <strong>${prettyTime}</strong>. Here's a preview of what to expect:`;
    }

    if (debugEnabled && Array.isArray(result?.warnings) && result.warnings.length) {
      console.warn("[signup] completed with side-effect warnings:", result.warnings);
    }
  }

  function createIndexFormContext({
    Prefs = {},
    prefState = null,
    requestHelpers = null,
    selectedTopicKeys,
    getSelectedDepth,
    getSelectedDays,
    getDaysFrequency,
    debugEnabled = false,
  }) {
    const handleFormSubmit = typeof SubmitRuntime.createFormSubmitHandler === "function"
      ? SubmitRuntime.createFormSubmitHandler({
          byId,
          showSubmitError,
          clearSubmitError,
          applySuccessState,
          emailRe: EMAIL_RE,
          Prefs,
          prefState,
          requestHelpers,
          selectedTopicKeys,
          getSelectedDepth,
          getSelectedDays,
          getDaysFrequency,
          debugEnabled,
        })
      : async function missingSubmitRuntime(event) {
          event.preventDefault();
          showSubmitError("Signup runtime is unavailable. Refresh and try again.");
        };

    const visibility = typeof createVisibilityHandlers === "function"
      ? createVisibilityHandlers({ byId })
      : {
          showOnboarding() {},
          showLanding() {},
        };
    const progress = typeof createProgressHandlers === "function"
      ? createProgressHandlers({
          byId,
          setProgressStep,
          selectedTopicKeys,
          getSelectedDepth,
          getSelectedDays,
        })
      : {
          updateProgress() {},
          bindProgressInputs() {},
        };
    const signupBinding = typeof createSignupBinding === "function"
      ? createSignupBinding({ byId, handleFormSubmit })
      : {
          bindSignupForm() {},
        };
    const switchPreviewFn = typeof switchPreview === "function"
      ? (panel, button) => switchPreview(byId, panel, button)
      : () => {};

    return {
      showOnboarding: visibility.showOnboarding,
      showLanding: visibility.showLanding,
      updateProgress: progress.updateProgress,
      bindProgressInputs: progress.bindProgressInputs,
      bindSignupForm: signupBinding.bindSignupForm,
      switchPreview: switchPreviewFn,
    };
  }

  globalScope.SignalBriefIndexFormRuntime = {
    createIndexFormContext,
  };
})(window);
