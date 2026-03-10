/* SignalBrief — index page helper runtime */
(function bootstrapIndexHelpersRuntime(globalScope) {
  function appendTopicGroup(topicGrid, label, topics, topicDisplayLabel, onSelect) {
    if (!topicGrid || !Array.isArray(topics) || !topics.length) return;

    const heading = document.createElement("div");
    heading.className = "topic-group-label";
    heading.textContent = label;
    topicGrid.appendChild(heading);

    topics.forEach((topic) => {
      const chip = document.createElement("div");
      chip.className = "topic-chip";
      chip.dataset.topic = topic;
      chip.innerHTML = `<span class="check"></span> ${topicDisplayLabel(topic)}`;
      chip.addEventListener("click", () => onSelect(chip));
      topicGrid.appendChild(chip);
    });
  }

  function createRequestHelpers({ debugEnabled = false } = {}) {
    function buildRequestError(message, extra = {}) {
      const err = new Error(message);
      Object.assign(err, extra);
      return err;
    }

    async function fetchJsonStrict(url, options = {}) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (err) {
        throw buildRequestError("network_error", { kind: "network", cause: err });
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        if (debugEnabled) {
          console.warn("[index] non-JSON response:", err.message);
        }
        payload = null;
      }

      if (!response.ok) {
        const apiMessage = payload && typeof payload.error === "string" ? payload.error.trim() : "";
        throw buildRequestError(apiMessage || `request_failed_${response.status}`, {
          kind: "http",
          status: response.status,
          payload,
        });
      }

      if (!payload || typeof payload !== "object") {
        throw buildRequestError("invalid_json_response", { kind: "decode", status: response.status });
      }

      return payload;
    }

    function mapRequestError(err, fallbackMessage) {
      if (err && err.kind === "network") return "Network error. Please try again.";
      const apiMessage = err && err.payload && typeof err.payload.error === "string"
        ? err.payload.error.trim()
        : "";
      if (apiMessage) return apiMessage;
      if (
        err
        && typeof err.message === "string"
        && err.message
        && !err.message.startsWith("request_failed_")
        && err.message !== "invalid_json_response"
      ) {
        return err.message;
      }
      return fallbackMessage || "Something went wrong. Please try again.";
    }

    return {
      buildRequestError,
      fetchJsonStrict,
      mapRequestError,
    };
  }

  function createDarkModeHelpers({ debugEnabled = false } = {}) {
    function reportStorageError(context, err) {
      if (!debugEnabled) return;
      const message = err && err.message ? err.message : String(err || "unknown error");
      console.warn(`[index] localStorage ${context} failed: ${message}`);
    }

    function toggleDarkMode() {
      document.body.classList.toggle("dark");
      const isDark = document.body.classList.contains("dark");
      const toggle = document.getElementById("darkToggle");
      if (toggle) toggle.textContent = isDark ? "☀️" : "🌙";
      try {
        localStorage.setItem("sbDark", isDark ? "1" : "0");
      } catch (err) {
        reportStorageError("write", err);
      }
    }

    function initDarkMode() {
      try {
        if (localStorage.getItem("sbDark") === "1") {
          document.body.classList.add("dark");
          const toggle = document.getElementById("darkToggle");
          if (toggle) toggle.textContent = "☀️";
        }
      } catch (err) {
        reportStorageError("read", err);
      }
    }

    return {
      reportStorageError,
      toggleDarkMode,
      initDarkMode,
    };
  }

  globalScope.SignalBriefIndexHelpersRuntime = {
    appendTopicGroup,
    createRequestHelpers,
    createDarkModeHelpers,
  };
})(window);
