/* SignalBrief — settings UI topic action helpers */
(function bootstrapSettingsUiTopicActionsRuntime(globalScope) {
  function createTopicUiHandlers({
    Prefs,
    prefState,
    byId,
    INDUSTRY_TOPICS,
    DEFAULT_TOPICS,
    showError,
  }) {
    function topicDisplayLabel(topic) {
      if (typeof Prefs.topicDisplayLabel === "function") return Prefs.topicDisplayLabel(topic);
      return String(topic || "");
    }

    function selectedTopicsList() {
      return prefState ? prefState.getTopics() : [];
    }

    function showTopicInputError(message) {
      const topicError = byId("topicInputError");
      const nextMessage = String(message || "").trim();

      if (topicError) {
        topicError.textContent = nextMessage;
        topicError.classList.toggle("visible", !!nextMessage);
      } else if (typeof showError === "function") {
        showError(nextMessage);
      }
    }

    function updateSelectedSummary() {
      const el = byId("selectedSummary");
      if (!el) return;

      const topics = selectedTopicsList();
      if (!topics.length) {
        el.innerHTML = "No topics selected yet.";
        return;
      }

      const labels = topics.map((topic) => topicDisplayLabel(topic));
      el.innerHTML = `<strong>${topics.length} tracking:</strong> <span class="summary-topics">${labels.join(" · ")}</span>`;
    }

    function updateTopicNote() {
      const count = selectedTopicsList().length;
      const note = byId("topicMinNote");
      if (!note) return;
      if (count < 1) {
        note.textContent = `${count} selected — pick at least 1`;
      } else if (count > 3) {
        note.textContent = `${count} selected — reduce to 3`;
      } else {
        note.textContent = `${count} selected`;
      }
      note.style.color = count === 0 || count > 3 ? "#DC2626" : "#6B7280";
      updateSelectedSummary();
    }

    function renderChip(topic, selected) {
      const chip = document.createElement("div");
      chip.className = `chip${selected ? " selected" : ""}`;
      chip.dataset.topic = topic;
      chip.innerHTML = `<span class="chip-check">✓</span> ${topicDisplayLabel(topic)}`;

      chip.addEventListener("click", () => {
        if (!prefState) return;
        if (!prefState.hasTopic(topic) && selectedTopicsList().length >= 3) {
          showTopicInputError("You can select up to 3 topics.");
          updateTopicNote();
          return;
        }
        const isSelected = prefState.toggleTopic(topic);
        chip.classList.toggle("selected", isSelected);
        showTopicInputError("");
        updateTopicNote();
      });

      return chip;
    }

    function renderGroupLabel(text) {
      const el = document.createElement("div");
      el.className = "topic-group-label";
      el.textContent = text;
      return el;
    }

    function renderChips(userTopics) {
      const container = byId("topicGrid");
      if (!container || !prefState) return;

      const normalizedUserTopics = Array.isArray(userTopics) ? userTopics.map(String) : [];
      prefState.setTopics(normalizedUserTopics);
      container.innerHTML = "";

      container.appendChild(renderGroupLabel("Industries"));
      INDUSTRY_TOPICS.forEach((topic) => {
        container.appendChild(renderChip(topic, prefState.hasTopic(topic)));
      });

      updateTopicNote();
    }

    function bindTopicHandlers() {
      return undefined;
    }

    return {
      renderChips,
      bindTopicHandlers,
    };
  }

  globalScope.SignalBriefSettingsUiTopicActionsRuntime = {
    createTopicUiHandlers,
  };
})(window);
