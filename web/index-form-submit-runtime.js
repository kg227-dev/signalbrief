/* SignalBrief — onboarding submit flow runtime */
(function bootstrapIndexFormSubmitRuntime(globalScope) {
  function buildRequestError(requestHelpers, message) {
    if (requestHelpers && typeof requestHelpers.buildRequestError === "function") {
      return requestHelpers.buildRequestError(message);
    }
    return new Error(message);
  }

  function mapSubmitError(requestHelpers, err) {
    if (requestHelpers && typeof requestHelpers.mapRequestError === "function") {
      return requestHelpers.mapRequestError(err, "Something went wrong. Please try again.");
    }
    if (err && typeof err.message === "string" && err.message.trim()) return err.message.trim();
    return "Something went wrong. Please try again.";
  }

  async function fetchSignup(requestHelpers, payload) {
    if (requestHelpers && typeof requestHelpers.fetchJsonStrict === "function") {
      return requestHelpers.fetchJsonStrict("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== "object") {
      throw buildRequestError(requestHelpers, "Could not complete signup.");
    }
    return result;
  }

  function buildFallbackPayload({
    name,
    email,
    telegram,
    topics,
    deliveryTime,
    days,
    referralToken,
    getSelectedDepth,
    getDaysFrequency,
    getItemsPerDigest,
  }) {
    return {
      name,
      email,
      telegram: String(telegram || "").trim().replace(/^@+/, "") || null,
      topics,
      depth: typeof getSelectedDepth === "function" ? getSelectedDepth() : "headline_plus_why",
      delivery_time: deliveryTime,
      frequency: typeof getDaysFrequency === "function" ? getDaysFrequency() : "custom",
      days_of_week: days,
      items_per_digest: typeof getItemsPerDigest === "function" ? getItemsPerDigest() : 5,
      referral_token: referralToken || null,
    };
  }

  function setSubmitButtonState(submitBtn, isSubmitting) {
    if (!submitBtn) return;
    submitBtn.disabled = Boolean(isSubmitting);
    submitBtn.textContent = isSubmitting ? "Subscribing…" : "Start my SignalBrief →";
  }

  function createFormSubmitHandler({
    byId,
    showSubmitError,
    clearSubmitError,
    applySuccessState,
    emailRe,
    Prefs,
    prefState,
    requestHelpers,
    selectedTopicKeys,
    getSelectedDepth,
    getSelectedDays,
    getDaysFrequency,
    getItemsPerDigest,
    debugEnabled,
  }) {
    return async function handleFormSubmit(event) {
      event.preventDefault();
      clearSubmitError();

      const topics = typeof selectedTopicKeys === "function" ? selectedTopicKeys() : [];
      if (topics.length < 2) {
        showSubmitError("Please select at least 2 topics.");
        return;
      }
      const maxCustomKeywords = Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3));
      const customCount = topics.filter((topic) => (
        typeof Prefs.isCustomTopic === "function"
          ? Prefs.isCustomTopic(topic)
          : String(topic || "").startsWith("custom_")
      )).length;
      if (customCount > maxCustomKeywords) {
        showSubmitError(`You can track up to ${maxCustomKeywords} custom keywords.`);
        return;
      }

      const name = String(byId("name")?.value || "").trim();
      const email = String(byId("email")?.value || "").trim();
      if (!name || !email) {
        showSubmitError("Name and email are required.");
        return;
      }
      if (!emailRe.test(email)) {
        showSubmitError("Please enter a valid email address.");
        byId("email")?.focus();
        return;
      }

      const days = typeof getSelectedDays === "function" ? getSelectedDays() : [];
      if (!days.length) {
        showSubmitError("Please select at least one delivery day.");
        return;
      }

      const submitBtn = document.querySelector(".submit-btn");
      setSubmitButtonState(submitBtn, true);

      const telegram = byId("telegram")?.value || "";
      const deliveryTime = byId("deliveryTime")?.value || "07:00";
      const referralToken = (new URLSearchParams(globalScope.location.search).get("ref") || "").trim();

      if (prefState) {
        prefState.setTopics(topics);
        if (typeof getSelectedDepth === "function") prefState.setDepth(getSelectedDepth());
        prefState.setDeliveryTime(deliveryTime);
        prefState.setDays(days);
        if (typeof getItemsPerDigest === "function") prefState.setItemsPerDigest(getItemsPerDigest());
      }

      const payload = (prefState && typeof Prefs.buildSignupPayload === "function")
        ? Prefs.buildSignupPayload({
            state: prefState,
            name,
            email,
            telegram,
            referralToken,
          })
        : buildFallbackPayload({
            name,
            email,
            telegram,
            topics,
            deliveryTime,
            days,
            referralToken,
            getSelectedDepth,
            getDaysFrequency,
            getItemsPerDigest,
          });

      try {
        const result = await fetchSignup(requestHelpers, payload);
        if (result.success || result.account_created === true) {
          applySuccessState(result, deliveryTime, debugEnabled);
          return;
        }
        throw buildRequestError(requestHelpers, result.error || "Could not complete signup.");
      } catch (err) {
        showSubmitError(mapSubmitError(requestHelpers, err));
        setSubmitButtonState(submitBtn, false);
      }
    };
  }

  globalScope.SignalBriefIndexFormSubmitRuntime = {
    createFormSubmitHandler,
  };
})(window);
