/* SignalBrief — onboarding form context runtime helpers */
(function bootstrapIndexFormContextRuntime(globalScope) {
  function createVisibilityHandlers({ byId }) {
    function showOnboarding() {
      const hero = document.querySelector(".hero");
      const onboard = byId("onboard-form");
      if (!hero || !onboard) return;
      hero.style.display = "none";
      onboard.style.display = "block";
      globalScope.scrollTo({ top: 0, behavior: "smooth" });
    }

    function showLanding() {
      const hero = document.querySelector(".hero");
      const onboard = byId("onboard-form");
      if (!hero || !onboard) return;
      onboard.style.display = "none";
      hero.style.display = "block";
      globalScope.scrollTo({ top: 0, behavior: "smooth" });
    }

    return {
      showOnboarding,
      showLanding,
    };
  }

  function createProgressHandlers({
    byId,
    setProgressStep,
    selectedTopicKeys,
    getSelectedDepth,
    getSelectedDays,
  }) {
    let progressBound = false;

    function updateProgress() {
      const name = String(byId("name")?.value || "").trim();
      const email = String(byId("email")?.value || "").trim();
      const topicCount = typeof selectedTopicKeys === "function" ? selectedTopicKeys().length : 0;
      const depth = typeof getSelectedDepth === "function" ? getSelectedDepth() : "";
      const dayCount = typeof getSelectedDays === "function" ? getSelectedDays().length : 0;

      setProgressStep("prog-1", !!(name && email));
      setProgressStep("prog-2", topicCount >= 2);
      setProgressStep("prog-3", !!depth);
      setProgressStep("prog-4", dayCount > 0);
    }

    function bindProgressInputs() {
      if (progressBound) return;
      byId("name")?.addEventListener("input", updateProgress);
      byId("email")?.addEventListener("input", updateProgress);
      progressBound = true;
    }

    return {
      updateProgress,
      bindProgressInputs,
    };
  }

  function createSignupBinding({ byId, handleFormSubmit }) {
    let submitBound = false;

    function bindSignupForm() {
      if (submitBound) return;
      const form = byId("onboardForm");
      if (!form) return;
      form.addEventListener("submit", handleFormSubmit);
      submitBound = true;
    }

    return {
      bindSignupForm,
    };
  }

  function switchPreview(byId, panel, button) {
    const telegramPreview = byId("prev-telegram");
    const emailPreview = byId("prev-email");
    if (telegramPreview) telegramPreview.style.display = panel === "telegram" ? "block" : "none";
    if (emailPreview) emailPreview.style.display = panel === "email" ? "block" : "none";

    document.querySelectorAll(".prev-tab").forEach((tab) => {
      tab.style.borderColor = "#E5E7EB";
      tab.style.background = "#fff";
      tab.style.color = "#6B7280";
      tab.style.fontWeight = "500";
    });

    if (!button) return;
    button.style.borderColor = "#2563EB";
    button.style.background = "#EFF6FF";
    button.style.color = "#2563EB";
    button.style.fontWeight = "600";
  }

  globalScope.SignalBriefIndexFormContextRuntime = {
    createVisibilityHandlers,
    createProgressHandlers,
    createSignupBinding,
    switchPreview,
  };
})(window);
